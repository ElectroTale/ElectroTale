// ElectroTale — application de bureau
// Fenêtre Electron + moteurs (texte, images, voix) lancés en arrière-plan, invisibles.
const { app, BrowserWindow, ipcMain, dialog, shell, utilityProcess, session } = require("electron");
const { spawn, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const os = require("os");
const contenu = require("./contenu");

// clé secrète tirée au hasard à chaque lancement : les moteurs intégrés ne répondent qu'à qui la connaît (l'app elle-même)
const ENGINE_KEY = crypto.randomBytes(32).toString("hex");
const KEY_HEADER = "X-ElectroTale-Key";

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
let proc = null;              // processus KoboldCpp
let status = "stopped";       // stopped | starting | ready | external | error
let statusMsg = "";
let logTail = [];
let pollTimer = null;

const userDir = () => app.getPath("userData");
const cfgFile = () => path.join(userDir(), "moteur.json");
const engineDir = () => path.join(userDir(), "moteur");

const DEFAULT_CFG = {
  exePath: "", modelPath: "", recentModels: [],
  gpu: "auto", layers: -1, ctx: 8192, port: 5001,
  flash: false, extraArgs: "", autoStart: true,
  sdModel: "", sdOn: false, ttsModel: "", ttsWav: "", ttsOn: false, modelsDir: "",
  engine: "", llamaServer: "",
  sdServer: "", sdPort: 5002, kokoroExe: "", kokoroDir: "", voicePort: 5003, integreMigrated: false,
  installed: {}, launcherAtStart: true,
  sdGpu: "auto",   // dessin des images : "auto" (comme le texte), "gpu" (carte graphique) ou "cpu" (processeur)
  sdFlash: false, sdQuant: "", sdForceGpu: false   // accélérations du dessin, choisies par le test de vitesse
};

/* ---------- moteur intégré : tout tourne dans ElectroTale (processus internes, pas de programme externe) ---------- */
const WORKER = path.join(__dirname, "engines", "worker.js");
let bundledOk = null;
function hasBundled() {
  if (bundledOk === null) {
    try { require.resolve("node-llama-cpp", { paths: [__dirname] }); bundledOk = fs.existsSync(WORKER); }
    catch (e) { bundledOk = false; }
  }
  return bundledOk;
}
// lance un rôle du moteur intégré ; renvoie un objet compatible avec un processus enfant (stdout, stderr, exit, kill)
function forkWorker(role, opts) {
  const args = [role, JSON.stringify(opts)];
  if (utilityProcess && !process.env.KA_PLAIN_NODE) {
    let cwd;   // les bibliothèques des moteurs sont cherchées aussi dans le dossier courant
    try { if (role === "image") cwd = path.dirname(require.resolve("@stable-diffusion-cpp-node-api/" + process.platform + "-" + process.arch + "/package.json", { paths: [__dirname] })); } catch (e) {}
    return utilityProcess.fork(WORKER, args, { stdio: "pipe", cwd, env: { ...process.env, ELECTROTALE_KEY: ENGINE_KEY }, serviceName: "ElectroTale " + ({ text: "texte", image: "images", voice: "voix" })[role] });
  }
  return require("child_process").fork(WORKER, args, { stdio: ["ignore", "pipe", "pipe", "ipc"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ELECTROTALE_KEY: ENGINE_KEY } });
}
function killWorker(p) { try { p.kill(); } catch (e) {} }

// voix Kokoro livrée avec l'installateur : elle marche dès l'installation, sans téléchargement
const BUNDLED_VOICE = path.join(__dirname, "voix", "kokoro-multi-lang-v1_0");
const hasBundledVoice = () => fs.existsSync(path.join(BUNDLED_VOICE, "model.onnx"));
function loadCfg() {
  let c;
  try { c = { ...DEFAULT_CFG, ...JSON.parse(fs.readFileSync(cfgFile(), "utf8")) }; }
  catch (e) { c = { ...DEFAULT_CFG }; }
  if (hasBundled() && hasBundledVoice() && !(c.kokoroDir && fs.existsSync(path.join(c.kokoroDir, "model.onnx")))) c.kokoroDir = BUNDLED_VOICE;
  // moteur par défaut : llama.cpp, sauf si KoboldCpp était déjà configuré
  if (!c.engine) c.engine = hasBundled() ? "integre" : (c.exePath && !c.llamaServer) ? "koboldcpp" : "llamacpp";
  // une seule fois : on passe tout le monde sur le moteur intégré (on peut revenir en arrière dans Moteur)
  if (!c.integreMigrated && hasBundled()) { c.engine = "integre"; c.integreMigrated = true; try { saveCfg(c); } catch (e) {} }
  if (c.engine === "integre" && !hasBundled()) c.engine = c.llamaServer ? "llamacpp" : c.exePath ? "koboldcpp" : "llamacpp";
  return c;
}
const engineName = c => c.engine === "koboldcpp" ? "KoboldCpp" : c.engine === "integre" ? "moteur intégré" : "llama.cpp";
function saveCfg(c) {
  fs.mkdirSync(userDir(), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2));
  sdCheckSoon();
}

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }
function setStatus(s, msg) {
  status = s; statusMsg = msg || "";
  if (process.env.KA_DEBUG) console.log("STATUS", s, statusMsg);
  send("engine:status", { status, msg: statusMsg });
}
function log(line) {
  line.split(/\r?\n/).forEach(l => {
    if (!l.trim()) return;
    logTail.push(l);
    if (logTail.length > 400) logTail.shift();
    send("engine:log", l);
  });
}

/* ---------- détection GPU ---------- */
function detectGpu() {
  return new Promise(resolve => {
    execFile("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"], { windowsHide: true, timeout: 5000 },
      (err, out) => {
        if (!err && out.trim()) {
          const line = out.trim().split("\n")[0], mb = parseInt((line.split(",")[1] || "").replace(/\D/g, "")) || 0;
          return resolve({ vendor: "nvidia", name: line.split(",")[0].trim(), vramGB: Math.round(mb / 1024) });
        }
        if (process.platform !== "win32") return resolve({ vendor: "unknown", name: "" });
        execFile("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join '; '"],
          { windowsHide: true, timeout: 8000 }, (e2, o2) => {
            const name = (o2 || "").trim();
            const vendor = /nvidia/i.test(name) ? "nvidia" : /amd|radeon/i.test(name) ? "amd" : /intel/i.test(name) ? "intel" : "unknown";
            resolve({ vendor, name });
          });
      });
  });
}

/* ---------- ping de l'API ---------- */
function httpGet(port, p, timeout = 1500) {
  return new Promise(resolve => {
    const req = http.get({ host: "127.0.0.1", port, path: p, timeout, headers: { [KEY_HEADER]: ENGINE_KEY } }, res => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ code: res.statusCode, json: j }); });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}
// Renvoie le nom du modèle si un moteur (KoboldCpp ou llama.cpp) répond et est prêt, sinon null.
async function ping(port) {
  const k = await httpGet(port, "/api/v1/model");
  if (k && k.code === 200 && k.json && k.json.result) return k.json.result;
  const h = await httpGet(port, "/health");
  if (h && h.code === 200 && (!h.json || h.json.status === "ok")) {
    const pr = await httpGet(port, "/props");
    const mp = pr && pr.json && (pr.json.model_path || (pr.json.default_generation_settings || {}).model);
    return (pr && pr.json && pr.json.build_info === "electrotale-integre" ? "ElectroTale/" : "llama.cpp/") + (mp ? path.basename(String(mp)).replace(/\.gguf$/i, "") : "modèle");
  }
  return null;
}

