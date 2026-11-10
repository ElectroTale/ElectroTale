// ElectroTale — moteur distant (option, désactivé par défaut).
// Un petit serveur local, dans l'app, qui parle comme le moteur intégré (protocole llama-server : /props, /completion…)
// et transmet chaque demande à un service compatible OpenAI (/v1/chat/completions ou /v1/completions) :
// un service en ligne, ou KoboldCpp / llama-server sur un autre PC de la maison.
// L'interface ne voit donc aucune différence, et la clé du service ne quitte jamais le processus principal.
"use strict";
const http = require("http");
const { EventEmitter } = require("events");

// balises du format « conversation » : l'interface les met autour de sa consigne (via /apply-template),
// on les retire ici et le service applique lui-même le bon format de son modèle
const U = "<|et_user|>", A = "<|et_assistant|>";

// adresse acceptée : https partout, http seulement vers ce PC ou le réseau de la maison (clé en clair sinon)
function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch (e) { return { ok: false, error: "adresse invalide" }; }
  if (u.username || u.password) return { ok: false, error: "pas d'identifiant dans l'adresse : mets la clé dans le champ prévu" };
  const h = u.hostname.toLowerCase();
  const local = h === "localhost" || h === "127.0.0.1" || h === "[::1]" || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /\.local$/.test(h) || /^[a-z0-9-]+$/.test(h);
  if (u.protocol === "https:" || (u.protocol === "http:" && local)) {
    let base = u.origin + u.pathname.replace(/\/+$/, "").replace(/\/(chat\/)?completions$/, "");
    if (!/\/v\d+$/.test(base) && !/\/v\d+\//.test(base + "/")) base += "/v1";
    return { ok: true, base };
  }
  return { ok: false, error: "il faut une adresse https:// (http:// seulement pour un PC de la maison)" };
}

function splitChat(prompt) {
  const i = prompt.indexOf(U), j = prompt.lastIndexOf(A);
  if (i < 0 || j < i) return null;
  const user = prompt.slice(i + U.length, j).trim(), pre = prompt.slice(j + A.length);
  const messages = [{ role: "user", content: user }];
  if (pre.trim()) messages.push({ role: "assistant", content: pre });   // début de réponse imposé (peu utilisé)
  return messages;
}

