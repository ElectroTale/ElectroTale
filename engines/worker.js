// ElectroTale — moteur intégré.
// Lancé par l'application elle-même (utilityProcess), jamais un programme externe.
// Un rôle par processus : "text" (llama.cpp via node-llama-cpp), "image" (stable-diffusion.cpp), "voice" (Kokoro via sherpa-onnx).
// Chaque rôle parle un petit protocole HTTP local compatible llama-server / A1111, pour que l'interface ne change pas.
"use strict";
const http = require("http");
const zlib = require("zlib");
const path = require("path");
const fs = require("fs");

const role = process.argv[2];
const cfg = JSON.parse(process.argv[3] || "{}");
const log = (...a) => console.log("[" + role + "]", ...a);
const fail = (...a) => console.error("[" + role + "]", ...a);
// clé secrète tirée au hasard par l'app à chaque lancement : sans elle, le moteur refuse de répondre
const KEY = process.env.ELECTROTALE_KEY || "";
delete process.env.ELECTROTALE_KEY;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ""; req.setEncoding("utf8");
    req.on("data", c => { d += c; if (d.length > 20e6) req.destroy(); });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
// seule la fenêtre d'ElectroTale (page locale, origine « null » ou file://) a le droit d'appeler le moteur
const okOrigin = o => !o || o === "null" || o.startsWith("file://");
function json(res, code, obj) {
  if (res.headersSent) return;
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "null" });
  res.end(JSON.stringify(obj));
}
function serve(port, handler) {
  const srv = http.createServer(async (req, res) => {
    // protection contre les sites web (y compris l'astuce du « DNS rebinding ») : seule l'adresse locale est acceptée
    const host = String(req.headers.host || "").toLowerCase();
    if (host !== "127.0.0.1:" + port && host !== "localhost:" + port) { res.writeHead(403); return res.end(); }
    if (!okOrigin(req.headers.origin)) { res.writeHead(403); return res.end(); }
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "null", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" });
      return res.end();
    }
    if (!KEY || req.headers["x-electrotale-key"] !== KEY) { res.writeHead(401, { "Access-Control-Allow-Origin": "null" }); return res.end(); }
    try { await handler(req, res); }
    catch (e) { fail("erreur :", e && e.stack || e); json(res, 500, { error: { message: String(e && e.message || e) } }); }
  });
  srv.on("error", e => { fail("port " + port + " indisponible :", e.message); process.exit(3); });
  srv.listen(port, "127.0.0.1", () => log("à l'écoute sur le port " + port));
  return srv;
}
// petite file d'attente : un seul calcul à la fois
let chain = Promise.resolve();
const queued = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

