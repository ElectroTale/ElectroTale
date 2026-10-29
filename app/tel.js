// ElectroTale sur le téléphone : la page du jeu parle au PC par le Wi-Fi au lieu de parler à Electron.
// Chargé seulement quand la page est servie par le PC (Menu → Téléphone), jamais dans l'application elle-même.
(() => {
  "use strict";
  window.ELECTROTALE_TEL = true;
  document.documentElement.classList.add("tel");

  const perdu = () => { location.replace("/"); };   // téléphone oublié par le PC : retour à l'appairage
  const lire = r => { if(r.status === 401){ perdu(); throw new Error("téléphone pas relié"); } return r.json(); };
  const refus = v => { if(v && typeof v === "object" && v.__refus) throw new Error(v.__refus); return v; };

  // appel synchrone (le jeu lit ses sauvegardes avant de s'afficher, comme dans l'application)
  function appelSync(nom, args){
    const x = new XMLHttpRequest();
    x.open("POST", "/appel", false);
    x.setRequestHeader("Content-Type", "application/json");
    try{ x.send(JSON.stringify({nom, args})); }catch(e){ return null; }
    if(x.status === 401){ perdu(); return null; }
    if(x.status !== 200) return null;
    try{ return JSON.parse(x.responseText); }catch(e){ return null; }
  }
  const appel = (nom, ...args) => fetch("/appel", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({nom, args})})
    .then(lire).then(refus);
  const surPC = () => Promise.reject(new Error("Ce réglage se fait sur le PC."));

  // les moteurs du PC (texte, images, voix) : http://127.0.0.1:5001/... devient /moteur/5001/...
  const fetchOrig = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    if(typeof url === "string"){
      const m = url.match(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d+))?(\/.*)?$/i);
      if(m) url = "/moteur/" + (m[1] || "80") + (m[2] || "/");
    }
    return fetchOrig(url, opts);
  };

  // événements envoyés par le PC
  const ecoute = {};
  const on = canal => cb => { (ecoute[canal] = ecoute[canal] || new Set()).add(cb); return () => ecoute[canal].delete(cb); };
  let es = null;
  function brancher(){
    es = new EventSource("/evenements");
    es.onmessage = ev => {
      let m; try{ m = JSON.parse(ev.data); }catch(e){ return; }
      (ecoute[m.canal] || []).forEach(cb => { try{ cb(m.data); }catch(e){ console.error(e); } });
    };
  }

  // une seule partie à la fois : en ouvrant la page, le téléphone prend la main (le PC enregistre et se met en pause)
  const prise = appelSync("tel:prendre", []);
  let moi = prise && prise.id;

  window.engine = {
    getConfig: () => appel("engine:getConfig"),
    setConfig: surPC,
    status: () => appel("engine:status"),
    start: () => appel("engine:start"),
    stop: () => appel("engine:stop"),
    restart: () => appel("engine:restart"),
    detectGpu: () => Promise.resolve({}),
    pickExe: surPC, pickModel: surPC, useModel: surPC, download: surPC, downloadLlama: surPC, showFile: surPC,
    storage: {
      get: k => appelSync("store:get", [k]),
      set: (k, v) => appelSync("store:set", [k, v]) === true,
      del: k => appelSync("store:del", [k])
    },
    openDataDir: surPC, hfList: surPC, dlStart: surPC, dlCancel: surPC, dlPickDir: surPC, pickExtra: surPC,
    sdDownload: surPC,
    sdStart: () => appel("sd:start"),
    sdStop: surPC,
    sdStatus: () => appel("sd:status"),
    sdUseFast: () => appel("sd:useFast"),
    sdBench: surPC, sdBenchStop: surPC,
    onSdBench: on("sd:bench"), onSdStatus: on("sd:status"),
    ttsDownload: surPC,
    ttsSpeak: (t, sid, lang) => appel("tts:speak", t, sid, lang),
    onTtsProgress: on("tts:progress"), onDlProgress: on("dl:progress"),
    onStatus: on("engine:status"), onLog: on("engine:log"), onProgress: on("engine:progress"),
    appInfo: () => appel("app:info"),
    openLicences: surPC,
    // le livre PDF est imprimé par le PC puis téléchargé sur le téléphone
    bookPdf: async (html, name) => {
      const r = await appel("book:pdfData", html, name);
      if(!r || !r.ok) return r || {ok:false, error:"pas de réponse"};
      const bin = atob(r.data), u8 = new Uint8Array(bin.length);
      for(let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const a = document.createElement("a"), nom = String(name || "Grimoire").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) + ".pdf";
      a.href = URL.createObjectURL(new Blob([u8], {type:"application/pdf"})); a.download = nom;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      return {ok:true, path:nom};
    },
    contenu: {
      lire: () => appelSync("contenu:lire", []),
      origine: f => appel("contenu:origine", f),
      ouvrir: surPC,
      mod: (d, actif) => appel("contenu:mod", d, actif),
      aventure: (s, rel) => appel("contenu:aventure", s, rel),
      enregistrer: (cat, titre, texte) => appel("contenu:enregistrer", cat, titre, texte)
    },
    // pas de lanceur sur le téléphone : les modèles s'installent sur le PC
    onTel: on("tel:main")
  };

  // le PC (ou un autre téléphone) a repris la partie : on se met en pause
  function pause(qui){
    if(document.getElementById("telPause")) return;
    const d = document.createElement("div");
    d.id = "telPause";
    d.innerHTML = '<div><div style="font-size:44px">⏸</div><h2>La partie continue ' + (qui === "pc" ? "sur le PC" : "sur un autre appareil") +
      '</h2><p>Pour ne rien écraser, une seule partie se joue à la fois.</p><button class="primary">▶ Reprendre ici</button></div>';
    d.querySelector("button").onclick = () => location.reload();
    document.body.appendChild(d);
  }
  on("tel:main")(d => { if(d && d.qui !== moi) pause(d.qui); });
  if(prise === null) document.addEventListener("DOMContentLoaded", () => pause("pc"));

  document.addEventListener("DOMContentLoaded", () => {
    brancher();
  });
})();
