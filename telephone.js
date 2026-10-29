// ElectroTale — jouer depuis un téléphone (Android, iPhone, tablette) sur le même Wi-Fi que le PC.
// Le PC garde les moteurs (texte, images, voix) ; le téléphone affiche la même page dans son navigateur.
// Sécurité : seulement le réseau local, appairage par un code à 6 chiffres, puis un jeton secret (cookie) par téléphone.
// Le téléphone n'a accès qu'à une liste fermée de fonctions : il joue, il ne règle pas les moteurs ni les fichiers du PC.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT_DEFAUT = 5080;
const COOKIE = "et_tel";
const MAX_CORPS = 60 * 1024 * 1024;

// ce que le téléphone a le droit d'appeler (le reste répond « seulement sur le PC »)
const PERMIS = new Set([
  "engine:getConfig", "engine:status", "engine:start", "engine:stop", "engine:restart",
  "sd:status", "sd:start", "sd:useFast",
  "tts:speak", "app:info",
  "contenu:origine", "contenu:aventure", "contenu:enregistrer", "contenu:mod"
]);
// événements du PC transmis aux téléphones
const DIFFUSES = new Set(["engine:status", "engine:log", "engine:progress", "sd:status", "tts:progress", "launcher:progress", "tel:main"]);

let D = null;               // dépendances données par main.js
let serveur = null, portActif = 0;
let code = "";              // code d'appairage affiché sur le PC
let essais = [];            // dates des mauvais codes (anti-devinette)
let main = "pc";            // qui joue : "pc" ou l'identifiant d'un téléphone
let attenteAck = null;
const flux = new Set();     // téléphones connectés aux événements { res, id }

const sha = t => crypto.createHash("sha256").update(t).digest("hex");
const nouveauCode = () => { code = String(crypto.randomInt(0, 1000000)).padStart(6, "0"); essais = []; return code; };

// adresses privées seulement : maison (192.168, 10, 172.16-31), même machine, Tailscale (100.64/10), IPv6 local
function adresseLocale(ip) {
  ip = String(ip || "").replace(/^::ffff:/, "");
  if (ip === "::1" || /^127\./.test(ip)) return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip)) return true;
  let m = ip.match(/^172\.(\d+)\./); if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  m = ip.match(/^100\.(\d+)\./); if (m && +m[1] >= 64 && +m[1] <= 127) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return true;
  return false;
}
function adressesPC() {
  const res = [];
  for (const [nom, liste] of Object.entries(os.networkInterfaces())) for (const a of liste || []) {
    if (a.family !== "IPv4" || a.internal || !adresseLocale(a.address) || /^169\.254\./.test(a.address)) continue;
    const virtuel = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|vbox|Loopback/i.test(nom);
    res.push({ ip: a.address, nom, virtuel });
  }
  // la vraie carte Wi-Fi / Ethernet d'abord, puis 192.168 avant le reste
  return res.sort((a, b) => (a.virtuel - b.virtuel) || (/^192\.168\./.test(b.ip) - /^192\.168\./.test(a.ip)));
}