/* ---------- démarrage / arrêt ---------- */
async function startEngine() {
  const c = loadCfg();
  if (proc) return { ok: true };
  if (c.engine === "integre") return startIntegre(c);
  const llama = c.engine !== "koboldcpp";
  const exe = llama ? c.llamaServer : c.exePath;
  if (!exe || !fs.existsSync(exe)) {
    setStatus("error", llama ? "Moteur llama.cpp pas encore installé : clique sur « Télécharger le moteur »." : "KoboldCpp introuvable : choisis le fichier ou télécharge-le.");
    return { ok: false };
  }
  if (!c.modelPath || !fs.existsSync(c.modelPath)) { setStatus("error", "Modèle introuvable : choisis un fichier .gguf."); return { ok: false }; }

  const already = await ping(c.port);
  if (already) { setStatus("external", "Un moteur tourne déjà sur le port " + c.port + " (" + already + ")."); return { ok: true }; }

  let gpu = c.gpu;
  if (gpu === "auto") { const g = await detectGpu(); gpu = g.vendor === "nvidia" ? "cuda" : (g.vendor === "unknown" ? "cpu" : "vulkan"); }
  let args;
  if (llama) {
    const ngl = gpu === "cpu" ? 0 : (c.layers < 0 ? 999 : c.layers);
    args = ["-m", c.modelPath, "--host", "127.0.0.1", "--port", String(c.port), "-c", String(c.ctx), "-ngl", String(ngl), "--jinja", "--no-webui"];
  } else {
    args = ["--model", c.modelPath, "--port", String(c.port), "--host", "127.0.0.1", "--contextsize", String(c.ctx), "--skiplauncher"];
    if (gpu === "cuda") args.push("--usecublas");
    if (gpu === "vulkan") args.push("--usevulkan");
    if (gpu !== "cpu") args.push("--gpulayers", String(c.layers));
    if (c.flash) args.push("--flashattention");
    if (c.sdOn && c.sdModel && fs.existsSync(c.sdModel)) args.push("--sdmodel", c.sdModel);
    if (c.ttsOn && c.ttsModel && fs.existsSync(c.ttsModel)) {
      args.push("--ttsmodel", c.ttsModel);
      if (c.ttsWav && fs.existsSync(c.ttsWav)) args.push("--ttswavtokenizer", c.ttsWav);
    }
  }
  if (c.extraArgs.trim()) args.push(...(c.extraArgs.match(/"[^"]*"|\S+/g) || []).map(a => a.replace(/^"|"$/g, "")));

  logTail = [];
  log("> " + path.basename(exe) + " " + args.join(" "));
  setStatus("starting", "Chargement du modèle " + path.basename(c.modelPath) + " (" + engineName(c) + ")…");
  const spawnIt = a => spawn(exe, a, { cwd: path.dirname(exe), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  try { proc = spawnIt(args); }
  catch (e) { proc = null; setStatus("error", "Impossible de lancer " + engineName(c) + " : " + e.message); return { ok: false }; }
  // anciennes versions de llama-server sans --no-webui : on relance sans
  if (llama) {
    let early = "";
    const sniff = d => { early += d.toString(); };
    proc.stderr.on("data", sniff); proc.stdout.on("data", sniff);
    proc.once("exit", code => {
      if (code !== 0 && /no-webui/.test(early) && /(invalid|unknown) argument/i.test(early)) {
        log("(option --no-webui inconnue, relance sans)");
        setTimeout(() => { if (!proc) { const a2 = args.filter(x => x !== "--no-webui"); try { proc = spawnIt(a2); wire(proc, c); } catch (e) {} } }, 300);
      }
    });
  }
  wire(proc, c);
  return { ok: true };
}
async function startIntegre(c) {
  if (!c.modelPath || !fs.existsSync(c.modelPath)) { setStatus("error", "Modèle introuvable : choisis un fichier .gguf (ou télécharge-en un)."); return { ok: false }; }
  const already = await ping(c.port);
  if (already) { setStatus("external", "Un moteur tourne déjà sur le port " + c.port + " (" + already + ")."); return { ok: true }; }
  logTail = [];
  log("> moteur intégré : " + path.basename(c.modelPath) + " (contexte " + c.ctx + ")");
  setStatus("starting", "Chargement du modèle " + path.basename(c.modelPath) + "…");
  try { proc = forkWorker("text", { port: c.port, modelPath: c.modelPath, ctx: c.ctx, gpu: c.gpu, layers: c.layers, flash: c.flash }); }
  catch (e) { proc = null; setStatus("error", "Impossible de lancer le moteur intégré : " + e.message); return { ok: false }; }
  wire(proc, c);
  return { ok: true };
}
function wire(me, c) {
  {
  me.stdout.on("data", d => log(d.toString()));
  me.stderr.on("data", d => log(d.toString()));
  me.on("error", e => { log("Erreur : " + e.message); });
  me.on("exit", code => {
    if (proc !== me) return;
    proc = null; clearInterval(pollTimer);
    const why = (logTail.slice().reverse().find(l => /impossible|error|erreur|failed/i.test(l)) || "").replace(/^\[text\]\s*/, "");
    if (status !== "stopped") setStatus(code === 0 ? "stopped" : "error",
      code === 0 ? "Moteur arrêté." : (why ? why + " — " : "Le moteur s'est arrêté (code " + code + "). ") + "Regarde le journal : souvent pas assez de mémoire → baisse les couches GPU ou le contexte, ou prends un modèle plus petit.");
  });
  const t0 = Date.now();
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!proc) return clearInterval(pollTimer);
    const name = await ping(c.port);
    if (name) { clearInterval(pollTimer); setStatus("ready", name); }
    else if (Date.now() - t0 > 15 * 60 * 1000) { clearInterval(pollTimer); setStatus("error", "Le moteur ne répond pas après 15 minutes."); }
  }, 1000);
  }
}

function stopEngine() {
  return new Promise(resolve => {
    clearInterval(pollTimer);
    if (!proc) { if (status !== "external") setStatus("stopped", "Moteur arrêté."); return resolve(); }
    const p = proc;
    setStatus("stopped", "Moteur arrêté.");
    p.once("exit", () => resolve());
    if (!p.stdin && typeof p.postMessage === "function") killWorker(p);          // moteur intégré
    else if (process.platform === "win32" && p.pid) execFile("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true }, () => {});
    else p.kill("SIGTERM");
    setTimeout(resolve, 4000);
  });
}

/* ---------- versions GitHub : la plus récente qui contient vraiment le bon fichier ---------- */
async function latestWithAssets(repo, test) {
  const list = await getJson("https://api.github.com/repos/" + repo + "/releases?per_page=15");
  if (!Array.isArray(list)) {
    const m = (list && list.message) || "réponse inattendue";
    throw new Error("GitHub : " + m + (/rate limit/i.test(m) ? " — trop de demandes depuis ta connexion, réessaie dans une heure" : ""));
  }
  const rel = list.find(r => !r.draft && (r.assets || []).some(a => test(a.name)));
  if (!rel) throw new Error("aucune version récente de " + repo.split("/")[1] + " ne contient de fichier pour ton système");
  return rel;
}
const WIN = process.platform === "win32";

/* ---------- téléchargement de KoboldCpp ---------- */
function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "electrotale", Accept: "application/vnd.github+json" } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return getJson(res.headers.location).then(resolve, reject);
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}
function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "electrotale" } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return download(res.headers.location, dest, onProgress).then(resolve, reject);
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      const total = +res.headers["content-length"] || 0; let got = 0;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = dest + ".part", out = fs.createWriteStream(tmp);
      res.on("data", c => { got += c.length; onProgress(got, total); });
      res.pipe(out);
      out.on("finish", () => out.close(() => { fs.renameSync(tmp, dest); resolve(dest); }));
      out.on("error", reject);
    }).on("error", reject);
  });
}
async function downloadKobold(variant) {
  if (process.platform !== "win32") throw new Error("Le téléchargement auto est prévu pour Windows. Télécharge KoboldCpp à la main pour ton système.");
  const rel = await latestWithAssets("LostRuins/koboldcpp", n => /\.exe$/i.test(n));
  const assets = (rel.assets || []).filter(a => /\.exe$/i.test(a.name));
  if (!assets.length) throw new Error("Aucun fichier .exe trouvé dans la dernière version.");
  if (variant === "auto") { const g = await detectGpu(); variant = g.vendor === "nvidia" ? "cuda" : "nocuda"; }
  const pick = {
    cuda:   ["koboldcpp_cu12.exe", "koboldcpp.exe"],
    nocuda: ["koboldcpp_nocuda.exe", "koboldcpp.exe"],
    oldcpu: ["koboldcpp_oldcpu.exe", "koboldcpp_nocuda.exe", "koboldcpp.exe"]
  }[variant] || ["koboldcpp.exe"];
  const asset = pick.map(n => assets.find(a => a.name.toLowerCase() === n)).find(Boolean) || assets[0];
  fs.mkdirSync(engineDir(), { recursive: true });
  const dest = path.join(engineDir(), asset.name);
  setStatus("stopped", "Téléchargement de " + asset.name + " (" + rel.tag_name + ")…");
  await download(asset.browser_download_url, dest, (g, t) => send("engine:progress", { got: g, total: t, name: asset.name }));
  const c = loadCfg(); c.exePath = dest; saveCfg(c);
  setStatus("stopped", asset.name + " " + rel.tag_name + " téléchargé.");
  return { path: dest, version: rel.tag_name };
}

