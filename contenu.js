// Dossier « Documents\ElectroTale » : tout ce qu'on peut modifier sans recompiler l'application.
// On n'y lit que des DONNÉES (.json, .txt, .css), jamais de code : rien de ce dossier n'est exécuté.
// La règle « aucun contenu sexuel avec un personnage de moins de 18 ans » reste dans le programme
// et ne dépend d'aucun fichier de ce dossier.
const { app, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const DOSSIERS = ["themes", "images", "conteur", "modes", "profils", "polices", "departs", "tarot", "destin", "liens", "voix", "codex",
  "aventures", "personnages", "modeles", "mods"];
const EXT = /\.(json|txt|css)$/i;
const IMG = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;
const AVEC_IMAGES = ["themes", "images"];   // seuls dossiers où une image est lue
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_FICHIER = 1024 * 1024;           // 1 Mo pour un fichier de réglages
const MAX_AVENTURE = 40 * 1024 * 1024;     // une aventure peut contenir des images
const MAX_FICHIERS = 400;                  // par dossier
const ORIGINE = "_origine";

const racine = () => path.join(app.getPath("documents"), "ElectroTale");

// le chemin reste-t-il bien à l'intérieur du dossier ? (pas de « ..\ », pas de raccourci vers ailleurs)
function dedans(base, p) {
  const r = path.relative(base, p);
  return !!r && !r.startsWith("..") && !path.isAbsolute(r);
}
function lireTexte(f, max) {
  const st = fs.lstatSync(f);
  if (!st.isFile() || st.isSymbolicLink()) return null;
  if (st.size > max) throw new Error("fichier trop gros (" + Math.round(st.size / 1048576) + " Mo)");
  return fs.readFileSync(f, "utf8").replace(/^﻿/, "");   // le Bloc-notes ajoute parfois une marque au début
}
// les fichiers d'un dossier (un seul niveau), triés par nom
function listerFichiers(dir, images) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isFile() && (EXT.test(d.name) || (images && IMG_RE.test(d.name))) && !d.name.startsWith("."))
      .map(d => d.name).sort((a, b) => a.localeCompare(b, "fr")).slice(0, MAX_FICHIERS);
  } catch (e) { return []; }
}

// une « couche » = la racine du joueur ou un mod. Les aventures ne sont que listées (lues à la demande).
function lireCouche(base, source, erreurs) {
  const fichiers = {}, aventures = [];
  for (const cat of DOSSIERS) {
    if (cat === "mods") continue;
    const dir = path.join(base, cat);
    for (const nom of listerFichiers(dir, AVEC_IMAGES.includes(cat))) {
      const rel = cat + "/" + nom;
      if (cat === "aventures") { if (/\.json$/i.test(nom)) aventures.push({ source, rel, nom: nom.replace(/\.json$/i, "") }); continue; }
      if (IMG_RE.test(nom)) {
        // une image est transmise au jeu sous forme de « data: » (jamais comme chemin de fichier)
        try {
          const f = path.join(dir, nom), st = fs.lstatSync(f);
          if (!st.isFile() || st.isSymbolicLink()) continue;
          if (st.size > MAX_IMAGE) throw new Error("image trop grosse (8 Mo au maximum)");
          fichiers[rel] = "data:" + IMG[nom.split(".").pop().toLowerCase()] + ";base64," + fs.readFileSync(f).toString("base64");
        } catch (e) { erreurs.push(source + " › " + rel + " : " + e.message); }
        continue;
      }
      try { const t = lireTexte(path.join(dir, nom), cat === "personnages" ? MAX_IMAGE : MAX_FICHIER); if (t != null) fichiers[rel] = t; }
      catch (e) { erreurs.push(source + " › " + rel + " : " + e.message); }
    }
  }
  return { source, fichiers, aventures };
}

