const { contextBridge, ipcRenderer } = require("electron");

const on = ch => cb => { const f = (e, d) => cb(d); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };

contextBridge.exposeInMainWorld("engine", {
  getConfig: () => ipcRenderer.invoke("engine:getConfig"),
  setConfig: patch => ipcRenderer.invoke("engine:setConfig", patch),
  status: () => ipcRenderer.invoke("engine:status"),
  start: () => ipcRenderer.invoke("engine:start"),
  stop: () => ipcRenderer.invoke("engine:stop"),
  restart: () => ipcRenderer.invoke("engine:restart"),
  detectGpu: () => ipcRenderer.invoke("engine:detectGpu"),
  pickExe: () => ipcRenderer.invoke("engine:pickExe"),
  pickModel: () => ipcRenderer.invoke("engine:pickModel"),
  useModel: p => ipcRenderer.invoke("engine:useModel", p),
  download: variant => ipcRenderer.invoke("engine:download", variant),
  downloadLlama: variant => ipcRenderer.invoke("engine:downloadLlama", variant),
  showFile: p => ipcRenderer.invoke("engine:showFile", p),
  storage: {
    get: k => ipcRenderer.sendSync("store:get", k),
    set: (k, v) => ipcRenderer.sendSync("store:set", k, v),
    del: k => ipcRenderer.sendSync("store:del", k)
  },
  openDataDir: () => ipcRenderer.invoke("store:openDir"),
  hfList: repo => ipcRenderer.invoke("hf:list", repo),
  dlStart: opts => ipcRenderer.invoke("dl:start", opts),
  dlCancel: () => ipcRenderer.invoke("dl:cancel"),
  dlPickDir: () => ipcRenderer.invoke("dl:pickDir"),
  pickExtra: kind => ipcRenderer.invoke("engine:pickExtra", kind),
  sdDownload: v => ipcRenderer.invoke("sd:download", v),
  sdStart: () => ipcRenderer.invoke("sd:start"),
  sdStop: () => ipcRenderer.invoke("sd:stop"),
  sdStatus: () => ipcRenderer.invoke("sd:status"),
  sdUseFast: () => ipcRenderer.invoke("sd:useFast"),
  sdBench: size => ipcRenderer.invoke("sd:bench", size),
  sdBenchStop: () => ipcRenderer.invoke("sd:benchStop"),
  onSdBench: on("sd:bench"),
  onSdStatus: on("sd:status"),
  ttsDownload: () => ipcRenderer.invoke("tts:download"),
  ttsSpeak: (t, sid, lang) => ipcRenderer.invoke("tts:speak", t, sid, lang),
  onTtsProgress: on("tts:progress"),
  onDlProgress: on("dl:progress"),
  onStatus: on("engine:status"),
  onLog: on("engine:log"),
  onProgress: on("engine:progress"),
  appInfo: () => ipcRenderer.invoke("app:info"),
  openLicences: () => ipcRenderer.invoke("app:openLicences"),
  bookPdf: (html, name) => ipcRenderer.invoke("book:pdf", html, name),
  // Documents\ElectroTale : contenu modifiable par le joueur (données seulement)
  contenu: {
    lire: () => ipcRenderer.sendSync("contenu:lire"),
    origine: fichiers => ipcRenderer.invoke("contenu:origine", fichiers),
    ouvrir: sous => ipcRenderer.invoke("contenu:ouvrir", sous),
    mod: (dossier, actif) => ipcRenderer.invoke("contenu:mod", dossier, actif),
    aventure: (source, rel) => ipcRenderer.invoke("contenu:aventure", source, rel),
    enregistrer: (cat, titre, texte) => ipcRenderer.invoke("contenu:enregistrer", cat, titre, texte)
  },
  // jouer depuis un téléphone sur le même Wi-Fi
  tel: {
    etat: () => ipcRenderer.invoke("tel:etat"),
    activer: on => ipcRenderer.invoke("tel:activer", on),
    nouveauCode: () => ipcRenderer.invoke("tel:nouveauCode"),
    oublier: id => ipcRenderer.invoke("tel:oublier", id),
    reprendre: () => ipcRenderer.invoke("tel:reprendre"),
    ack: () => ipcRenderer.invoke("tel:ack"),
    onEtat: on("tel:etat")
  },
  onTel: on("tel:main"),
  launcher: {
    scan: () => ipcRenderer.invoke("launcher:scan"),
    install: picks => ipcRenderer.invoke("launcher:install", picks),
    use: picks => ipcRenderer.invoke("launcher:use", picks),
    pause: () => ipcRenderer.invoke("launcher:pause"),
    setAtStart: on => ipcRenderer.invoke("launcher:setAtStart", on),
    onProgress: on("launcher:progress")
  }
});