/* =============================== TEXTE =============================== */
async function runText() {
  let ready = false, loadErr = null, model = null, ctx = null, seq = null, completion = null, nctx = 0, L = null, wrapper = null;
  // petite mémoire à part pour les tâches annexes (titres, résumés, mots-clés d'images) : la mémoire de l'histoire reste intacte
  let asideCompletion = null, asideSeq = null, asideCtx = 0, onGpu = false;
  serve(cfg.port, async (req, res) => {
    const u = req.url.split("?")[0];
    if (u === "/health") return ready ? json(res, 200, { status: "ok" }) : json(res, 503, { status: loadErr ? "error" : "loading model", error: loadErr });
    if (!ready) return json(res, 503, { error: { message: loadErr || "Loading model" } });
    if (u === "/props") {
      const meta = (model.fileInfo.metadata || {});
      return json(res, 200, {
        model_path: cfg.modelPath, n_ctx: nctx, build_info: "electrotale-integre",
        chat_template: ((meta.tokenizer || {}).chat_template) || "",
        default_generation_settings: { n_ctx: nctx, model: cfg.modelPath }
      });
    }
    if (u === "/apply-template" && req.method === "POST") {
      const b = await readBody(req);
      return json(res, 200, { prompt: applyTemplate(b.messages || []) });
    }
    if (u === "/tokenize" && req.method === "POST") {
      const b = await readBody(req);
      return json(res, 200, { tokens: Array.from(model.tokenize(String(b.content || ""), true)) });
    }
    if (u === "/completion" && req.method === "POST") {
      const b = await readBody(req);
      return queued(() => complete(b, req, res));
    }
    json(res, 404, { error: { message: "inconnu : " + u } });
  });

  try {
    // mode prudent de la carte graphique : certains pilotes (surtout Intel intégré, Vulkan) calculent faux
    // et le modèle écrit n'importe quoi. Chaque palier coupe des accélérations ; le dernier passe au processeur.
    const safe = +cfg.safe || 0;
    if (safe >= 1) ["COOPMAT", "COOPMAT2", "INTEGER_DOT_PRODUCT", "BFLOAT16", "FUSION"].forEach(k => process.env["GGML_VK_DISABLE_" + k] = "1");
    if (safe >= 2) ["F16", "MMVQ", "DOT2"].forEach(k => process.env["GGML_VK_DISABLE_" + k] = "1");
    if (safe) log("mode prudent " + safe + (safe >= 3 ? " : processeur seul" : " : accélérations de la carte graphique coupées"));
    L = await import("node-llama-cpp");
    const useGpu = cfg.gpu !== "cpu" && safe < 3;
    let llama;
    try { llama = await L.getLlama({ gpu: useGpu ? "auto" : false, build: "never", logLevel: "warn", progressLogs: false }); }
    catch (e) { fail("GPU indisponible, passage au processeur :", e.message); llama = await L.getLlama({ gpu: false, build: "never", logLevel: "warn", progressLogs: false }); }
    log("carte utilisée : " + (llama.gpu || "processeur") + (llama.gpu ? " (" + ((await llama.getGpuDeviceNames().catch(() => [])).join(", ") || "?") + ")" : ""));
    const layers = !useGpu ? 0 : (cfg.layers == null || cfg.layers < 0 ? "auto" : cfg.layers);
    log("chargement de " + path.basename(cfg.modelPath) + "…");
    let last = -1;
    model = await llama.loadModel({
      modelPath: cfg.modelPath, gpuLayers: layers,
      onLoadProgress: p => { const pc = Math.floor(p * 10) * 10; if (pc !== last) { last = pc; log("chargement " + pc + " %"); } }
    });
    log("couches sur la carte graphique : " + model.gpuLayers);
    onGpu = !!llama.gpu && model.gpuLayers > 0;
    const os = require("os");
    const threads = Math.max(1, Math.min(llama.cpuMathCores || 4, os.availableParallelism ? os.availableParallelism() : os.cpus().length));
    const want = Math.max(512, Math.min(+cfg.ctx || 8192, model.trainContextSize || 1e9));
    for (let size = want; ; size = Math.floor(size / 2)) {
      try { ctx = await model.createContext({ contextSize: size, flashAttention: !!cfg.flash && !safe, sequences: 1, threads }); break; }
      catch (e) {
        if (size <= 1024) throw e;
        fail("contexte de " + size + " trop grand pour la mémoire, essai avec " + Math.floor(size / 2));
      }
    }
    nctx = ctx.contextSize;
    seq = ctx.getSequence();
    completion = new L.LlamaCompletion({ contextSequence: seq });
    try {
      const a = await model.createContext({ contextSize: Math.min(3072, nctx), flashAttention: !!cfg.flash && !safe, sequences: 1, threads });
      asideSeq = a.getSequence(); asideCompletion = new L.LlamaCompletion({ contextSequence: asideSeq }); asideCtx = a.contextSize;
    } catch (e) { fail("pas de mémoire pour les tâches annexes, elles partageront celle de l'histoire"); }
    try { wrapper = L.resolveChatWrapper(model); } catch (e) { wrapper = null; }
    // petit contrôle avant de raconter : si le modèle ne sait même plus compter, les calculs de la carte graphique sont faux.
    // Sur le processeur : seulement les trois petits essais, une seule fois par fichier (cfg.cpuChecked). Un fichier qui
    // les rate écrit du charabia (vu le 30/10 avec un Q4_K_M) : on le dit au lieu de laisser le Conteur écrire n'importe quoi.
    let check = { ok: true, got: [] };
    if (onGpu) check = await sanity(asideCompletion || completion);
    else if (!cfg.cpuChecked) {
      log("contrôle du fichier sur le processeur (une seule fois)…");
      check = await shortSanity(asideCompletion || completion);
      if (check.ok) log("contrôle processeur réussi");
      else {
        loadErr = "fichier de modèle illisible";
        fail("le modèle rate le contrôle sur le processeur (" + check.got.map(g => JSON.stringify(g)).join(", ") + ")");
        setTimeout(() => process.exit(5), 300);
        return;
      }
    }
    if (!check.ok && onGpu) {
      loadErr = "texte incohérent";
      fail("texte incohérent au contrôle de départ (" + check.got.map(g => JSON.stringify(g)).join(", ") + ")");
      // la carte graphique calcule faux : on réessaie plus prudemment (palier suivant, puis processeur)
      setTimeout(() => process.exit(4), 300);
      return;
    }
    log("prêt — contexte " + nctx + " jetons, " + threads + " cœurs, format " + (wrapper ? wrapper.wrapperName : "inconnu"));
    ready = true;
  } catch (e) {
    loadErr = String(e && e.message || e);
    fail("impossible de charger le modèle :", loadErr);
    setTimeout(() => process.exit(2), 500);
  }

  function garbled(t) {
    const bad = (t.match(/Â|Ã|\uFFFD|&#/g) || []).length + (t.match(/\b(\w+)(\s+\1\b){2,}/g) || []).length * 2;
    if (bad >= 4 && bad * 40 > t.length) return true;
    // un vrai récit est fait de lettres à plus de 80 % ; le charabia de chiffres et de ponctuation, à moins de 50 %
    const ns = t.replace(/\s/g, "");
    return ns.length >= 30 && (ns.match(/\p{L}/gu) || []).length < ns.length * 0.6;
  }

  async function shortSanity(comp) {
    const tests = [["1, 2, 3, 4, 5, 6, 7, 8, 9, 10,", /\b11\b/], ["a, b, c, d, e, f, g, h,", /^\W*i\b/i], ["lundi, mardi, mercredi, jeudi,", /vendredi/i]];
    const got = []; let ok = 0;
    for (const [p, re] of tests) {
      let t; try { t = await comp.generateCompletion(model.tokenize(p), { maxTokens: 6, temperature: 0 }); } catch (e) { t = "(erreur " + e.message + ")"; }
      got.push(t.slice(0, 30));
      if (re.test(t)) ok++;
    }
    return { ok: ok >= 2, got };
  }

  async function sanity(comp) {
    // les phrases courtes et les longs textes ne passent pas par les mêmes calculs sur la carte : on teste les deux
    let long = ""; for (let i = 1; i <= 300; i++) long += i + ", ";
    const tests = [["1, 2, 3, 4, 5, 6, 7, 8, 9, 10,", /\b11\b/], ["a, b, c, d, e, f, g, h,", /^\W*i\b/i], ["lundi, mardi, mercredi, jeudi,", /vendredi/i]];
    const got = []; let ok = 0, longOk = false;
    const run = async p => { try { return await comp.generateCompletion(model.tokenize(p), { maxTokens: 6, temperature: 0 }); } catch (e) { return "(erreur " + e.message + ")"; } };
    for (const [p, re] of tests) {
      const t = await run(p);
      got.push(t.slice(0, 30));
      if (re.test(t)) ok++;
    }
    const t = await run(long.trim());
    got.push(t.slice(0, 30));
    longOk = /\b301\b/.test(t);
    if (!(ok >= 2 && longOk)) return { ok: false, got };
    // une seule fois par modèle et par réglage : un texte aussi long qu'une vraie partie (~2 300 jetons).
    // Sur certaines cartes, c'est seulement là que les calculs déraillent ; c'est lent, d'où le « une seule fois ».
    if (!cfg.verified) {
      const room = Math.min(2400, (comp === asideCompletion ? asideCtx : nctx) - 64);
      let n = 300, toks = model.tokenize(long.trim());
      while (toks.length < room - 40) { for (let k = 0; k < 50; k++) long += (++n) + ", "; toks = model.tokenize(long.trim()); }
      while (toks.length > room) { long = long.replace(/\d+, $/, ""); n--; toks = model.tokenize(long.trim()); }
      log("contrôle sur un long texte (" + toks.length + " jetons), une seule fois…");
      const t2 = await run(long.trim());
      got.push(t2.slice(0, 30));
      if (!new RegExp("\\b" + (n + 1) + "\\b").test(t2)) return { ok: false, got };
      log("contrôle complet réussi");
    }
    return { ok: true, got };
  }

  function applyTemplate(messages) {
    if (!wrapper) return "";
    const hist = [];
    for (const m of messages) {
      const t = String(m.content || "");
      if (m.role === "system") hist.push({ type: "system", text: t });
      else if (m.role === "assistant") hist.push({ type: "model", response: [t] });
      else hist.push({ type: "user", text: t });
    }
    hist.push({ type: "model", response: [] });
    const st = wrapper.generateContextState({ chatHistory: hist });
    return st.contextText.values.map(v => {
      if (typeof v === "string") return v;
      if (v instanceof L.SpecialTokensText) return v.value;
      if (v instanceof L.SpecialToken) return v.value === "BOS" ? "" : v.value === "EOS" ? (model.tokens.eosString || "") : v.value === "EOT" ? (model.tokens.eotString || model.tokens.eosString || "") : "";
      return String(v);
    }).join("");
  }

  async function complete(b, req, res) {
    const stream = !!b.stream;
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    // pas de BOS ici : LlamaCompletion l'ajoute déjà (avant, il y en avait deux)
    let tokens = model.tokenize(String(b.prompt || ""), true);
    if (model.tokens.bos != null && tokens[0] === model.tokens.bos) tokens = tokens.slice(1);
    // tâche annexe : dans sa propre mémoire si elle y tient, sinon dans celle de l'histoire
    let comp = completion, size = nctx;
    if (b.aside && asideCompletion && tokens.length + Math.max(1, +b.n_predict || 512) + 8 <= asideCtx) { comp = asideCompletion; size = asideCtx; }
    const maxNew = Math.max(1, Math.min(+b.n_predict > 0 ? +b.n_predict : 512, size - 64));
    if (tokens.length + maxNew > size) {          // trop long : on garde la fin
      const keep = size - maxNew - 8;
      tokens = tokens.slice(tokens.length - keep);
    }
    let bias;
    if (Array.isArray(b.logit_bias) && b.logit_bias.length) {
      bias = new L.TokenBias(model.tokenizer);
      // seulement les mots qui tiennent en un seul jeton : pour un mot en plusieurs morceaux, la bibliothèque
      // interdirait chaque morceau (« s », « oud », « ain »…), et le modèle ne pourrait plus écrire en français
      for (const [w, v] of b.logit_bias) if (typeof w === "string" && w) {
        for (const s of [w, " " + w]) {
          try { const t = model.tokenize(s); if (t.length === 1) bias.set(t[0], v === false ? "never" : { logit: +v || 0 }); } catch (e) {}
        }
      }
    }
    const stops = (Array.isArray(b.stop) ? b.stop : []).filter(s => typeof s === "string" && s.length);
    if (stream) res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "null" });
    let text = "";
    // combien de jetons sont déjà en mémoire (rien à relire) : c'est ce qui rend la réponse rapide
    let reused = 0;
    const sent = model.tokens.bos != null && model.tokens.shouldPrependBosToken ? [model.tokens.bos, ...tokens] : tokens;
    try { const prev = (comp === completion ? seq : asideSeq).contextTokens; while (reused < prev.length && reused < sent.length && prev[reused] === sent[reused]) reused++; } catch (e) {}
    const t0 = Date.now();
    try {
      text = await comp.generateCompletion(tokens, {
        maxTokens: maxNew,
        temperature: b.temperature != null ? +b.temperature : 0.8,
        topK: b.top_k != null ? +b.top_k : 40, topP: b.top_p != null ? +b.top_p : 0.95, minP: b.min_p != null ? +b.min_p : 0.05,
        repeatPenalty: +b.repeat_penalty > 0 && +b.repeat_penalty !== 1 ? { penalty: +b.repeat_penalty, lastTokens: +b.repeat_last_n > 0 ? +b.repeat_last_n : 64 } : false,
        tokenBias: bias, customStopTriggers: stops.length ? stops : undefined,
        signal: ac.signal, stopOnAbortSignal: true,
        onTextChunk: t => { if (stream && !ac.signal.aborted) res.write("data: " + JSON.stringify({ content: t, stop: false }) + "\n\n"); }
      });
    } catch (e) {
      if (!ac.signal.aborted) throw e;
    }
    const secs = (Date.now() - t0) / 1000;
    if (ac.signal.aborted) return log("génération arrêtée");
    let nOut = 0; try { nOut = model.tokenize(text).length; } catch (e) {}
    log((comp === completion ? "réponse : " : "tâche annexe : ") + text.length + " caractères en " + secs.toFixed(1) + " s — " +
      (sent.length - reused) + " jetons relus sur " + sent.length + ", " + (secs > 0 ? (nOut / secs).toFixed(1) : "?") + " jetons/s");
    if (stream) { res.write("data: " + JSON.stringify({ content: "", stop: true }) + "\n\n"); res.end(); }
    else json(res, 200, { content: text, stop: true });
    // réponse brouillée en pleine partie (morceaux d'octets « Â », « &# », caractères illisibles) :
    // la carte graphique calcule faux sur ce long texte, on redémarre en mode plus prudent
    if (garbled(text)) {
      fail("texte incohérent pendant la partie : " + JSON.stringify(text.slice(0, 80)));
      // tout ce qu'il faut pour comprendre, dans un fichier à envoyer
      try {
        fs.writeFileSync(cfg.diagFile, ["ÉlectroTale — diagnostic du texte", new Date().toISOString(),
          "modèle : " + path.basename(cfg.modelPath), "carte : " + (onGpu ? "oui (" + model.gpuLayers + " couches)" : "non, processeur") + ", mode prudent " + (+cfg.safe || 0),
          "réglages : " + JSON.stringify({ temperature: b.temperature, top_k: b.top_k, top_p: b.top_p, min_p: b.min_p, repeat_penalty: b.repeat_penalty, repeat_last_n: b.repeat_last_n, interdits: (b.logit_bias || []).length }),
          "jetons du texte envoyé : " + tokens.length, "", "===== RÉPONSE =====", text, "", "===== FIN DU TEXTE ENVOYÉ =====", String(b.prompt || "").slice(-6000)].join("\r\n"));
        log("diagnostic enregistré dans " + cfg.diagFile);
      } catch (e) {}
      if (onGpu) setTimeout(() => process.exit(4), 300);
    }
  }
}