function lireMods(off, erreurs) {
  const dir = path.join(racine(), "mods"), mods = [];
  let noms = [];
  try { noms = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith(".")).map(d => d.name).sort((a, b) => a.localeCompare(b, "fr")); } catch (e) {}
  for (const dossier of noms.slice(0, 100)) {
    const base = path.join(dir, dossier), m = { dossier, nom: dossier, auteur: "", version: "", description: "", actif: !off.includes(dossier) };
    try {
      const t = fs.existsSync(path.join(base, "mod.json")) ? lireTexte(path.join(base, "mod.json"), 64 * 1024) : null;
      if (t) { const j = JSON.parse(t); for (const k of ["nom", "auteur", "version", "description"]) if (typeof j[k] === "string") m[k] = j[k].slice(0, 300); }
    } catch (e) { m.erreur = "mod.json illisible : " + e.message; erreurs.push("mod " + dossier + " › mod.json : " + e.message); }
    mods.push(m);
  }
  return mods;
}

// tout le contenu, dans l'ordre d'application : les mods actifs (par ordre alphabétique), puis le dossier du joueur
function lireTout(off) {
  const erreurs = [], R = racine();
  preparer();
  const mods = lireMods(off, erreurs);
  const couches = [];
  for (const m of mods) if (m.actif) couches.push(lireCouche(path.join(R, "mods", m.dossier), "mod " + m.nom, erreurs));
  couches.push(lireCouche(R, "mon dossier", erreurs));
  return { racine: R, mods, couches, erreurs };
}