/* ---------- modèles : Hugging Face + téléchargements ---------- */
const modelsDir = () => { const c = loadCfg(); return c.modelsDir || path.join(userDir(), "modeles"); };
let dlReq = null, dlFile = null;
ipcMain.handle("hf:list", async (e, repo) => {
  repo = String(repo || "").trim().replace(/^https?:\/\/huggingface\.co\//, "").replace(/\/(tree|blob|resolve)\/.*$/, "").replace(/\/+$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { ok: false, error: "Nom de dépôt invalide (format : auteur/nom)." };
  try {
    const list = await getJson("https://huggingface.co/api/models/" + repo + "/tree/main?recursive=true");
    if (!Array.isArray(list)) return { ok: false, error: (list && list.error) || "Dépôt introuvable." };
    const files = list.filter(f => f.type === "file" && /\.(gguf|safetensors)$/i.test(f.path))
      .map(f => ({ path: f.path, size: (f.lfs && f.lfs.size) || f.size || 0 }));
    return { ok: true, repo, files };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle("dl:start", async (e, { repo, file, url, kind }) => {
  if (dlReq) return { ok: false, error: "Un téléchargement est déjà en cours." };
  const src = url || ("https://huggingface.co/" + repo + "/resolve/main/" + file.split("/").map(encodeURIComponent).join("/") + "?download=true");
  const name = path.basename(file || new URL(src).pathname);
  const dir = modelsDir(); fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, name);
  if (fs.existsSync(dest)) { applyDownloaded(dest, kind); return { ok: true, path: dest, existed: true }; }
  dlFile = dest;
  try {
    await downloadCancelable(src, dest, (g, t) => send("dl:progress", { got: g, total: t, name }));
    applyDownloaded(dest, kind);
    return { ok: true, path: dest };
  } catch (err) { return { ok: false, error: err.message }; }
  finally { dlReq = null; dlFile = null; }
});
ipcMain.handle("dl:cancel", () => { if (dlReq) { dlReq.destroy(new Error("Téléchargement annulé.")); } return true; });
ipcMain.handle("dl:pickDir", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Dossier des modèles", properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  const c = loadCfg(); c.modelsDir = r.filePaths[0]; saveCfg(c); return c;
});
function applyDownloaded(p, kind) {
  const c = loadCfg();
  if (kind === "sd") { c.sdModel = p; c.sdOn = true; }
  else if (kind === "tts") { c.ttsModel = p; c.ttsOn = true; }
  else if (kind === "ttswav") { c.ttsWav = p; }
  else { c.modelPath = p; c.recentModels = [p, ...c.recentModels.filter(x => x !== p)].slice(0, 6); }
  saveCfg(c);
}
function downloadCancelable(url, dest, onProgress, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 8) return reject(new Error("Trop de redirections."));
    const req = https.get(url, { headers: { "User-Agent": "electrotale" } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadCancelable(new URL(res.headers.location, url).toString(), dest, onProgress, depth + 1).then(resolve, reject);
      }
      if (res.statusCode === 401 || res.statusCode === 403) return reject(new Error("Accès refusé : ce modèle demande d'accepter sa licence sur huggingface.co (ou un compte)."));
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      const total = +res.headers["content-length"] || 0; let got = 0, last = 0;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = dest + ".part", out = fs.createWriteStream(tmp);
      res.on("data", c => { got += c.length; const now = Date.now(); if (now - last > 300) { last = now; onProgress(got, total); } });
      res.on("error", err => { out.destroy(); try { fs.unlinkSync(tmp); } catch (e) {} reject(err); });
      res.pipe(out);
      out.on("finish", () => out.close(() => {
        if (total && got < total) { try { fs.unlinkSync(tmp); } catch (e) {} return reject(new Error("Téléchargement incomplet.")); }
        fs.renameSync(tmp, dest); onProgress(got, total); resolve(dest);
      }));
      out.on("error", reject);
    });
    dlReq = req;
    req.on("error", err => { try { fs.unlinkSync(dest + ".part"); } catch (e) {} reject(err); });
  });
}
ipcMain.handle("engine:pickExtra", async (e, kind) => {
  const r = await dialog.showOpenDialog(win, { title: kind === "sd" ? "Modèle d'images" : "Modèle de voix", properties: ["openFile"],
    filters: [{ name: "Modèles", extensions: ["gguf", "safetensors", "ckpt"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  applyDownloaded(r.filePaths[0], kind); return loadCfg();
});

/* ---------- stockage des aventures (fichiers) ---------- */
const dataDir = () => path.join(userDir(), "donnees");
const keyFile = k => path.join(dataDir(), String(k).replace(/[^\w.-]/g, "_") + ".json");
ipcMain.on("store:get", (e, k) => { try { e.returnValue = fs.readFileSync(keyFile(k), "utf8"); } catch (err) { e.returnValue = null; } });
ipcMain.on("store:set", (e, k, v) => {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const f = keyFile(k);
    if (fs.existsSync(f)) fs.copyFileSync(f, f + ".bak");   // copie de secours de la version précédente
    fs.writeFileSync(f + ".tmp", v);
    fs.renameSync(f + ".tmp", f);
    e.returnValue = true;
  } catch (err) { e.returnValue = false; }
});
ipcMain.on("store:del", (e, k) => { try { fs.unlinkSync(keyFile(k)); } catch (err) {} e.returnValue = true; });
ipcMain.handle("store:openDir", () => { fs.mkdirSync(dataDir(), { recursive: true }); shell.openPath(dataDir()); });

/* ---------- téléchargement de llama.cpp ---------- */
function unzip(zip, dir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(dir, { recursive: true });
    const cmd = process.platform === "win32"
      ? ["powershell", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`]]
      : ["unzip", ["-o", "-q", zip, "-d", dir]];
    execFile(cmd[0], cmd[1], { windowsHide: true, timeout: 10 * 60 * 1000 }, err => err ? reject(new Error("extraction impossible : " + err.message)) : resolve());
  });
}
function findFile(dir, name) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { const r = findFile(p, name); if (r) return r; }
    else if (f.name.toLowerCase() === name) return p;
  }
  return null;
}
async function downloadLlama(variant) {
  const lplat = WIN ? "win" : process.platform === "darwin" ? "macos" : "ubuntu";
  const rel = await latestWithAssets("ggml-org/llama.cpp", n => new RegExp("bin-" + lplat + "-(vulkan|cpu|cuda[\\d.-]*)?-?x64\\.(zip|tar\\.gz)$", "i").test(n) && !/^cudart/i.test(n));
  const assets = (rel.assets || []).filter(a => /\.zip$/i.test(a.name));
  if (!assets.length) throw new Error("aucun fichier trouvé dans la version " + rel.tag_name + " de llama.cpp.");
  if (variant === "auto") { const g = await detectGpu(); variant = g.vendor === "nvidia" ? "cuda" : g.vendor === "unknown" ? "cpu" : "vulkan"; }
  const plat = process.platform === "win32" ? "win" : process.platform === "darwin" ? "macos" : "ubuntu";
  const pick = re => assets.filter(a => re.test(a.name) && !/^cudart/i.test(a.name)).sort((a, b) => b.name.localeCompare(a.name))[0];
  let main = null, extra = null;
  if (variant === "cuda") {
    main = pick(new RegExp(`bin-${plat}-cuda-12[\\d.]*-x64\\.zip$`, "i")) || pick(new RegExp(`bin-${plat}-cuda.*x64\\.zip$`, "i"));
    if (main) {
      const ver = (main.name.match(/cuda-([\d.]+)/i) || [])[1];
      extra = assets.find(a => /^cudart/i.test(a.name) && ver && a.name.includes("cuda-" + ver)) || assets.find(a => /^cudart.*cuda-12/i.test(a.name));
    }
  }
  if (!main && variant !== "cpu") main = pick(new RegExp(`bin-${plat}-vulkan-x64\\.zip$`, "i"));
  if (!main) main = pick(new RegExp(`bin-${plat}-(cpu|avx2)-x64\\.zip$`, "i")) || pick(new RegExp(`bin-${plat}.*x64\\.zip$`, "i"));
  if (!main) throw new Error("pas de version de llama.cpp pour ce système.");
  const dir = path.join(engineDir(), "llama.cpp-" + rel.tag_name);
  fs.mkdirSync(engineDir(), { recursive: true });
  for (const a of [main, extra].filter(Boolean)) {
    const zip = path.join(engineDir(), a.name);
    setStatus("stopped", "Téléchargement de " + a.name + "…");
    await download(a.browser_download_url, zip, (g, t) => send("engine:progress", { got: g, total: t, name: a.name }));
    setStatus("stopped", "Extraction de " + a.name + "…");
    await unzip(zip, dir);
    try { fs.unlinkSync(zip); } catch (e) {}
  }
  const exe = findFile(dir, process.platform === "win32" ? "llama-server.exe" : "llama-server");
  if (!exe) throw new Error("llama-server introuvable dans l'archive.");
  // les DLL CUDA doivent être à côté de llama-server.exe
  if (extra) for (const f of fs.readdirSync(dir)) {
    if (/\.dll$/i.test(f) && !fs.existsSync(path.join(path.dirname(exe), f))) try { fs.copyFileSync(path.join(dir, f), path.join(path.dirname(exe), f)); } catch (e) {}
  }
  const c = loadCfg(); c.llamaServer = exe; c.engine = "llamacpp"; saveCfg(c);
  setStatus("stopped", "llama.cpp " + rel.tag_name + " installé (" + main.name.replace(/^llama-[^-]+-bin-/, "").replace(/\.zip$/, "") + ").");
  return { path: exe, version: rel.tag_name };
}

/* ---------- images autonomes : sd-server (stable-diffusion.cpp) ---------- */
let sdProc = null, sdStatus = "stopped";
// réglages avec lesquels le moteur d'images a été lancé : s'ils changent (autre modèle, carte ↔ processeur), on le relance
let sdSig = "";
const sdGpuOf = c => c.sdGpu === "cpu" ? "cpu" : c.sdGpu === "gpu" ? "auto" : c.gpu;
const sdSigOf = c => JSON.stringify([!!c.sdOn, c.sdModel || "", sdGpuOf(c), !!c.sdFlash, c.sdQuant || "", !!c.sdForceGpu]);
let sdCheckTimer = null, sdChecking = null;
function sdCheckSoon() { clearTimeout(sdCheckTimer); sdCheckTimer = setTimeout(() => sdCheck().catch(e => log("[images] " + e.message)), 250); }
async function sdCheck() {
  if (sdChecking) { await sdChecking; return sdCheck(); }
  const c = loadCfg();
  if (!sdSig || sdSigOf(c) === sdSig || c.engine === "koboldcpp") return;   // jamais lancé : il partira avec « Démarrer »
  sdChecking = (async () => {
    if (sdProc) { log("[images] " + (c.sdOn ? "réglages changés : on relance le moteur d'images avec " + path.basename(c.sdModel || "") : "images désactivées : moteur d'images arrêté")); await stopSd(); }
    if (c.sdOn) await startSd(); else sdSig = sdSigOf(c);
  })();
  try { await sdChecking; } finally { sdChecking = null; }
}
function sdSet(st, msg){ sdStatus = st; log("[images] " + msg); send("sd:status", { status: st, msg }); }
async function sdPing(port){
  const r = await httpGet(port, "/sdapi/v1/samplers", 1500);
  return !!(r && r.code === 200);
}
async function startSd(){
  const c = loadCfg();
  sdSig = sdSigOf(c);
  if (sdProc || c.engine === "koboldcpp" || !c.sdOn) return;
  if (!c.sdModel || !fs.existsSync(c.sdModel)) { sdSet("error", "modèle d'images introuvable"); return; }
  if (await sdPing(c.sdPort)) { sdSet("ready", "moteur d'images déjà lancé sur le port " + c.sdPort); return; }
  if (c.engine === "integre" || (hasBundled() && (!c.sdServer || !fs.existsSync(c.sdServer)))) return startSdIntegre(c);
  if (!c.sdServer || !fs.existsSync(c.sdServer)) { sdSet("error", "moteur d'images pas installé (Menu → Moteur → Images → Installer)"); return; }
  let gpu = sdGpuOf(c);
  const variants = [
    ["-m", c.sdModel, "--listen-ip", "127.0.0.1", "--listen-port", String(c.sdPort)],
    ["-m", c.sdModel, "--host", "127.0.0.1", "--port", String(c.sdPort)]
  ];
  if (gpu === "cpu") variants.forEach(v => v.push("--offload-to-cpu"));
  let tries = 0;
  const launch = () => {
    const args = variants[tries];
    log("[images] > " + path.basename(c.sdServer) + " " + args.join(" "));
    let early = "";
    try { sdProc = spawn(c.sdServer, args, { cwd: path.dirname(c.sdServer), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { sdProc = null; sdSet("error", "impossible de lancer le moteur d'images : " + e.message); return; }
    const me = sdProc;
    const onData = d => { const t = d.toString(); early += t; t.split(/\r?\n/).filter(x => x.trim()).forEach(x => log("[images] " + x)); };
    me.stdout.on("data", onData); me.stderr.on("data", onData);
    me.on("exit", code => {
      if (sdProc !== me) return;
      sdProc = null;
      if (code !== 0 && tries < variants.length - 1 && /(unknown|invalid|unrecognized).{0,40}(argument|option)|listen/i.test(early)) { tries++; return launch(); }
      if (sdStatus !== "stopped") sdSet(code === 0 ? "stopped" : "error", code === 0 ? "moteur d'images arrêté" : "le moteur d'images s'est arrêté (code " + code + ") — souvent pas assez de mémoire GPU");
    });
    sdSet("starting", "chargement du modèle d'images " + path.basename(c.sdModel) + "…");
    const t0 = Date.now();
    const iv = setInterval(async () => {
      if (sdProc !== me) return clearInterval(iv);
      if (await sdPing(c.sdPort)) { clearInterval(iv); sdSet("ready", "moteur d'images prêt"); }
      else if (Date.now() - t0 > 10 * 60 * 1000) { clearInterval(iv); sdSet("error", "le moteur d'images ne répond pas"); }
    }, 1500);
  };
  launch();
}
function startSdIntegre(c) {
  sdSet("starting", "chargement du modèle d'images " + path.basename(c.sdModel) + "…");
  let me;
  try { me = sdProc = forkWorker("image", { port: c.sdPort, modelPath: c.sdModel, gpu: sdGpuOf(c), vaeTiling: true, flash: !!c.sdFlash, quant: c.sdQuant || "", forceGpu: !!c.sdForceGpu }); }
  catch (e) { sdProc = null; sdSet("error", "impossible de lancer le moteur d'images : " + e.message); return; }
  let lastErr = "";
  const onData = d => d.toString().split(/\r?\n/).filter(x => x.trim()).forEach(x => { if (/impossible|failed|error/i.test(x)) lastErr = x.replace(/^\[image\]\s*/, ""); log(/^\[image\]/.test(x) ? x.replace(/^\[image\]/, "[images]") : "[images] " + x); });
  me.stdout && me.stdout.on("data", onData); me.stderr && me.stderr.on("data", onData);
  me.on("exit", code => {
    if (sdProc !== me) return;
    sdProc = null;
    if (sdStatus !== "stopped") sdSet(code === 0 ? "stopped" : "error", code === 0 ? "moteur d'images arrêté" : (/from file|inspect model|version|loading failed/i.test(lastErr) ? "ce fichier n'est pas un modèle d'images lisible (prends un .gguf ou .safetensors Stable Diffusion)" : (lastErr || "le moteur d'images s'est arrêté (code " + code + ")") + " — souvent pas assez de mémoire, essaie un modèle plus petit"));
  });
  const t0 = Date.now();
  const iv = setInterval(async () => {
    if (sdProc !== me) return clearInterval(iv);
    if (await sdPing(c.sdPort)) { clearInterval(iv); sdSet("ready", "moteur d'images prêt"); }
    else if (Date.now() - t0 > 15 * 60 * 1000) { clearInterval(iv); sdSet("error", "le moteur d'images ne répond pas"); }
  }, 1500);
}
// renvoie une promesse tenue quand l'ancien moteur est vraiment fermé (sinon le nouveau trouverait le port encore pris)
function stopSd(){
  if (!sdProc) return Promise.resolve();
  const p = sdProc; sdProc = null; sdStatus = "stopped";
  const gone = new Promise(r => { p.once("exit", r); setTimeout(r, 8000); });
  if (!p.stdin && typeof p.postMessage === "function") killWorker(p);
  else if (process.platform === "win32") execFile("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true }, () => {});
  else p.kill("SIGTERM");
  send("sd:status", { status: "stopped", msg: "" });
  return gone;
}
async function downloadSd(variant) {
  const rel = await latestWithAssets("leejet/stable-diffusion.cpp", n => (WIN ? /win/i : /linux|ubuntu|macos|osx/i).test(n) && /x64|x86_64|amd64/i.test(n) && /\.zip$/i.test(n) && !/^cudart/i.test(n));
  const assets = (rel.assets || []).filter(a => /\.zip$/i.test(a.name));
  if (!assets.length) throw new Error("aucun fichier dans la dernière version de stable-diffusion.cpp.");
  if (variant === "auto") { const g = await detectGpu(); variant = g.vendor === "nvidia" ? "cuda" : g.vendor === "unknown" ? "cpu" : "vulkan"; }
  const plat = process.platform === "win32" ? "win" : process.platform === "darwin" ? "macos|osx" : "linux|ubuntu";
  const okPlat = n => new RegExp(`(${plat})`, "i").test(n) && /x64|x86_64|amd64/i.test(n) && !/^cudart/i.test(n);
  const pick = re => assets.filter(a => okPlat(a.name) && re.test(a.name)).sort((a, b) => b.name.localeCompare(a.name))[0];
  let main = null, extra = null;
  if (variant === "cuda") {
    main = pick(/cuda ?12|cu12/i) || pick(/cuda/i);
    if (main) extra = assets.find(a => /^cudart/i.test(a.name) && /win/i.test(a.name) && /12/.test(a.name));
  }
  if (!main && variant !== "cpu") main = pick(/vulkan/i);
  if (!main) main = pick(/avx2/i) || pick(/avx/i) || pick(/cpu|noavx/i) || assets.find(a => okPlat(a.name));
  if (!main) throw new Error("pas de version de stable-diffusion.cpp pour ce système.");
  fs.mkdirSync(engineDir(), { recursive: true });
  const dir = path.join(engineDir(), "sd.cpp-" + rel.tag_name);
  for (const a of [main, extra].filter(Boolean)) {
    const zip = path.join(engineDir(), a.name);
    send("sd:status", { status: "stopped", msg: "Téléchargement de " + a.name + "…" });
    await download(a.browser_download_url, zip, (g, t) => send("engine:progress", { got: g, total: t, name: a.name }));
    await unzip(zip, dir);
    try { fs.unlinkSync(zip); } catch (e) {}
  }
  const exe = findFile(dir, process.platform === "win32" ? "sd-server.exe" : "sd-server");
  if (!exe) throw new Error("cette version de stable-diffusion.cpp ne contient pas sd-server.");
  if (extra) for (const f of fs.readdirSync(dir)) {
    if (/\.dll$/i.test(f) && !fs.existsSync(path.join(path.dirname(exe), f))) try { fs.copyFileSync(path.join(dir, f), path.join(path.dirname(exe), f)); } catch (e) {}
  }
  const c = loadCfg(); c.sdServer = exe; saveCfg(c);
  return { path: exe, version: rel.tag_name };
}

/* ---------- voix Kokoro (sherpa-onnx) ---------- */
const voiceDir = () => path.join(userDir(), "voix");
function untar(file, dir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(dir, { recursive: true });
    execFile("tar", ["-xf", file, "-C", dir], { windowsHide: true, timeout: 15 * 60 * 1000 }, err => err ? reject(new Error("extraction impossible : " + err.message)) : resolve());
  });
}
function findDirWith(dir, name, depth = 0) {
  if (depth > 4) return null;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.isFile() && f.name === name) return dir;
  }
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) { const r = findDirWith(path.join(dir, f.name), name, depth + 1); if (r) return r; }
  }
  return null;
}
async function downloadKokoro() {
  const dir = voiceDir(); fs.mkdirSync(dir, { recursive: true });
  let exe = "";
  if (!hasBundled()) {
  // 1) le programme sherpa-onnx
  const rel = await latestWithAssets("k2-fsa/sherpa-onnx", n => (WIN ? /win-x64/i : /linux-x64|osx/i).test(n) && /\.tar\.bz2$/i.test(n) && !/cuda|gpu|jni|lib|wasm|android|ios|no-tts|whisper|java|dotnet|go-/i.test(n));
  const plat = process.platform === "win32" ? "win-x64" : process.platform === "darwin" ? "osx-universal2|osx-x64" : "linux-x64";
  const cand = (rel.assets || []).filter(a => new RegExp(`(${plat})`, "i").test(a.name) && /\.tar\.bz2$/i.test(a.name) && !/cuda|gpu|jni|lib|wasm|android|ios|no-tts|whisper|java|dotnet|go-/i.test(a.name));
  const exeAsset = cand.find(a => /static/i.test(a.name)) || cand.find(a => /shared/i.test(a.name)) || cand[0];
  if (!exeAsset) throw new Error("pas de version de sherpa-onnx pour ce système.");
  const tmp1 = path.join(dir, exeAsset.name);
  send("tts:progress", { msg: "Téléchargement du programme de voix…" });
  await download(exeAsset.browser_download_url, tmp1, (g, t) => send("engine:progress", { got: g, total: t, name: exeAsset.name }));
  await untar(tmp1, dir); try { fs.unlinkSync(tmp1); } catch (e) {}
  const exeName = process.platform === "win32" ? "sherpa-onnx-offline-tts.exe" : "sherpa-onnx-offline-tts";
  exe = findFile(dir, exeName);
  if (!exe) throw new Error("sherpa-onnx-offline-tts introuvable dans l'archive.");
  }
  // 2) le modèle Kokoro multi-langue (avec la voix française ff_siwis)
  const url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2";
  const tmp2 = path.join(dir, "kokoro-multi-lang-v1_0.tar.bz2");
  send("tts:progress", { msg: "Téléchargement du modèle Kokoro (≈ 330 Mo)…" });
  await download(url, tmp2, (g, t) => send("engine:progress", { got: g, total: t, name: "Kokoro" }));
  await untar(tmp2, dir); try { fs.unlinkSync(tmp2); } catch (e) {}
  const mdir = findDirWith(dir, "voices.bin");
  if (!mdir) throw new Error("modèle Kokoro incomplet.");
  const c = loadCfg(); c.kokoroExe = exe; c.kokoroDir = mdir; saveCfg(c);
  stopVoice();
  return { exe, dir: mdir };
}
/* voix intégrée : un processus interne qui garde Kokoro en mémoire (rapide après la 1re phrase) */
let voiceProc = null, voicePort = 0;
function stopVoice() { if (voiceProc) { const p = voiceProc; voiceProc = null; killWorker(p); } }
function httpPostBin(port, p, body, timeout) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port, path: p, method: "POST", timeout, headers: { "Content-Type": "application/json", "Content-Length": data.length, [KEY_HEADER]: ENGINE_KEY } }, res => {
      const ch = []; res.on("data", c => ch.push(c));
      res.on("end", () => resolve({ code: res.statusCode, body: Buffer.concat(ch) }));
    });
    req.on("error", reject); req.on("timeout", () => { req.destroy(new Error("la voix met trop de temps")); });
    req.end(data);
  });
}
// langues de l'histoire que la voix sait lire (code espeak-ng passé à Kokoro)
const KOKORO_LANGS = { fr: "fr", en: "en-us", es: "es", it: "it", de: "de", pt: "pt-br" };
const kokoroLang = l => KOKORO_LANGS[l] || "fr";
async function kokoroSpeakIntegre(text, sid, lang) {
  const c = loadCfg();
  if (!c.kokoroDir || !fs.existsSync(path.join(c.kokoroDir, "model.onnx"))) throw new Error("voix Kokoro pas installée");
  if (!voiceProc) {
    voicePort = +c.voicePort || 5003;
    const me = voiceProc = forkWorker("voice", { port: voicePort, kokoroDir: c.kokoroDir });
    const onData = d => d.toString().split(/\r?\n/).filter(x => x.trim()).forEach(x => log(/^\[voice\]/.test(x) ? x.replace(/^\[voice\]/, "[voix]") : "[voix] " + x));
    me.stdout && me.stdout.on("data", onData); me.stderr && me.stderr.on("data", onData);
    me.on("exit", () => { if (voiceProc === me) voiceProc = null; });
  }
  const t0 = Date.now();
  for (;;) {
    const h = await httpGet(voicePort, "/health", 1500);
    if (h && h.code === 200) break;
    if (h && h.json && h.json.status === "error") { stopVoice(); throw new Error(h.json.error || "la voix ne se charge pas"); }
    if (!voiceProc) throw new Error("la voix s'est arrêtée (regarde le journal du moteur)");
    if (Date.now() - t0 > 90000) throw new Error("la voix ne répond pas");
    await new Promise(r => setTimeout(r, 400));
  }
  const r = await httpPostBin(voicePort, "/tts", { text, sid: sid || 30, speed: 1, lang: kokoroLang(lang) }, 180000);
  if (r.code !== 200) { let m = "erreur " + r.code; try { m = JSON.parse(r.body.toString()).error.message; } catch (e) {} throw new Error(m); }
  return "data:audio/wav;base64," + r.body.toString("base64");
}
let kokoroNoLang = false;
function kokoroSpeak(text, sid, lang) {
  if (hasBundled()) return kokoroSpeakIntegre(text, sid, lang);
  return new Promise((resolve, reject) => {
    const c = loadCfg();
    if (!c.kokoroExe || !fs.existsSync(c.kokoroExe) || !c.kokoroDir) return reject(new Error("voix Kokoro pas installée"));
    const d = c.kokoroDir, out = path.join(app.getPath("temp"), "electrotale-voix-" + Date.now() + ".wav");
    const lex = ["lexicon-us-en.txt", "lexicon-zh.txt"].map(f => path.join(d, f)).filter(f => fs.existsSync(f)).join(",");
    const args = ["--debug=0", "--kokoro-model=" + path.join(d, "model.onnx"), "--kokoro-voices=" + path.join(d, "voices.bin"),
      "--kokoro-tokens=" + path.join(d, "tokens.txt"), "--kokoro-data-dir=" + path.join(d, "espeak-ng-data"),
      "--num-threads=4", "--sid=" + (sid || 30), "--output-filename=" + out];
    if (lex) args.push("--kokoro-lexicon=" + lex);
    if (fs.existsSync(path.join(d, "dict"))) args.push("--kokoro-dict-dir=" + path.join(d, "dict"));
    if (!kokoroNoLang) args.push("--kokoro-lang=" + kokoroLang(lang));
    args.push(text);
    const run = a => execFile(c.kokoroExe, a, { windowsHide: true, timeout: 120000, maxBuffer: 1 << 24 }, (err, so, se) => {
      if (err) {
        const msg = String(se || "") + String(so || "");
        if (!kokoroNoLang && /kokoro-lang|kokoro-dict-dir|unknown|invalid/i.test(msg)) {
          kokoroNoLang = true;
          return run(a.filter(x => !/^--kokoro-lang=|^--kokoro-dict-dir=/.test(x)));
        }
        return reject(new Error(msg.split(/\r?\n/).filter(Boolean).slice(-2).join(" ") || err.message));
      }
      try { const b = fs.readFileSync(out); fs.unlinkSync(out); resolve("data:audio/wav;base64," + b.toString("base64")); }
      catch (e) { reject(new Error("pas de fichier audio produit")); }
    });
    run(args);
  });
}

/* ---------- lanceur : analyse du PC, IA conseillées, installation automatique ---------- */
// Tous les modèles proposés sont sans censure : c'est la marque de fabrique d'ElectroTale.
// Les tailles sont indicatives ; la taille exacte et l'empreinte du fichier viennent de Hugging Face au moment du téléchargement.
const LAUNCH_CATALOG = {
  text: [
    { id: "llama32-3b", name: "Llama 3.2 3B", repo: "MaziyarPanahi/Llama-3.2-3B-Instruct-abliterated-GGUF", quants: ["Q5_K_M", "Q4_K_M", "Q6_K"], sizeGB: 2.3, needGB: 4,
      note: "Léger et rapide. Pour les petits PC ou sans carte graphique. Français correct." },
    { id: "llama31-8b", name: "Llama 3.1 8B", repo: "bartowski/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF", quants: ["Q4_K_M", "Q4_K_S", "Q5_K_M"], sizeGB: 4.9, needGB: 6,
      note: "Le bon équilibre : bon conteur, suit bien les règles du Conteur." },
    { id: "rocinante-12b", name: "Rocinante 12B", repo: "TheDrummer/Rocinante-12B-v1.1-GGUF", quants: ["Q4_K_M", "Q4_K_S", "Q5_K_M"], sizeGB: 7.5, needGB: 10,
      note: "Entraîné pour l'aventure et le jeu de rôle. Base Mistral : français naturel." },
    { id: "nemo-12b", name: "Mistral Nemo 12B", repo: "QuantFactory/Mistral-Nemo-Instruct-2407-abliterated-GGUF", quants: ["Q4_K_M", "Q4_K_S"], sizeGB: 7.5, needGB: 10,
      note: "Très bon en français, grand contexte. Licence Apache 2.0, la plus libre." },
    { id: "mistral-small-24b", name: "Mistral Small 24B", repo: "bartowski/huihui-ai_Mistral-Small-24B-Instruct-2501-abliterated-GGUF", quants: ["Q4_K_M", "Q4_K_S", "IQ4_XS"], sizeGB: 14.3, needGB: 16,
      note: "Haut de gamme, très bon français. Pour les grosses cartes graphiques." }
  ],
  sd: [
    { id: "lcm-dreamshaper", name: "DreamShaper rapide (LCM)", repo: "Steward/lcm-dreamshaper-v7-gguf", quants: ["Q8_0", "F16"], sizeGB: 2.1, needGB: 3,
      note: "Le plus rapide : une image en 4 à 6 étapes au lieu de 20, style illustration fantasy. Idéal pour une carte intégrée (Intel, AMD)." },
    { id: "sd15", name: "Stable Diffusion 1.5", repo: "second-state/stable-diffusion-v1-5-GGUF", quants: ["Q8_0"], sizeGB: 1.8, needGB: 3,
      note: "Le classique, léger, 20 étapes par image : plus lent que la version rapide." },
    { id: "dreamshaper-xl", name: "DreamShaper XL", repo: "koboldcpp/imgmodel", file: "dreamshaperXL_v2_q4_k.gguf", sizeGB: 3.5, needGB: 8,
      note: "Style illustration fantasy, plus beau mais plus lourd." }
  ],
  voice: [
    { id: "kokoro-fr", name: "Kokoro (voix française)", sizeGB: 0.33, needGB: 0,
      note: "Voix naturelle « ff_siwis ». Tourne sur le processeur, va sur tous les PC." }
  ]
};
// le catalogue complet : celui d'origine, plus les IA du dossier Documents\ElectroTale\modeles (et des mods)
function catalogue() {
  const out = { text: [...LAUNCH_CATALOG.text], sd: [...LAUNCH_CATALOG.sd], voice: LAUNCH_CATALOG.voice };
  const ids = new Set([...out.text, ...out.sd].map(x => x.id));
  const { res, erreurs } = contenu.modelesPerso(loadCfg().modsOff || [], ids);
  erreurs.forEach(x => log("[mon dossier] " + x));
  for (const r of res) {
    // même nom de fichier qu'un modèle d'origine : il le remplace (à la même place) ou le retire ("actif": false)
    let place = -1;
    for (const k of ["text", "sd"]) { const i = out[k].findIndex(x => x.id === r.base); if (i > -1) { out[k].splice(i, 1); if (k === r.kind) place = i; } }
    if (r.off) continue;
    const j = out[r.kind].findIndex(x => x.id === r.it.id); if (j > -1) out[r.kind].splice(j, 1);
    if (place > -1) out[r.kind].splice(place, 0, r.it); else out[r.kind].push(r.it);
  }
  if (!out.text.length) out.text = [...LAUNCH_CATALOG.text];   // il faut toujours au moins une IA de texte
  return out;
}
const findItem = (kind, id) => (catalogue()[kind] || []).find(x => x.id === id) || null;

// mémoire vidéo sous Windows pour les cartes non NVIDIA (le registre donne la vraie valeur, pas limitée à 4 Go)
function winVramGB() {
  if (!WIN) return Promise.resolve(0);
  const cmd = "$m=0; Get-ItemProperty -Path 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | ForEach-Object { $v=$_.'HardwareInformation.qwMemorySize'; if ($v -and [int64]$v -gt $m) { $m=[int64]$v } }; $m";
  return new Promise(resolve => execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { windowsHide: true, timeout: 8000 },
    (err, out) => resolve(err ? 0 : Math.round((parseInt(String(out).trim()) || 0) / 1073741824))));
}
function freeDiskGB(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); const s = fs.statfsSync(dir); return Math.floor(s.bavail * s.bsize / 1073741824); }
  catch (e) { return 0; }
}
async function scanPc() {
  const g = await detectGpu();
  let vram = g.vramGB || 0;
  if (!vram && g.vendor !== "nvidia") vram = await winVramGB();
  // Intel (sauf Arc) et les Radeon « Graphics » des processeurs AMD partagent la mémoire vive
  const integrated = (g.vendor === "intel" && !/\barc\b/i.test(g.name)) || (g.vendor === "amd" && /radeon\(tm\) graphics|vega \d+ graphics|radeon graphics/i.test(g.name));
  const cpus = os.cpus();
  return {
    cpu: ((cpus[0] && cpus[0].model) || "").replace(/\s+/g, " ").trim(), cores: cpus.length,
    ramGB: Math.round(os.totalmem() / 1073741824),
    gpu: { vendor: g.vendor, name: g.name, vramGB: integrated ? 0 : vram, integrated },
    freeGB: freeDiskGB(modelsDir()), dir: modelsDir()
  };
}
// mémoire utilisable par un modèle : la mémoire vidéo d'une vraie carte, sinon une part de la mémoire vive
function budgetGB(pc) {
  const dedicated = !pc.gpu.integrated && pc.gpu.vramGB >= 2;
  return { dedicated, gb: dedicated ? pc.gpu.vramGB : Math.max(0, Math.floor(pc.ramGB * 0.5) - 1) };
}
function rateItem(pc, it) {
  const b = budgetGB(pc);
  if (it.needGB > b.gb + (b.dedicated ? 0 : 0.5)) return "lourd";
  if (!b.dedicated && it.needGB >= 10) return "lent";
  return "ok";
}
function recommend(pc, cat) {
  const b = budgetGB(pc), r = {};
  const text = cat.text;
  if (!b.dedicated) r.text = b.gb >= 6 ? "llama31-8b" : "llama32-3b";   // sans vraie carte, au-delà de 8B c'est trop lent pour jouer
  else r.text = b.gb >= 16 ? "mistral-small-24b" : b.gb >= 10 ? "rocinante-12b" : b.gb >= 6 ? "llama31-8b" : "llama32-3b";
  if (!text.some(x => x.id === r.text)) r.text = text[0].id;
  r.sd = b.dedicated && b.gb >= 8 ? "dreamshaper-xl" : pc.ramGB >= 8 ? "lcm-dreamshaper" : "";   // sans vraie carte : le modèle rapide
  if (r.sd && !cat.sd.some(x => x.id === r.sd)) r.sd = (cat.sd[0] || {}).id || "";
  r.voice = "kokoro-fr";
  return r;
}
function installedState(cat = catalogue()) {
  const c = loadCfg(), inst = c.installed || {}, out = {};
  for (const kind of ["text", "sd"]) for (const it of cat[kind]) if (inst[it.id] && fs.existsSync(inst[it.id])) out[it.id] = inst[it.id];
  if (c.kokoroDir && fs.existsSync(path.join(c.kokoroDir, "model.onnx"))) out["kokoro-fr"] = c.kokoroDir;
  return out;
}
ipcMain.handle("launcher:scan", async () => {
  const pc = await scanPc(), c = loadCfg(), cat = catalogue();
  const items = {};
  for (const kind of Object.keys(cat)) items[kind] = cat[kind].map(it => ({ id: it.id, name: it.name, note: it.note, sizeGB: it.sizeGB, needGB: it.needGB, rate: rateItem(pc, it) }));
  return { pc, budget: budgetGB(pc), items, rec: recommend(pc, cat), installed: installedState(cat), current: { text: c.modelPath, sd: c.sdOn ? c.sdModel : "" }, atStart: c.launcherAtStart !== false, bundled: hasBundled() };
});

// choisit le bon fichier dans un dépôt Hugging Face (taille et empreinte SHA-256 comprises)
async function resolveHfFile(it) {
  const list = await getJson("https://huggingface.co/api/models/" + it.repo + "/tree/main?recursive=true");
  if (!Array.isArray(list)) throw new Error("Hugging Face : dépôt " + it.repo + " introuvable (" + ((list && list.error) || "réponse inattendue") + ")");
  const files = list.filter(f => f.type === "file" && /\.gguf$/i.test(f.path) && !f.path.includes("/") && !/mmproj|imatrix|-of-\d/i.test(f.path));
  let f = null;
  if (it.file) f = files.find(x => x.path === it.file);
  else for (const q of it.quants) { f = files.find(x => new RegExp("[._-]" + q + "\\.gguf$", "i").test(x.path)); if (f) break; }
  if (!f) throw new Error("aucun fichier adapté dans " + it.repo);
  return { name: f.path, size: (f.lfs && f.lfs.size) || f.size || 0, sha256: (f.lfs && f.lfs.oid) || "",
    url: "https://huggingface.co/" + it.repo + "/resolve/main/" + encodeURIComponent(f.path) + "?download=true" };
}
// téléchargement qui reprend là où il s'était arrêté (coupure, pause, redémarrage du PC)
function downloadResumable(url, dest, onProgress, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 8) return reject(new Error("Trop de redirections."));
    const tmp = dest + ".part";
    let start = 0; try { start = fs.statSync(tmp).size; } catch (e) {}
    const headers = { "User-Agent": "electrotale" };
    if (start > 0) headers.Range = "bytes=" + start + "-";
    const req = https.get(url, { headers }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadResumable(new URL(res.headers.location, url).toString(), dest, onProgress, depth + 1).then(resolve, reject);
      }
      if (res.statusCode === 416) { res.resume(); fs.renameSync(tmp, dest); return resolve(dest); }   // déjà complet
      if (res.statusCode === 401 || res.statusCode === 403) { res.resume(); return reject(new Error("Accès refusé par Hugging Face pour ce modèle.")); }
      if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
      const append = res.statusCode === 206;
      if (!append) start = 0;
      const total = start + (+res.headers["content-length"] || 0);
      let got = start, last = 0;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.createWriteStream(tmp, { flags: append ? "a" : "w" });
      res.on("data", ch => { got += ch.length; const now = Date.now(); if (now - last > 300) { last = now; onProgress(got, total); } });
      res.on("error", err => { out.destroy(); reject(err); });   // le morceau déjà reçu est gardé pour la reprise
      res.pipe(out);
      out.on("finish", () => out.close(() => {
        if (total && got < total) return reject(new Error("Téléchargement interrompu : il reprendra où il s'est arrêté."));
        fs.renameSync(tmp, dest); onProgress(got, total); resolve(dest);
      }));
      out.on("error", reject);
    });
    dlReq = req;
    req.on("error", reject);
  });
}
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", d => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
}

let launchBusy = false;
ipcMain.handle("launcher:install", (e, picks) => launcherInstall(picks));
async function launcherInstall(picks) {
  if (launchBusy || dlReq) return { ok: false, error: "Un téléchargement est déjà en cours." };
  picks = picks && typeof picks === "object" ? picks : {};
  const plan = [];
  const text = findItem("text", picks.text), sd = findItem("sd", picks.sd), voice = findItem("voice", picks.voice);
  if (text) plan.push({ kind: "text", it: text });
  if (sd) plan.push({ kind: "sd", it: sd });
  if (voice) plan.push({ kind: "voice", it: voice });
  if (!plan.length) return { ok: false, error: "Rien à installer." };
  launchBusy = true;
  const prog = (i, phase, extra) => send("launcher:progress", { i, n: plan.length, kind: plan[i].kind, name: plan[i].it.name, phase, ...extra });
  try {
    const have = installedState(), dedicated = budgetGB(await scanPc()).dedicated;
    // 1) on prépare : quel fichier, quelle taille, assez de place ?
    let need = 0;
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      if (have[p.it.id]) { p.done = have[p.it.id]; continue; }
      if (p.kind === "voice") { need += 0.7 * 1073741824; continue; }   // archive + extraction
      prog(i, "liste");
      p.file = await resolveHfFile(p.it);
      p.dest = path.join(modelsDir(), p.file.name);
      let part = 0; try { part = fs.statSync(p.dest + ".part").size; } catch (err) {}
      if (!fs.existsSync(p.dest)) need += Math.max(0, p.file.size - part);
    }
    const free = freeDiskGB(modelsDir());
    if (free && need / 1073741824 > free - 1) throw new Error("Pas assez de place sur le disque : il faut " + (need / 1073741824).toFixed(1) + " Go, il reste " + free + " Go.");
    // 2) on télécharge, on vérifie, on branche
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      if (p.done) { prog(i, "deja"); }
      else if (p.kind === "voice") {
        prog(i, "voix");
        await downloadKokoro();
      } else {
        if (!fs.existsSync(p.dest)) {
          prog(i, "telechargement", { got: 0, total: p.file.size });
          await downloadResumable(p.file.url, p.dest, (got, total) => prog(i, "telechargement", { got, total: total || p.file.size }));
        }
        if (p.file.sha256 && /^[0-9a-f]{64}$/i.test(p.file.sha256)) {
          prog(i, "verification");
          const h = await sha256File(p.dest);
          if (h.toLowerCase() !== p.file.sha256.toLowerCase()) { try { fs.unlinkSync(p.dest); } catch (err) {} throw new Error("Le fichier " + p.file.name + " est abîmé (empreinte différente). Il a été supprimé : relance l'installation."); }
        }
        p.done = p.dest;
      }
      const c = loadCfg();
      c.installed = { ...(c.installed || {}) };
      if (p.kind !== "voice") c.installed[p.it.id] = p.done;
      if (p.kind === "text") {
        c.modelPath = p.done; c.recentModels = [p.done, ...c.recentModels.filter(x => x !== p.done)].slice(0, 6);
        if (hasBundled()) c.engine = "integre";
        if (!dedicated && +c.ctx > 6144) c.ctx = 6144;   // carte intégrée : contexte plus court, réponses plus rapides
      }
      if (p.kind === "sd") { c.sdModel = p.done; c.sdOn = true; }
      saveCfg(c);
      prog(i, "fini");
    }
    return { ok: true, config: loadCfg() };
  } catch (err) {
    const paused = /annul|pause|interrompu|aborted|socket hang up|ECONNRESET|ETIMEDOUT/i.test(err.message);
    return { ok: false, paused, error: paused && !/pause|interrompu/i.test(err.message) ? "La connexion a été coupée, le téléchargement reprendra où il s'est arrêté." : err.message };
  } finally { launchBusy = false; dlReq = null; }
}
// « Jouer » avec un modèle déjà installé (ou sans images) : on le branche sans rien télécharger
ipcMain.handle("launcher:use", (e, picks) => {
  picks = picks && typeof picks === "object" ? picks : {};
  const have = installedState(), c = loadCfg();
  let text = false;
  if (picks.text && have[picks.text] && findItem("text", picks.text) && c.modelPath !== have[picks.text]) {
    c.modelPath = have[picks.text]; c.recentModels = [c.modelPath, ...c.recentModels.filter(x => x !== c.modelPath)].slice(0, 6); text = true;
  }
  if (picks.sd === "") c.sdOn = false;
  else if (picks.sd && have[picks.sd] && findItem("sd", picks.sd)) { c.sdModel = have[picks.sd]; c.sdOn = true; }
  saveCfg(c);
  return { text, config: loadCfg() };
});
// bouton ⚡ de la barre de dessin : passe au modèle rapide (le télécharge d'abord s'il le faut)
ipcMain.handle("sd:useFast", async () => {
  const id = "lcm-dreamshaper";
  if (!installedState()[id]) {
    const r = await launcherInstall({ sd: id });
    if (!r.ok) return r;
  } else { const c = loadCfg(); c.sdModel = installedState()[id]; c.sdOn = true; saveCfg(c); }
  clearTimeout(sdCheckTimer); await sdCheck();
  if (!sdProc && !sdSig) await startSd();
  return { ok: true, config: loadCfg() };
});
// test de vitesse du dessin : essaie quelques réglages sur ce PC, garde le plus rapide
const SD_TUNES = [
  { label: "carte graphique", sdGpu: "gpu", sdFlash: false, sdQuant: "", sdForceGpu: false },
  { label: "carte graphique + accélérations", sdGpu: "gpu", sdFlash: true, sdQuant: "q8_0", sdForceGpu: true },
  { label: "processeur", sdGpu: "cpu", sdFlash: true, sdQuant: "q8_0", sdForceGpu: false }
];
const TUNE_KEYS = ["sdGpu", "sdFlash", "sdQuant", "sdForceGpu"];
let benchOn = false, benchStop = false;
function httpPostJson(port, p, body, timeout) {
  return new Promise(resolve => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port, path: p, method: "POST", timeout, headers: { [KEY_HEADER]: ENGINE_KEY, "Content-Type": "application/json", "Content-Length": data.length } }, res => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ code: res.statusCode, json: j }); });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end(data);
  });
}
async function sdWaitReady(maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs && !benchStop) {
    if (sdStatus === "error") return false;
    if (sdStatus === "ready" && sdProc) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}
async function applyTune(t) {
  const c = loadCfg(); TUNE_KEYS.forEach(k => c[k] = t[k]); saveCfg(c);
  clearTimeout(sdCheckTimer); await sdCheck();
  if (!sdProc) await startSd();
}
ipcMain.handle("sd:bench", async (e, size) => {
  if (benchOn) return { ok: false, error: "Le test de vitesse tourne déjà." };
  const c0 = loadCfg();
  if (!c0.sdOn || !c0.sdModel || !fs.existsSync(c0.sdModel)) return { ok: false, error: "Aucun modèle d'images choisi." };
  if (!hasBundled() || c0.engine === "koboldcpp") return { ok: false, error: "Le test ne marche qu'avec le moteur intégré." };
  const [w, h] = String(size || "768x512").split("x").map(n => Math.max(256, Math.min(1024, +n || 512)));
  const fast = /lcm|turbo|lightning|hyper/i.test(path.basename(c0.sdModel)), full = fast ? 5 : 20;
  const orig = {}; TUNE_KEYS.forEach(k => orig[k] = c0[k]);
  benchOn = true; benchStop = false;
  const results = [];
  const prog = (i, msg) => send("sd:bench", { i, n: SD_TUNES.length, msg });
  try {
    for (let i = 0; i < SD_TUNES.length && !benchStop; i++) {
      const t = SD_TUNES[i], r = { label: t.label, ok: false };
      results.push(r);
      prog(i, "Essai " + (i + 1) + "/" + SD_TUNES.length + " : " + t.label + " — chargement…");
      await applyTune(t);
      if (!(await sdWaitReady(5 * 60 * 1000))) { r.error = "ne démarre pas"; log("[images] test : " + t.label + " ne démarre pas"); continue; }
      prog(i, "Essai " + (i + 1) + "/" + SD_TUNES.length + " : " + t.label + " — dessin de test (2 étapes)…");
      // on n'attend pas plus longtemps que le meilleur réglage déjà trouvé
      const best = results.filter(x => x.ok).reduce((a, x) => Math.min(a, x.est), Infinity);
      const limit = Math.min(10 * 60, isFinite(best) ? best * 1.1 : Infinity);
      const port = loadCfg().sdPort;
      const timer = setTimeout(() => httpPostJson(port, "/sdapi/v1/interrupt", {}, 3000), limit * 1000);
      const t0 = Date.now();
      const res = await httpPostJson(port, "/sdapi/v1/txt2img", { prompt: "a knight in a misty forest, fantasy illustration", negative_prompt: "", width: w, height: h, steps: 2, cfg_scale: fast ? 1.5 : 7, sampler_name: "Euler a", seed: 42 }, (limit + 60) * 1000);
      clearTimeout(timer);
      if (!res || res.code !== 200) { r.error = res && res.code === 499 ? "plus lent" : "échec"; log("[images] test : " + t.label + " → " + r.error); continue; }
      let info = {}; try { info = JSON.parse(res.json.info || "{}"); } catch (err) {}
      const total = info.total || (Date.now() - t0) / 1000, step = info.stepSecs || total / 3;
      r.ok = true; r.step = step; r.est = total + (full - 2) * step;
      log("[images] test : " + t.label + " → " + step.toFixed(1) + " s par étape, ≈ " + Math.round(r.est) + " s par image");
    }
    const ok = results.filter(x => x.ok).sort((a, b) => a.est - b.est);
    const pick = ok[0] ? SD_TUNES.find(t => t.label === ok[0].label) : orig;
    prog(SD_TUNES.length - 1, "Mise en place du réglage le plus rapide…");
    await applyTune(pick);
    return { ok: !!ok[0], stopped: benchStop, results, best: ok[0] || null, size: w + "x" + h, steps: full, error: ok[0] ? "" : "aucun réglage n'a marché, l'ancien est remis" };
  } catch (err) {
    await applyTune(orig).catch(() => {});
    return { ok: false, error: err.message, results };
  } finally { benchOn = false; }
});
ipcMain.handle("sd:benchStop", () => { benchStop = true; if (sdProc) httpPostJson(loadCfg().sdPort, "/sdapi/v1/interrupt", {}, 3000); return true; });
ipcMain.handle("launcher:pause", () => { if (dlReq) dlReq.destroy(new Error("Téléchargement mis en pause : il reprendra où il s'est arrêté.")); return true; });
ipcMain.handle("launcher:setAtStart", (e, on) => { const c = loadCfg(); c.launcherAtStart = !!on; saveCfg(c); return true; });

/* ---------- IPC ---------- */
ipcMain.handle("sd:download", async (e, variant) => {
  try { return { ok: true, ...(await downloadSd(variant)) }; }
  catch (err) { log("[images] téléchargement impossible : " + err.message); return { ok: false, error: err.message }; }
});
ipcMain.handle("sd:start", () => startSd());
ipcMain.handle("sd:stop", () => stopSd());
ipcMain.handle("sd:status", () => ({ status: sdStatus, port: loadCfg().sdPort }));
ipcMain.handle("tts:download", async () => {
  try { return { ok: true, ...(await downloadKokoro()) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle("tts:speak", async (e, text, sid, lang) => {
  try { return { ok: true, audio: await kokoroSpeak(String(text).slice(0, 3000), Math.max(0, Math.min(53, parseInt(sid) || 30)), String(lang || "fr")) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle("engine:getConfig", () => ({ ...loadCfg(), bundled: hasBundled() }));
// les chemins de programmes ne se changent que par une boîte « Choisir un fichier » ou un téléchargement, jamais depuis la page
const PROTECTED_CFG = ["exePath", "llamaServer", "sdServer", "kokoroExe", "kokoroDir", "modelsDir", "integreMigrated", "installed", "modsOff"];
ipcMain.handle("engine:setConfig", (e, patch) => {
  const p = { ...(patch && typeof patch === "object" ? patch : {}) };
  PROTECTED_CFG.forEach(k => delete p[k]);
  if ("engine" in p && !["integre", "llamacpp", "koboldcpp"].includes(p.engine)) delete p.engine;
  if ("sdGpu" in p && !["auto", "gpu", "cpu"].includes(p.sdGpu)) delete p.sdGpu;
  if ("sdQuant" in p && !["", "q8_0"].includes(p.sdQuant)) delete p.sdQuant;
  ["port", "sdPort", "voicePort"].forEach(k => { if (k in p && !(Number.isInteger(+p[k]) && +p[k] >= 1024 && +p[k] <= 65535)) delete p[k]; });
  const c = { ...loadCfg(), ...p }; saveCfg(c); return c;
});
ipcMain.handle("engine:status", () => ({ status, msg: statusMsg, log: logTail }));
ipcMain.handle("engine:start", () => { startSd(); return startEngine(); });
ipcMain.handle("engine:stop", () => { stopSd(); return stopEngine(); });
ipcMain.handle("engine:restart", async () => { await stopSd(); await stopEngine(); startSd(); return startEngine(); });
ipcMain.handle("engine:detectGpu", () => detectGpu());
ipcMain.handle("engine:pickExe", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Choisir le moteur (llama-server.exe ou koboldcpp.exe)", properties: ["openFile"],
    filters: process.platform === "win32" ? [{ name: "Moteur", extensions: ["exe"] }] : [] });
  if (r.canceled || !r.filePaths[0]) return null;
  const c = loadCfg(), f = r.filePaths[0];
  if (/llama-server/i.test(path.basename(f))) { c.llamaServer = f; c.engine = "llamacpp"; }
  else { c.exePath = f; c.engine = "koboldcpp"; }
  saveCfg(c); return c;
});
ipcMain.handle("engine:pickModel", async () => {
  const c = loadCfg();
  const r = await dialog.showOpenDialog(win, { title: "Choisir un modèle", properties: ["openFile"],
    defaultPath: c.modelPath ? path.dirname(c.modelPath) : undefined,
    filters: [{ name: "Modèles GGUF", extensions: ["gguf"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return setModel(r.filePaths[0]);
});
function setModel(p) {
  const c = loadCfg(); c.modelPath = p;
  c.recentModels = [p, ...c.recentModels.filter(x => x !== p)].slice(0, 6);
  saveCfg(c); return c;
}
ipcMain.handle("engine:useModel", (e, p) => fs.existsSync(p) ? setModel(p) : null);
ipcMain.handle("engine:downloadLlama", async (e, variant) => {
  try { return { ok: true, ...(await downloadLlama(variant)) }; }
  catch (err) { setStatus("error", "Téléchargement de llama.cpp impossible : " + err.message); return { ok: false, error: err.message }; }
});
ipcMain.handle("engine:download", async (e, variant) => {
  try { return { ok: true, ...(await downloadKobold(variant)) }; }
  catch (err) { setStatus("error", "Téléchargement impossible : " + err.message); return { ok: false, error: err.message }; }
});
const licencesDir = () => path.join(__dirname, "licences");
ipcMain.handle("app:info", () => ({ version: app.getVersion(), licences: fs.existsSync(licencesDir()) }));
// Export du grimoire en PDF : fenêtre cachée, sans JavaScript, rendu puis impression
ipcMain.handle("book:pdf", async (_e, html, name) => {
  if (typeof html !== "string" || html.length > 200 * 1024 * 1024) return { ok: false, error: "Contenu invalide" };
  const safe = String(name || "Grimoire").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "Grimoire";
  const r = await dialog.showSaveDialog(win, { title: "Enregistrer le livre", defaultPath: safe + ".pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  const tmp = path.join(app.getPath("temp"), "electrotale-livre-" + crypto.randomBytes(6).toString("hex") + ".html");
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, contextIsolation: true, nodeIntegration: false } });
  pw.webContents.on("will-navigate", (ev) => ev.preventDefault());
  pw.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  try {
    fs.writeFileSync(tmp, html, "utf8");
    await pw.loadFile(tmp);
    const pdf = await pw.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(r.filePath, pdf);
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    pw.destroy(); try { fs.unlinkSync(tmp); } catch {}
  }
});
ipcMain.handle("app:openLicences", () => { const f = path.join(licencesDir(), "LICENCES-TIERS.txt"); if (fs.existsSync(f)) shell.showItemInFolder(f); });
ipcMain.handle("engine:showFile", (e, p) => { if (p && typeof p === "string" && path.isAbsolute(p)) shell.showItemInFolder(p); });

/* ---------- fenêtre ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 720, minHeight: 500,
    title: "ElectroTale", backgroundColor: "#16140f", autoHideMenuBar: true,
    icon: path.join(__dirname, "app", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false }
  });
  const page = path.join(__dirname, "app", "index.html");
  win.loadFile(page);
  // les liens s'ouvrent dans le navigateur, mais seulement les vrais sites web (pas de fichiers ni de programmes)
  const safeExternal = url => { try { const u = new URL(url); if (u.protocol === "https:" || u.protocol === "http:") shell.openExternal(u.toString()); } catch (e) {} };
  win.webContents.setWindowOpenHandler(({ url }) => { safeExternal(url); return { action: "deny" }; });
  // la fenêtre ne quitte jamais la page d'ElectroTale
  win.webContents.on("will-navigate", (e, url) => { if (url !== require("url").pathToFileURL(page).toString()) { e.preventDefault(); safeExternal(url); } });
  win.webContents.on("will-attach-webview", e => e.preventDefault());
  win.on("closed", () => { win = null; });
}

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
/* ---------- reprise des données de l'ancienne version (« Kobold Aventure ») ---------- */
function migrateFromOldName() {
  try {
    const nd = userDir(), od = path.join(app.getPath("appData"), "Kobold Aventure");
    if (!fs.existsSync(od) || od === nd) return;
    if (fs.existsSync(path.join(nd, "donnees")) || fs.existsSync(path.join(nd, "moteur.json"))) return;
    fs.mkdirSync(nd, { recursive: true });
    for (const n of ["moteur.json", "donnees", "Local Storage"]) {
      const src = path.join(od, n);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(nd, n), { recursive: true });
    }
    // les modèles et koboldcpp.exe restent dans l'ancien dossier (chemins absolus déjà enregistrés)
    const c = loadCfg();
    if (!c.modelsDir && fs.existsSync(path.join(od, "modeles"))) { c.modelsDir = path.join(od, "modeles"); saveCfg(c); }
  } catch (e) { console.error("Migration :", e); }
}

/* ---------- sécurité : la clé des moteurs est ajoutée aux requêtes de la fenêtre, et seulement vers nos moteurs ---------- */
function enginePorts() {
  const c = loadCfg(), s = new Set([+c.sdPort, +c.voicePort || 5003]);
  if (c.engine === "integre") s.add(+c.port);
  return s;
}
function secureSession() {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeSendHeaders({ urls: ["http://127.0.0.1/*", "http://localhost/*"] }, (d, cb) => {
    try {
      const u = new URL(d.url), port = +(u.port || 80);
      if (win && d.webContentsId === win.webContents.id && enginePorts().has(port)) d.requestHeaders[KEY_HEADER] = ENGINE_KEY;
    } catch (e) {}
    cb({ requestHeaders: d.requestHeaders });
  });
  // aucune permission spéciale (micro, caméra, position, notifications…) : l'app n'en a pas besoin
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
}

app.whenReady().then(() => {
  secureSession();
  contenu.installer({ loadCfg, saveCfg, origineEnPlus: () => contenu.catalogueOrigine(LAUNCH_CATALOG) });
  migrateFromOldName();
  createWindow();
  if (process.env.KA_TEST) setTimeout(() => require(process.env.KA_TEST)(win, app, { forkWorker }), 1500);
  const c = loadCfg();
  if (c.autoStart && c.modelPath && (c.engine === "integre" || (c.engine === "koboldcpp" ? c.exePath : c.llamaServer))) { startEngine(); startSd(); }
});
let quitting = false;
app.on("before-quit", async e => {
  stopSd(); stopVoice();
  if (quitting || !proc) return;
  e.preventDefault(); quitting = true;
  await stopEngine();
  app.quit();
});
app.on("window-all-closed", () => app.quit());
