// Rassemble les licences de tout ce qui est livré avec ElectroTale (modules, voix) dans licences/.
// Utilisé par build-win.sh : node collect-licences.js <dossier de l'app préparée>
const fs = require("fs");
const path = require("path");
const stage = path.resolve(process.argv[2] || ".");
const outDir = path.join(stage, "licences");
fs.mkdirSync(outDir, { recursive: true });
const isLic = n => /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(n);
const parts = [], seen = new Set();
function pkgDirs(nm) {
  if (!fs.existsSync(nm)) return [];
  const out = [];
  for (const n of fs.readdirSync(nm)) {
    if (n.startsWith(".")) continue;
    const p = path.join(nm, n);
    if (n.startsWith("@")) out.push(...pkgDirs(p));
    else if (fs.existsSync(path.join(p, "package.json"))) { out.push(p); out.push(...pkgDirs(path.join(p, "node_modules"))); }
  }
  return out;
}
const rows = [];
for (const dir of pkgDirs(path.join(stage, "node_modules"))) {
  let pj; try { pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")); } catch (e) { continue; }
  const id = pj.name + "@" + pj.version;
  if (seen.has(id)) continue; seen.add(id);
  const lic = typeof pj.license === "string" ? pj.license : (pj.license && pj.license.type) || "voir le texte";
  rows.push([pj.name, pj.version, lic]);
  const files = fs.readdirSync(dir).filter(isLic);
  parts.push("=".repeat(78) + "\n" + id + " — " + lic + (pj.homepage ? "\n" + pj.homepage : "") + "\n" + "=".repeat(78) + "\n" +
    (files.length ? files.map(f => fs.readFileSync(path.join(dir, f), "utf8").trim()).join("\n\n") : "(pas de fichier de licence fourni ; licence déclarée : " + lic + ")") + "\n");
}
// la voix Kokoro et ses données de prononciation
const voix = path.join(stage, "voix");
if (fs.existsSync(voix)) for (const d of fs.readdirSync(voix)) {
  const lf = path.join(voix, d, "LICENSE");
  if (fs.existsSync(lf)) parts.push("=".repeat(78) + "\nVoix " + d + " (modèle Kokoro, k2-fsa/sherpa-onnx)\n" + "=".repeat(78) + "\n" + fs.readFileSync(lf, "utf8").trim() + "\n");
}
fs.writeFileSync(path.join(outDir, "LICENCES-TIERS.txt"),
  "ElectroTale — licences des composants livrés avec l'application\n" +
  "Electron et Chromium : voir LICENSE et LICENSES.chromium.html à côté de ElectroTale.exe.\n\n" +
  "Bibliothèques natives incluses dans les modules ci-dessous :\n" +
  "- llama.cpp / ggml (MIT) — https://github.com/ggml-org/llama.cpp\n" +
  "- stable-diffusion.cpp (MIT) — https://github.com/leejet/stable-diffusion.cpp\n" +
  "- sherpa-onnx (Apache 2.0) — https://github.com/k2-fsa/sherpa-onnx\n" +
  "- ONNX Runtime (MIT) — https://github.com/microsoft/onnxruntime\n" +
  "- espeak-ng et ses données de prononciation (GPL v3) — https://github.com/espeak-ng/espeak-ng\n" +
  "- Kokoro-82M, modèle de voix (Apache 2.0) — https://huggingface.co/hexgrad/Kokoro-82M\n\n" +
  rows.sort((a, b) => a[0].localeCompare(b[0])).map(r => r[0] + " " + r[1] + " — " + r[2]).join("\n") + "\n\n" + parts.join("\n"));
// les modèles que le lanceur télécharge (pas livrés, mais leurs licences demandent ces mentions)
fs.writeFileSync(path.join(outDir, "LICENCES-MODELES.txt"),
  "ElectroTale — modèles d'IA téléchargés par le lanceur\n" +
  "Ils ne sont pas livrés avec ElectroTale : le lanceur les télécharge depuis Hugging Face.\n\n" +
  "Built with Llama\n" +
  "Llama 3.1 is licensed under the Llama 3.1 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved.\n" +
  "Llama 3.2 is licensed under the Llama 3.2 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved.\n" +
  "Licences : https://www.llama.com/llama3_1/license/ et https://www.llama.com/llama3_2/license/\n" +
  "Politique d'utilisation : https://www.llama.com/llama3_1/use-policy/\n\n" +
  "Mistral Nemo 12B et Mistral Small 24B (Mistral AI) : Apache 2.0 — https://www.apache.org/licenses/LICENSE-2.0\n" +
  "Rocinante 12B (TheDrummer) : licence non précisée par l'auteur ; variante de Mistral Nemo (Apache 2.0).\n\n" +
  "Stable Diffusion 1.5 et DreamShaper rapide (LCM) : CreativeML OpenRAIL-M — https://huggingface.co/spaces/CompVis/stable-diffusion-license\n" +
  "DreamShaper XL (Lykon) : CreativeML OpenRAIL++-M (base SDXL).\n" +
  "Ces licences interdisent notamment : exploiter ou nuire à des mineurs ; diffamer, harceler ou usurper une personne ;\n" +
  "diffuser de fausses informations pour tromper ; enfreindre la loi. Ces interdictions s'appliquent à tout usage d'ElectroTale.\n\n" +
  "Les versions « abliterated » sont des variantes faites par la communauté (huihui-ai, QuantFactory, bartowski, MaziyarPanahi, Steward, second-state, KoboldCpp).\n");
console.log("licences : " + rows.length + " modules");