/* ---------- création du dossier et de la copie d'origine ---------- */
const LISEZ_MOI = `ELECTROTALE : MON DOSSIER
==========================

Ce dossier sert à modifier ElectroTale sans rien recompiler. Après un changement,
clique sur « 🔄 Recharger » dans ElectroTale (menu ☰ › Mon dossier), ou relance l'application.

LA RÈGLE
--------
Le dossier « _origine » contient une copie de tout le contenu de base d'ElectroTale.
Il est recréé à chaque lancement : ne le modifie pas, recopie plutôt ce qui t'intéresse.

  • Un fichier qui porte LE MÊME NOM que dans _origine REMPLACE l'original.
      exemple : copie _origine\\tarot\\00-le-mat.json dans tarot\\ et change le texte.
  • Un fichier avec un NOUVEAU NOM S'AJOUTE.
      exemple : tarot\\23-la-sirene.json ajoute une 23e carte à l'Oracle.
  • Pour retirer un élément, recopie-le et mets  "actif": false  dedans.

Les fichiers .json s'ouvrent avec le Bloc-notes. Attention aux guillemets et aux virgules :
si un fichier est mal écrit, ElectroTale l'ignore et le signale dans Mon dossier.
Les fichiers .txt sont du texte simple ; les lignes qui commencent par # sont des commentaires.
Enregistre toujours en UTF-8 (c'est le choix par défaut du Bloc-notes).

LES DOSSIERS
------------
themes\\        Couleurs de l'interface. Un .json par thème ; un .css du même nom (facultatif)
               ajoute du style, et une image du même nom (.png, .jpg, .webp) sert de fond d'écran.
images\\        logo.png remplace le logo (d20) ; fond.jpg (ou .png, .webp) est le fond d'écran
               de tous les thèmes qui n'ont pas le leur.
conteur\\       Toutes les consignes données à l'IA, en simple texte :
               consigne.txt (pour toutes les histoires), regles-du-jeu.txt, resume.txt,
               tete-a-tete.txt, souvenirs.txt, chapitre.txt, carte.txt, carte-inventee.txt,
               ouverture.txt, image-scene.txt, image-souhait.txt, absence.txt, oracle.txt.
               Les mots entre accolades, comme {heros}, sont remplacés par le jeu
               (la liste est en haut de chaque fichier de _origine).
modes\\         Les modes d'action (Faire, Dire, Penser…), un fichier par mode.
profils\\       Les profils de l'IA (Équilibré, Créatif, Cohérent) : température, longueur…
polices\\       Les polices proposées dans Apparence (polices Google Fonts ou installées sur le PC).
departs\\       Les départs proposés dans chaque nouvelle chronique (questions, fiche, ouverture).
tarot\\         Les arcanes de l'Oracle, une carte par fichier.
destin\\        Les mots qui déclenchent un jet de d20, et la caractéristique utilisée.
liens\\         Les étapes d'une relation (Haine → En couple) et les liens de départ.
voix\\          La liste des voix Kokoro proposées.
codex\\         Les types de cartes du Codex (icône, couleur, ce que l'IA doit décrire).
aventures\\     Des mondes ou des chroniques complètes (fichiers exportés depuis ElectroTale).
               Ils apparaissent sur l'écran d'accueil. Leurs scripts sont désactivés
               tant que tu ne les as pas relus.
personnages\\   Des fiches de personnage à ajouter au Codex d'une partie.
modeles\\       Tes propres IA (dépôts Hugging Face) en plus de celles du lanceur.
mods\\          Des paquets à partager : un dossier par mod, avec un mod.json (nom, auteur,
               version, description) et n'importe lesquels des dossiers ci-dessus.
               Chaque mod s'active ou se désactive dans Mon dossier.
               Ordre : contenu de base, puis les mods (ordre alphabétique), puis ton dossier.

EXEMPLES
--------
Ajouter des mots qui déclenchent le d20 (destin\\mes-mots.json) :
  [ { "carac": "Force", "mots": ["broie", "écrase"] } ]

Ajouter une IA au lanceur (modeles\\mon-ia.json), toujours un fichier .gguf de Hugging Face :
  { "type": "texte", "nom": "Mon IA", "depot": "auteur/nom-du-depot-GGUF",
    "quantifs": ["Q4_K_M"], "tailleGo": 4.9, "besoinGo": 6, "note": "Pourquoi je l'aime" }
  ("type": "images" pour un modèle d'images ; "fichier": "nom.gguf" au lieu de "quantifs".)

Une fiche de personnage (personnages\\shiva.json) :
  { "titre": "Shiva", "type": "Personnage", "declencheurs": "Shiva, la louve",
    "contenu": "Shiva est la vieille louve qui dirige la tribu…", "notes": "" }

CE QUI NE SE MODIFIE PAS
------------------------
Le code du programme : un mod qui exécute du code pourrait abîmer ton PC. Pour programmer,
il y a les Scripts d'une aventure (Monde › Scripts). Les textes des boutons et des menus
viendront avec le choix de la langue. Et la règle des moins de 18 ans (voir plus bas).

SÉCURITÉ
--------
ElectroTale ne lit ici que des données (.json, .txt, .css, images) : aucun programme ni script
n'est exécuté depuis ce dossier. Les scripts contenus dans une aventure restent coupés
jusqu'à ce que tu les actives toi-même (Monde › Scripts).
Les IA restent sans censure pour les adultes. Une seule règle est fixe et ne peut pas
être retirée par un fichier : aucun contenu sexuel ni nudité avec un personnage de
moins de 18 ans, ni dans le texte ni dans les images.
`;

const EXEMPLE_MOD = {
  "mod.json": JSON.stringify({ nom: "Exemple : nuit violette", auteur: "ElectroTale", version: "1.0",
    description: "Un petit mod d'exemple : un thème de couleurs et une carte de tarot. Copie ce dossier dans mods\\ pour l'essayer." }, null, 2),
  "themes/nuit-violette.json": JSON.stringify({ nom: "Nuit violette", couleurs: { fond: "#15111d", panneau: "#1d1729", panneau2: "#261e36",
    ligne: "#3a2e52", texte: "#e6def5", discret: "#9a8db5", accent: "#b48cff", texteIA: "#e6def5" } }, null, 2),
  "themes/nuit-violette.css": "/* Style ajouté quand le thème « Nuit violette » est choisi. */\n#story { letter-spacing: .01em; }\n",
  "tarot/23-la-sirene.json": JSON.stringify({ nom: "La Sirène", emoji: "🧜", sens: "une voix envoûtante attire le héros loin de son chemin" }, null, 2)
};