function start(o) {
  // o = { port, key, url, apiKey, model, ctx, log }
  const chk = checkUrl(o.url);
  if (!chk.ok) throw new Error(chk.error);
  const base = chk.base, log = o.log || (() => {});
  const auth = o.apiKey ? { Authorization: "Bearer " + o.apiKey } : {};
  const ev = new EventEmitter();
  let closed = false;

  function json(res, code, obj) {
    if (res.headersSent) return;
    res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "null" });
    res.end(JSON.stringify(obj));
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let d = ""; req.setEncoding("utf8");
      req.on("data", c => { d += c; if (d.length > 4e6) req.destroy(); });
      req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
      req.on("error", reject);
    });
  }

  async function complete(b, req, res) {
    const prompt = String(b.prompt || "");
    const messages = splitChat(prompt);
    const stops = (Array.isArray(b.stop) ? b.stop : []).filter(s => typeof s === "string" && s);
    const n = Math.max(1, Math.min(+b.n_predict || 200, 2048));
    const common = { model: o.model || undefined, max_tokens: n, temperature: +b.temperature || 0.8, top_p: +b.top_p || 1, stream: !!b.stream };
    if (stops.length) common.stop = stops.slice(0, 4);   // beaucoup de services n'en acceptent que 4 ; les autres sont coupés ici
    const extra = { top_k: +b.top_k || undefined, min_p: +b.min_p || undefined, repetition_penalty: +b.repeat_penalty || undefined };
    const endpoint = messages ? "/chat/completions" : "/completions";
    const payload = messages ? { ...common, messages } : { ...common, prompt };
    const ctrl = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ctrl.abort(); });   // l'interface a coupé (bouton Stop) : on coupe aussi là-bas
    const send = async body => fetch(base + endpoint, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Accept: b.stream ? "text/event-stream" : "application/json", ...auth,
                 "HTTP-Referer": "https://github.com/electrotale/electrotale", "X-Title": "ElectroTale" },
      body: JSON.stringify(body)
    });
    let r = await send({ ...payload, ...extra });
    if (r.status === 400 || r.status === 422) r = await send(payload);   // service qui refuse les réglages fins : sans eux
    if (!r.ok) {
      const t = (await r.text().catch(() => "")).slice(0, 300);
      log("moteur distant : erreur " + r.status + " " + t.replace(/\s+/g, " "));
      return json(res, r.status === 401 || r.status === 403 ? 401 : 502, { error: { message: "service distant : " + r.status + (r.status === 401 ? " (clé refusée)" : "") } });
    }
    const piece = d => {
      const c = d && d.choices && d.choices[0];
      if (!c) return "";
      return (c.delta && (c.delta.content || "")) || c.text || (c.message && c.message.content) || "";
    };
    // séquences d'arrêt au-delà des 4 premières : on coupe nous-mêmes, et on arrête de payer pour la suite
    const cut = full => { let k = -1; for (const s of stops) { const i = full.indexOf(s); if (i > -1 && (k < 0 || i < k)) k = i; } return k; };
    if (!b.stream) {
      const d = await r.json().catch(() => ({}));
      let t = piece(d); const k = cut(t); if (k > -1) t = t.slice(0, k);
      return json(res, 200, { content: t, stop: true });
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "null" });
    const dec = new TextDecoder();
    let buf = "", full = "", sent = 0, stopped = false;
    try {
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true }).replace(/\r/g, "");
        let i;
        while ((i = buf.indexOf("\n")) > -1) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") { stopped = true; break; }
          let d; try { d = JSON.parse(data); } catch (e) { continue; }
          full += piece(d);
          const k = cut(full);
          // on garde en réserve la fin qui pourrait être le début d'une séquence d'arrêt
          const hold = k > -1 ? k : Math.max(sent, full.length - Math.max(0, ...stops.map(s => s.length - 1)));
          if (hold > sent) { res.write("data: " + JSON.stringify({ content: full.slice(sent, hold), stop: false }) + "\n\n"); sent = hold; }
          if (k > -1) { stopped = true; full = full.slice(0, k); ctrl.abort(); break; }
        }
        if (stopped) break;
      }
    } catch (e) { if (e.name !== "AbortError") log("moteur distant : connexion coupée (" + e.message + ")"); }
    if (full.length > sent) res.write("data: " + JSON.stringify({ content: full.slice(sent), stop: false }) + "\n\n");
    res.end("data: " + JSON.stringify({ content: "", stop: true }) + "\n\n");
  }

  const srv = http.createServer(async (req, res) => {
    const host = String(req.headers.host || "").toLowerCase();
    if (host !== "127.0.0.1:" + o.port && host !== "localhost:" + o.port) { res.writeHead(403); return res.end(); }
    const origin = req.headers.origin;
    if (origin && origin !== "null" && !origin.startsWith("file://")) { res.writeHead(403); return res.end(); }
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "null", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" });
      return res.end();
    }
    if (!o.key || req.headers["x-electrotale-key"] !== o.key) { res.writeHead(401, { "Access-Control-Allow-Origin": "null" }); return res.end(); }
    const u = req.url.split("?")[0];
    try {
      if (u === "/health") return json(res, 200, { status: "ok" });
      if (u === "/props") return json(res, 200, { model_path: o.model || "distant", n_ctx: o.ctx, build_info: "electrotale-distant",
        default_generation_settings: { n_ctx: o.ctx, model: o.model || "distant" } });
      if (u === "/apply-template" && req.method === "POST") {
        const b = await readBody(req);
        const m = (b.messages || []).map(x => String(x.content || "")).join("\n\n");
        return json(res, 200, { prompt: U + m + A });
      }
      if (u === "/completion" && req.method === "POST") return await complete(await readBody(req), req, res);
      json(res, 404, { error: { message: "inconnu : " + u } });
    } catch (e) {
      if (e.name === "AbortError") { try { res.end(); } catch (x) {} return; }
      log("moteur distant : " + e.message);
      json(res, 502, { error: { message: "service distant injoignable : " + e.message } });
    }
  });
  srv.on("error", e => { log("moteur distant : port " + o.port + " indisponible (" + e.message + ")"); ev.emit("exit", 3); });
  srv.listen(o.port, "127.0.0.1");

  // test de la connexion : la liste des modèles du service (ne coûte rien)
  ev.check = async () => {
    try {
      const r = await fetch(base + "/models", { headers: { ...auth }, signal: AbortSignal.timeout(15000) });
      if (r.status === 401 || r.status === 403) return { ok: false, error: "le service refuse la clé (" + r.status + ")" };
      return { ok: true };   // 404 : certains serveurs n'ont pas la liste, ce n'est pas grave
    } catch (e) { return { ok: false, error: "service injoignable : " + (e.cause && e.cause.code || e.message) }; }
  };
  // même forme qu'un processus du moteur intégré, pour que l'arrêt marche pareil
  ev.stdin = null;
  ev.postMessage = () => {};
  ev.kill = () => { if (closed) return; closed = true; srv.close(); srv.closeAllConnections && srv.closeAllConnections(); setImmediate(() => ev.emit("exit", 0)); };
  ev.base = base;
  return ev;
}

module.exports = { start, checkUrl, U, A };