/* =============================== IMAGES =============================== */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h, ch, data) {
  const row = w * ch, raw = Buffer.alloc((row + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (row + 1)] = 0; data.copy(raw, y * (row + 1) + 1, y * row, y * row + row); }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : ch === 1 ? 0 : 2; ihdr[10] = ihdr[11] = ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}
const SAMPLERS = { "euler a": "euler_a", "euler": "euler", "heun": "heun", "dpm2": "dpm2", "dpm++ 2s a": "dpm++2s_a", "dpm++ 2m": "dpm++2m",
  "dpm++ 2m karras": "dpm++2m", "dpm++ 2m v2": "dpm++2mv2", "ipndm": "ipndm", "lcm": "lcm", "ddim": "ddim_trailing", "tcd": "tcd" };
// seule limite des images : rien de sexuel ni de nu avec un personnage mineur
const NSFW_RE = /\b(nsfw|nude|nudity|naked|topless|bottomless|nipples?|breasts?|genitals?|penis|vagina|pussy|sex|sexual|erotic|porn\w*|hentai|lingerie|undress\w*|nu|nue|nus|nues|seins?|sexe|sexuel\w*|érotique)\b/i;
const MINOR_RE = /\b(child|children|kid|kids|minor|underage|loli|lolita|shota|toddler|preteen|teen|teens|teenager|young girl|young boy|little girl|little boy|schoolgirl|schoolboy|enfant|enfants|fillette|gamin\w*|mineur\w*|adolescent\w*|écolier\w*|écolière\w*|(1[0-7]|[1-9])[ -]?(years?[ -]?old|yo|ans))\b/i;
async function runImage() {
  let ready = false, loadErr = null, sdc = null, sd = null;
  // avancement du dessin en cours, lu par l'interface pour la barre de progression
  const prog = { busy: false, step: 0, steps: 0, t0: 0, waiting: 0 };
  let stepAt = [];   // heure de fin de chaque étape : sert à mesurer la vraie vitesse (le test de vitesse s'en sert)
  // modèles « rapides » (LCM, Turbo, Lightning) : 4 à 6 étapes suffisent, avec un guidage faible
  const fastKind = () => /lcm/i.test(path.basename(cfg.modelPath || "")) ? "lcm" : /turbo|lightning|hyper/i.test(path.basename(cfg.modelPath || "")) ? "turbo" : "";
  serve(cfg.port, async (req, res) => {
    const u = req.url.split("?")[0];
    if (u === "/health") return ready ? json(res, 200, { status: "ok" }) : json(res, 503, { status: loadErr ? "error" : "loading model", error: loadErr });
    if (u === "/progress") return json(res, 200, { ...prog, elapsed: prog.busy ? (Date.now() - prog.t0) / 1000 : 0, fast: fastKind() });
    if (u === "/sdapi/v1/interrupt" && req.method === "POST") { if (sdc && prog.busy) { try { sdc.abort(); } catch (e) {} log("dessin annulé"); } return json(res, 200, { ok: true }); }
    if (!ready) return json(res, 503, { error: { message: loadErr || "Loading model" } });
    if (u === "/sdapi/v1/samplers") return json(res, 200, Object.keys(SAMPLERS).map(n => ({ name: n.replace(/\b\w/g, c => c.toUpperCase()), aliases: [SAMPLERS[n]] })));
    if (u === "/sdapi/v1/txt2img" && req.method === "POST") {
      const b = await readBody(req);
      prog.waiting++;
      return queued(async () => {
        prog.waiting--;
        const w = Math.max(64, Math.round((+b.width || 512) / 64) * 64), h = Math.max(64, Math.round((+b.height || 512) / 64) * 64);
        if (NSFW_RE.test(String(b.prompt || "")) && MINOR_RE.test(String(b.prompt || ""))) return json(res, 422, { error: { message: "image refusée : pas de nudité ni de contenu sexuel avec un personnage mineur" } });
        if (NSFW_RE.test(String(b.prompt || ""))) b.negative_prompt = [b.negative_prompt, "child, minor, underage, teen, loli, young-looking"].filter(Boolean).join(", ");
        let steps = +b.steps || 20, txtCfg = +b.cfg_scale || 7, method = SAMPLERS[String(b.sampler_name || "").toLowerCase()] || "euler_a";
        const fast = fastKind();
        if (fast) { steps = steps <= 8 ? steps : (fast === "lcm" ? 5 : 4); txtCfg = Math.min(txtCfg, fast === "lcm" ? 1.5 : 1); if (fast === "lcm") method = "lcm"; }
        const t0 = Date.now();
        Object.assign(prog, { busy: true, step: 0, steps, t0 }); stepAt = [];
        try {
          const imgs = await sdc.generateImage({
            prompt: String(b.prompt || ""), negativePrompt: String(b.negative_prompt || ""), width: w, height: h,
            seed: b.seed != null && +b.seed >= 0 ? +b.seed : Math.floor(Math.random() * 2147483647),
            sampleParams: { sampleSteps: steps, sampleMethod: method, guidance: { txtCfg } },
            vaeTiling: cfg.vaeTiling ? { enabled: true } : undefined
          });
          const im = imgs && imgs[0];
          if (!im) return json(res, 499, { error: { message: "dessin annulé" } });
          const total = (Date.now() - t0) / 1000, stepSecs = stepAt.length > 1 ? (stepAt[stepAt.length - 1] - stepAt[0]) / (stepAt.length - 1) / 1000 : 0;
          log("image " + im.width + "×" + im.height + ", " + steps + " étapes, en " + total.toFixed(1) + " s" + (stepSecs ? " (" + stepSecs.toFixed(1) + " s par étape)" : ""));
          json(res, 200, { images: [png(im.width, im.height, im.channel || 3, im.data).toString("base64")], parameters: {}, info: JSON.stringify({ total, stepSecs, steps }) });
        } catch (e) {
          const m = String(e && e.message || e), ab = (e && e.name === "AbortError") || /abort|cancel/i.test(m);
          json(res, ab ? 499 : 500, { error: { message: ab ? "dessin annulé" : m } });
        } finally { prog.busy = false; }
      });
    }
    json(res, 404, { error: { message: "inconnu : " + u } });
  });
  try {
    sd = require("stable-diffusion-cpp-node-api");
    sd.setLogCallback(({ level, text }) => { if (level >= 2 && text && text.trim()) fail(text.trim()); });
    let lastStep = -1;
    // le même rappel sert aussi au chargement des poids (ex. 686/686) : on ne garde que les étapes du dessin
    sd.setProgressCallback(({ step, steps }) => {
      if (!prog.busy || steps !== prog.steps) return;
      if (step > prog.step) stepAt.push(Date.now());
      prog.step = step;
      if (step !== lastStep && (step === steps || step % 5 === 0)) { lastStep = step; log("étape " + step + "/" + steps + " (" + Math.round((Date.now() - prog.t0) / 1000) + " s)"); }
    });
    try { log("appareils : " + sd.listDevices().map(d => d.description || d.name).join(", ")); } catch (e) {}
    log("chargement du modèle d'images " + path.basename(cfg.modelPath) + "…");
    const opts = { modelPath: cfg.modelPath, nThreads: Math.max(1, (sd.getNumPhysicalCores ? sd.getNumPhysicalCores() : 4)) };
    if (cfg.vaePath && fs.existsSync(cfg.vaePath)) opts.vaePath = cfg.vaePath;
    // accélérations : attention « flash » (bien moins de mémoire à brasser) et poids f16 réduits en q8_0 au chargement
    const extra = {};
    if (cfg.flash) extra.diffusionFlashAttn = true;
    if (cfg.quant && /f16|fp16/i.test(path.basename(cfg.modelPath))) extra.wtype = cfg.quant;
    if (cfg.gpu === "cpu") opts.backend = "*=CPU";
    else if (cfg.forceGpu) {
      // une carte intégrée n'est pas toujours reconnue comme « carte graphique » : on la désigne nommément
      const dev = (sd.listDevices ? sd.listDevices() : []).find(d => !/^cpu/i.test(d.name));
      if (dev) extra.backend = "*=" + dev.name;
    }
    log("réglages du dessin : " + (opts.backend ? "processeur" : extra.backend ? "carte " + extra.backend.slice(2) : "par défaut") + (extra.diffusionFlashAttn ? ", attention flash" : "") + (extra.wtype ? ", poids " + extra.wtype : ""));
    try { sdc = await sd.StableDiffusionContext.create({ ...opts, ...extra }); }
    catch (e) {
      if (!Object.keys(extra).length) throw e;
      fail("accélérations refusées (" + String(e && e.message || e) + "), chargement normal");
      sdc = await sd.StableDiffusionContext.create(opts);
    }
    log("prêt — " + (sdc.getModelVersionName ? sdc.getModelVersionName() : "modèle chargé"));
    ready = true;
  } catch (e) {
    loadErr = String(e && e.message || e);
    fail("impossible de charger le modèle d'images :", loadErr);
    setTimeout(() => process.exit(2), 500);
  }
}