let origineEcrite = false;
function preparer() {
  const R = racine();
  try {
    fs.mkdirSync(R, { recursive: true });
    for (const d of DOSSIERS) fs.mkdirSync(path.join(R, d), { recursive: true });
    fs.writeFileSync(path.join(R, "LISEZ-MOI.txt"), LISEZ_MOI.replace(/\n/g, "\r\n"));
  } catch (e) { console.error("Dossier ElectroTale :", e); }
}
// la copie d'origine : le jeu envoie son contenu de base, on l'écrit dans _origine (et seulement là)
function ecrireOrigine(fichiers) {
  const base = path.join(racine(), ORIGINE);
  if (!fichiers || typeof fichiers !== "object") return false;
  try {
    fs.rmSync(base, { recursive: true, force: true });
    const tout = { ...fichiers };
    for (const [k, v] of Object.entries(EXEMPLE_MOD)) tout["mods/exemple-nuit-violette/" + k] = v;
    let n = 0;
    for (const [rel, txt] of Object.entries(tout)) {
      if (typeof rel !== "string" || typeof txt !== "string" || !EXT.test(rel) || ++n > 2000) continue;
      const f = path.join(base, ...rel.split("/"));
      if (!dedans(base, f)) continue;
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, /\.txt$/i.test(rel) ? txt.replace(/\r?\n/g, "\r\n") : txt);
    }
    origineEcrite = true;
    return true;
  } catch (e) { console.error("_origine :", e); return false; }
}

/* ---------- un nom de fichier propre à partir d'un titre ---------- */
const nomFichier = t => (String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "sans-titre");

function installer({ loadCfg, saveCfg, origineEnPlus, handle = (ch, fn) => ipcMain.handle(ch, fn) }) {
  // lecture synchrone : le jeu en a besoin avant d'afficher quoi que ce soit
  const lire = () => {
    try { return lireTout((loadCfg().modsOff || []).filter(x => typeof x === "string")); }
    catch (err) { return { racine: racine(), mods: [], couches: [], erreurs: [err.message] }; }
  };
  ipcMain.on("contenu:lire", e => { e.returnValue = lire(); });
  handle("contenu:origine", (e, fichiers) => ecrireOrigine(fichiers && typeof fichiers === "object" ? { ...fichiers, ...origineEnPlus() } : null));
  handle("contenu:ouvrir", (e, sous) => {
    preparer();
    const R = racine(), p = sous && DOSSIERS.concat([ORIGINE]).includes(sous) ? path.join(R, sous) : R;
    return shell.openPath(p);
  });
  handle("contenu:mod", (e, dossier, actif) => {
    const c = loadCfg(), off = new Set((c.modsOff || []).filter(x => typeof x === "string"));
    if (typeof dossier !== "string") return false;
    if (actif) off.delete(dossier); else off.add(dossier);
    c.modsOff = [...off]; saveCfg(c); return true;
  });
  // une aventure du dossier (ou d'un mod), lue seulement quand on la choisit
  handle("contenu:aventure", (e, source, rel) => {
    const R = racine();
    if (typeof rel !== "string" || !/^aventures\/[^/\\]+\.json$/i.test(rel)) return null;
    let base = R;
    const m = typeof source === "string" && source.match(/^mod (.+)$/);
    if (m) {
      const mod = lireMods([], []).find(x => x.nom === m[1]);
      if (!mod) return null;
      base = path.join(R, "mods", mod.dossier);
    }
    const f = path.join(base, ...rel.split("/"));
    if (!dedans(R, f)) return null;
    try { return lireTexte(f, MAX_AVENTURE); } catch (err) { return { erreur: err.message }; }
  });
  // enregistrer une fiche de personnage ou un monde dans le dossier du joueur (jamais ailleurs)
  handle("contenu:enregistrer", (e, cat, titre, texte) => {
    if (!["personnages", "aventures"].includes(cat) || typeof texte !== "string" || texte.length > MAX_AVENTURE) return null;
    preparer();
    const dir = path.join(racine(), cat);
    let nom = nomFichier(titre), f = path.join(dir, nom + ".json"), i = 2;
    while (fs.existsSync(f)) f = path.join(dir, nom + "-" + i++ + ".json");
    if (!dedans(racine(), f)) return null;
    fs.writeFileSync(f, texte);
    return cat + "/" + path.basename(f);
  });
  return { lire };
}