function cookies(req) {
  const o = {};
  String(req.headers.cookie || "").split(";").forEach(p => { const i = p.indexOf("="); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return o;
}
function appareil(req) {
  const t = cookies(req)[COOKIE];
  if (!t || !/^[0-9a-f]{64}$/.test(t)) return null;
  const h = sha(t), c = D.loadCfg();
  return (c.telAppareils || []).find(a => a.h === h) || null;
}
function entetes(type, plus) {
  return Object.assign({
    "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin", "Cross-Origin-Resource-Policy": "same-origin"
  }, plus || {});
}
function envoyer(res, code, type, corps, plus) { res.writeHead(code, entetes(type, plus)); res.end(corps); }
const json = (res, code, obj) => envoyer(res, code, "application/json; charset=utf-8", JSON.stringify(obj === undefined ? null : obj));
function lireCorps(req, max = MAX_CORPS) {
  return new Promise((ok, ko) => {
    const parts = []; let n = 0;
    req.on("data", d => { n += d.length; if (n > max) { ko(new Error("trop gros")); req.destroy(); } else parts.push(d); });
    req.on("end", () => ok(Buffer.concat(parts)));
    req.on("error", ko);
  });
}
// une requête qui modifie quelque chose doit venir de la page d'ElectroTale elle-même (pas d'un autre site)
function memeOrigine(req) {
  const o = req.headers.origin;
  if (o === "null") return req.headers["sec-fetch-site"] === "same-origin";
  if (!o) return req.headers["sec-fetch-site"] ? req.headers["sec-fetch-site"] === "same-origin" : true;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}

/* ---------- la page du jeu, adaptée au téléphone ---------- */
function pageJeu() {
  let h = fs.readFileSync(path.join(D.appDir, "app", "index.html"), "utf8");
  // sur le téléphone, la page ne parle qu'au PC qui la sert (les moteurs passent par /moteur/...)
  h = h.replace(/connect-src [^;]+;/, "connect-src 'self';");
  h = h.replace(/(<meta http-equiv="Content-Security-Policy"[^>]*>)/,
    '$1\n<script src="/tel.js"></script>\n<link rel="manifest" href="/manifest.webmanifest">\n<meta name="theme-color" content="#16140f">\n<meta name="mobile-web-app-capable" content="yes">\n<link rel="apple-touch-icon" href="/icon.png">');
  return h;
}
function pageAppairage(msg) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'">
<title>ElectroTale</title><link rel="icon" href="/icon.png">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#16140f;color:#efe6d2;font:17px/1.5 Georgia,serif}
main{max-width:360px;padding:24px;text-align:center}img{width:96px;height:96px}h1{font-size:26px;margin:8px 0 4px;color:#e2b45c}
p{color:#bfb39a}input{font:32px monospace;letter-spacing:8px;width:100%;box-sizing:border-box;text-align:center;padding:12px;border-radius:10px;border:1px solid #5a4d36;background:#211d16;color:#fff}
button{margin-top:14px;width:100%;padding:14px;font:18px Georgia,serif;border:0;border-radius:10px;background:#c9973f;color:#16140f;font-weight:bold}
.err{color:#ff8a7a}</style></head><body><main>
<img src="/icon.png" alt=""><h1>ElectroTale</h1>
<p>Tape le code à 6 chiffres affiché sur le PC<br><small>(Menu → Téléphone)</small></p>
${msg ? `<p class="err">${msg}</p>` : ""}
<form method="post" action="/appairer"><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" autofocus required>
<button type="submit">Relier ce téléphone</button></form></main></body></html>`;
}
const MANIFESTE = JSON.stringify({
  name: "ElectroTale", short_name: "ElectroTale", lang: "fr", start_url: "/", scope: "/", display: "standalone",
  background_color: "#16140f", theme_color: "#16140f", icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" }]
});

/* ---------- appairage ---------- */
async function appairer(req, res) {
  const now = Date.now();
  essais = essais.filter(t => now - t < 60000);
  const corps = (await lireCorps(req, 4096)).toString();
  const donne = (new URLSearchParams(corps).get("code") || "").trim();
  if (essais.length >= 5) return envoyer(res, 429, "text/html; charset=utf-8", pageAppairage("Trop d'essais. Attends une minute."));
  const ok = code && donne.length === 6 && crypto.timingSafeEqual(Buffer.from(donne.padEnd(6)), Buffer.from(code));
  if (!ok) {
    essais.push(now);
    D.log && D.log("[téléphone] mauvais code depuis " + req.socket.remoteAddress);
    return envoyer(res, 403, "text/html; charset=utf-8", pageAppairage("Ce n'est pas le bon code."));
  }
  const jeton = crypto.randomBytes(32).toString("hex");
  const c = D.loadCfg(), ua = String(req.headers["user-agent"] || "");
  let nom = (ua.match(/Android[^;)]*;\s*([^;)]+?)(?:\sBuild|\))/) || [])[1] || "";
  if (nom.length < 3) nom = /Android/.test(ua) ? "Téléphone Android" : /iPhone|iPad/.test(ua) ? (ua.match(/iPhone|iPad/) || [""])[0] : /Windows/.test(ua) ? "PC Windows" : /Mac OS/.test(ua) ? "Mac" : "Navigateur";
  c.telAppareils = (c.telAppareils || []).concat([{ id: crypto.randomBytes(6).toString("hex"), h: sha(jeton), nom: nom.slice(0, 40), cree: now }]).slice(-8);
  D.saveCfg(c);
  nouveauCode();   // un code ne sert qu'une fois
  D.send("tel:etat", null);
  D.log && D.log("[téléphone] nouvel appareil relié : " + nom);
  envoyer(res, 303, "text/plain", "", { Location: "/", "Set-Cookie": `${COOKIE}=${jeton}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` });
}

/* ---------- qui joue : une seule partie à la fois ---------- */
function prendre(id) {
  if (main === id) return Promise.resolve(true);
  const avant = main;
  main = id;
  diffuser("tel:main", { qui: id });
  if (avant !== "pc") return Promise.resolve(true);
  // la fenêtre du PC enregistre d'abord sa partie, puis se met en pause
  return new Promise(ok => {
    const fin = () => { clearTimeout(t); attenteAck = null; ok(true); };
    const t = setTimeout(fin, 2500);
    attenteAck = fin;
    if (!D.versPC("tel:main", { qui: "tel" })) fin();
  });
}
function rendreAuPC() {
  if (main === "pc") return;
  main = "pc";
  diffuser("tel:main", { qui: "pc" });
  D.versPC("tel:main", { qui: "pc" });
}

/* ---------- moteurs : le téléphone passe par le PC ---------- */
function relais(req, res, port, chemin) {
  if (!D.portsMoteurs().has(port)) return json(res, 403, { error: "port refusé" });
  const h = { ...req.headers };
  delete h.cookie; delete h.origin; delete h.referer; delete h.host;
  h.host = "127.0.0.1:" + port;
  h[D.KEY_HEADER] = D.ENGINE_KEY;
  const r = http.request({ host: "127.0.0.1", port, path: chemin, method: req.method, headers: h }, rr => {
    const out = { ...rr.headers }; delete out["access-control-allow-origin"]; delete out["set-cookie"];
    res.writeHead(rr.statusCode, out);
    rr.pipe(res);
  });
  r.on("error", e => { if (!res.headersSent) json(res, 502, { error: "moteur injoignable : " + e.message }); else res.destroy(); });
  res.on("close", () => r.destroy());   // le téléphone a arrêté la génération : on coupe aussi vers le moteur
  req.pipe(r);
}

/* ---------- appels de fonctions (comme la fenêtre du PC, mais filtrés) ---------- */
async function appel(req, res, ap) {
  const { nom, args } = JSON.parse((await lireCorps(req)).toString() || "{}");
  const a = Array.isArray(args) ? args : [];
  switch (nom) {
    case "store:get": return json(res, 200, D.store.get(a[0]));
    case "store:set": return json(res, 200, main === ap.id ? D.store.set(a[0], a[1]) : false);
    case "store:del": return json(res, 200, main === ap.id ? D.store.del(a[0]) : false);
    case "contenu:lire": return json(res, 200, D.lireContenu());
    case "tel:prendre": await prendre(ap.id); return json(res, 200, { ok: true, id: ap.id });
    case "tel:qui": return json(res, 200, { moi: main === ap.id, pc: main === "pc" });
    case "book:pdfData": {
      if (typeof a[0] !== "string") return json(res, 200, { ok: false, error: "Contenu invalide" });
      try { return json(res, 200, { ok: true, data: (await D.livrePdf(a[0])).toString("base64") }); }
      catch (e) { return json(res, 200, { ok: false, error: e.message }); }
    }
  }
  if (!PERMIS.has(nom) || !D.RPC[nom]) return json(res, 200, { __refus: "Ce réglage se fait sur le PC." });
  try { json(res, 200, await D.RPC[nom]({ sender: null, telephone: true }, ...a)); }
  catch (e) { json(res, 500, { error: e.message }); }
}

function evenements(req, res, ap) {
  res.writeHead(200, entetes("text/event-stream; charset=utf-8", { Connection: "keep-alive" }));
  res.write("retry: 3000\n\n");
  const f = { res, id: ap.id };
  flux.add(f);
  const ping = setInterval(() => res.write(": ping\n\n"), 20000);
  req.on("close", () => { clearInterval(ping); flux.delete(f); D.send("tel:etat", null); });
  D.send("tel:etat", null);
}
function diffuser(canal, data) {
  if (!DIFFUSES.has(canal) || !flux.size) return;
  const ligne = "data: " + JSON.stringify({ canal, data }) + "\n\n";
  for (const f of flux) { try { f.res.write(ligne); } catch (e) {} }
}

async function traiter(req, res) {
  if (!adresseLocale(req.socket.remoteAddress)) { res.destroy(); return; }
  const u = new URL(req.url, "http://x"), p = u.pathname;
  try {
    if (p === "/icon.png") return envoyer(res, 200, "image/png", fs.readFileSync(path.join(D.appDir, "app", "icon.png")), { "Cache-Control": "max-age=86400" });
    if (p === "/manifest.webmanifest") return envoyer(res, 200, "application/manifest+json", MANIFESTE);
    if (p === "/appairer" && req.method === "POST") return memeOrigine(req) ? appairer(req, res) : json(res, 403, { error: "origine" });
    const ap = appareil(req);
    if (!ap) {
      if (p === "/" && req.method === "GET") return envoyer(res, 200, "text/html; charset=utf-8", pageAppairage(""));
      return json(res, 401, { error: "téléphone pas relié" });
    }
    if (p === "/" && req.method === "GET") return envoyer(res, 200, "text/html; charset=utf-8", pageJeu());
    if (p === "/tel.js") return envoyer(res, 200, "text/javascript; charset=utf-8", fs.readFileSync(path.join(D.appDir, "app", "tel.js")));
    if (p === "/evenements") return evenements(req, res, ap);
    if (!memeOrigine(req)) return json(res, 403, { error: "origine" });
    if (p === "/appel" && req.method === "POST") return await appel(req, res, ap);
    const m = p.match(/^\/moteur\/(\d{2,5})(\/.*)$/);
    if (m) return relais(req, res, +m[1], m[2] + u.search);
    json(res, 404, { error: "introuvable" });
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: e.message }); else res.destroy();
  }
}

function demarrer() {
  const c = D.loadCfg(), port = +c.telPort || PORT_DEFAUT;
  if (serveur && portActif === port) return Promise.resolve(etat());
  arreter();
  if (!code) nouveauCode();
  return new Promise(ok => {
    const s = http.createServer((req, res) => { traiter(req, res); });
    s.requestTimeout = 0;   // les réponses du Conteur peuvent être longues
    s.on("error", e => { D.log && D.log("[téléphone] " + e.message); serveur = null; portActif = 0; ok({ ...etat(), erreur: e.code === "EADDRINUSE" ? "le port " + port + " est déjà pris" : e.message }); });
    s.listen(port, "0.0.0.0", () => { serveur = s; portActif = port; D.log && D.log("[téléphone] prêt sur le port " + port); ok(etat()); });
  });
}
function arreter() {
  for (const f of flux) { try { f.res.end(); } catch (e) {} }
  flux.clear();
  if (serveur) { try { serveur.close(); serveur.closeAllConnections && serveur.closeAllConnections(); } catch (e) {} }
  serveur = null; portActif = 0;
  rendreAuPC();
}
function etat() {
  const c = D.loadCfg(), port = portActif || +c.telPort || PORT_DEFAUT;
  const adr = adressesPC();
  return {
    on: !!c.telOn, actif: !!serveur, port, code,
    adresses: adr.map(a => "http://" + a.ip + ":" + port + "/"),
    appareils: (c.telAppareils || []).map(a => ({ id: a.id, nom: a.nom, cree: a.cree, connecte: [...flux].some(f => f.id === a.id) })),
    main: main === "pc" ? "pc" : "tel"
  };
}

/* ---------- branchement dans main.js ---------- */
function installer(deps) {
  D = deps;
  const { handle } = deps;
  handle("tel:etat", async () => {
    const e = etat();
    if (e.adresses[0] && code) {
      try { e.qr = await require("qrcode").toString(e.adresses[0], { type: "svg", margin: 1, color: { dark: "#16140f", light: "#efe6d2" } }); } catch (err) {}
    }
    return e;
  });
  handle("tel:activer", async (_e, on) => {
    const c = D.loadCfg(); c.telOn = !!on; D.saveCfg(c);
    if (on) await demarrer(); else arreter();
    return true;
  });
  handle("tel:nouveauCode", () => { nouveauCode(); return true; });
  handle("tel:oublier", (_e, id) => {
    const c = D.loadCfg();
    c.telAppareils = id ? (c.telAppareils || []).filter(a => a.id !== id) : [];
    D.saveCfg(c);
    for (const f of [...flux]) if (!id || f.id === id) { try { f.res.end(); } catch (e) {} flux.delete(f); }
    if (main !== "pc" && (!id || main === id)) rendreAuPC();
    return true;
  });
  handle("tel:reprendre", () => { rendreAuPC(); return true; });
  handle("tel:ack", () => { if (attenteAck) attenteAck(); return true; });
  if (D.loadCfg().telOn) demarrer();
}

module.exports = {
  installer, arreter, diffuser,
  pcPeutEcrire: () => main === "pc",
  // pour les tests
  _interne: { adresseLocale, adressesPC, etat, demarrer, nouveauCode: () => nouveauCode() }
};