/* =============================== VOIX =============================== */
function wav(samples, rate) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return b;
}
async function runVoice() {
  // une seule voix chargée à la fois : changer de langue recharge Kokoro (≈ 5 s)
  let tts = null, ttsLang = "", loadErr = null, mk = null, kokoro = null;
  const d = cfg.kokoroDir;
  const LANGS = ["fr", "en-us", "es", "it", "de", "pt-br"];
  async function useLang(lang) {
    if (tts && lang === ttsLang) return tts;
    const t0 = Date.now();
    let t;
    try { t = await mk({ ...kokoro, lang }); }
    catch (e) { fail("langue « " + lang + " » refusée, essai sans :", e.message); t = await mk(kokoro); }
    tts = t; ttsLang = lang;
    log("voix prête en « " + lang + " » (" + tts.numSpeakers + " voix disponibles, " + ((Date.now() - t0) / 1000).toFixed(1) + " s)");
    return tts;
  }
  serve(cfg.port, async (req, res) => {
    const u = req.url.split("?")[0];
    if (u === "/health") return tts ? json(res, 200, { status: "ok" }) : json(res, 503, { status: loadErr ? "error" : "loading model", error: loadErr });
    if (u === "/tts" && req.method === "POST") {
      const b = await readBody(req);
      if (!tts) return json(res, 503, { error: { message: loadErr || "la voix charge encore" } });
      const lang = LANGS.includes(b.lang) ? b.lang : "fr";
      return queued(async () => {
        const voice = await useLang(lang);
        const t0 = Date.now();
        const a = await voice.generateAsync({ text: String(b.text || "").slice(0, 3000), sid: +b.sid || 0, speed: +b.speed || 1 });
        log("voix : " + (a.samples.length / a.sampleRate).toFixed(1) + " s d'audio en " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
        const out = wav(a.samples, a.sampleRate);
        res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": out.length });
        res.end(out);
      });
    }
    json(res, 404, { error: { message: "inconnu : " + u } });
  });
  try {
    const sherpa = require("sherpa-onnx-node");
    const f = n => path.join(d, n);
    const lex = ["lexicon-us-en.txt", "lexicon-zh.txt"].map(f).filter(x => fs.existsSync(x)).join(",");
    kokoro = { model: f("model.onnx"), voices: f("voices.bin"), tokens: f("tokens.txt"), dataDir: f("espeak-ng-data"), lengthScale: 1.0 };
    if (lex) kokoro.lexicon = lex;
    if (fs.existsSync(f("dict"))) kokoro.dictDir = f("dict");
    mk = k => sherpa.OfflineTts.createAsync({ model: { kokoro: k, numThreads: 4, debug: false, provider: "cpu" }, maxNumSentences: 1 });
    await useLang("fr");
  } catch (e) {
    loadErr = String(e && e.message || e);
    fail("impossible de charger la voix :", loadErr);
  }
}

process.on("uncaughtException", e => { fail("plantage :", e && e.stack || e); process.exit(1); });
process.on("unhandledRejection", e => { fail("erreur :", e && e.stack || e); });
if (process.parentPort) process.parentPort.on("message", m => { if (m && m.data === "quit") process.exit(0); });

({ text: runText, image: runImage, voice: runVoice })[role]?.() ?? (fail("rôle inconnu : " + role), process.exit(1));