/* ---------- catalogue du lanceur : les IA ajoutées par le joueur ou par un mod ---------- */
// format d'un fichier modeles\*.json :
// { "type": "texte" | "images", "nom": "...", "depot": "auteur/depot-GGUF", "quantifs": ["Q4_K_M"] ou "fichier": "x.gguf",
//   "tailleGo": 4.9, "besoinGo": 6, "note": "..." }   (ou une liste de ces objets)
const DEPOT_RE = /^[\w.-]{1,96}\/[\w.-]{1,96}$/;
// renvoie les modèles du dossier ; « base » = nom du fichier : s'il est celui d'un modèle d'origine, il le remplace
function modelesPerso(off, idsOrigine) {
  const res = [], erreurs = [];
  let data;
  try { data = lireTout(off); } catch (e) { return { res, erreurs: [e.message] }; }
  const parNom = new Map();
  for (const c of data.couches) for (const [rel, txt] of Object.entries(c.fichiers)) {
    if (!rel.startsWith("modeles/") || !/\.json$/i.test(rel)) continue;
    try { parNom.set(rel, { source: c.source, j: JSON.parse(txt) }); } catch (e) { erreurs.push(c.source + " › " + rel + " : " + e.message); }
  }
  for (const [rel, { source, j }] of parNom) {
    const base = rel.replace(/^modeles\//, "").replace(/\.json$/i, "");
    const liste = Array.isArray(j) ? j : [j];
    if (!liste.length || liste.every(m => m && m.actif === false)) { res.push({ base, off: true }); continue; }
    liste.forEach((m, i) => {
      if (!m || typeof m !== "object" || m.actif === false) return;
      const kind = m.type === "images" ? "sd" : m.type === "texte" ? "text" : null;
      const fichier = typeof m.fichier === "string" && /^[\w.+-]{1,160}\.gguf$/i.test(m.fichier) ? m.fichier : null;
      const quants = Array.isArray(m.quantifs) ? m.quantifs.filter(q => typeof q === "string" && /^\w{1,16}$/.test(q)).slice(0, 6) : [];
      if (!kind || typeof m.depot !== "string" || !DEPOT_RE.test(m.depot) || (!fichier && !quants.length)) {
        erreurs.push(source + " › " + rel + " : il faut \"type\" (texte ou images), \"depot\" (auteur/nom) et \"quantifs\" ou \"fichier\"."); return;
      }
      const id = liste.length === 1 && idsOrigine.has(base) ? base : "perso-" + nomFichier(base) + (liste.length > 1 ? "-" + i : "");
      res.push({ base, kind, it: {
        id, name: String(m.nom || m.depot).slice(0, 80), repo: m.depot, ...(fichier ? { file: fichier } : { quants }),
        sizeGB: Math.max(0, +m.tailleGo || 0), needGB: Math.max(0, +m.besoinGo || 0),
        note: String(m.note || "Ajouté depuis ton dossier ElectroTale (" + source + ").").slice(0, 300) } });
    });
  }
  return { res, erreurs };
}
// pour la copie d'origine : le catalogue du lanceur, au format des fichiers modeles\*.json
function catalogueOrigine(catalog) {
  const out = {};
  for (const kind of ["text", "sd"]) for (const it of catalog[kind] || []) {
    out["modeles/" + it.id + ".json"] = JSON.stringify({ type: kind === "sd" ? "images" : "texte", nom: it.name, depot: it.repo,
      ...(it.file ? { fichier: it.file } : { quantifs: it.quants }), tailleGo: it.sizeGB, besoinGo: it.needGB, note: it.note }, null, 2);
  }
  return out;
}

module.exports = { installer, modelesPerso, catalogueOrigine, racine, lireTout, ecrireOrigine };
