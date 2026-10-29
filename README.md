# ÉlectroTale

*Le grimoire électronique.* Un jeu d'aventure textuelle pour Windows où une IA raconte ton histoire, dessine les scènes et les lit à voix haute. Tout tourne sur ton PC : pas de compte, pas d'abonnement, pas de censure.

> **Version bêta.** ÉlectroTale est imaginé et dirigé par Béryl, qui ne sait pas programmer. Tout le code a été écrit par Claude, l'IA d'Anthropic, à partir de ses idées et de ses retours. Des bugs sont possibles : ouvre une *issue* pour les signaler.

**Réservé aux 18 ans et plus.** Les modèles d'IA proposés ne sont pas censurés. Tout contenu sexuel impliquant des mineurs est bloqué, dans le texte comme dans les images.

## Ce qu'il y a dedans

- Un lanceur qui analyse le PC (processeur, mémoire, carte graphique) et télécharge les modèles adaptés.
- Le destin au d20, des combats et des épreuves, des cartes de tarot, un journal de quêtes et 31 hauts faits, une récompense quotidienne.
- Des images générées en local (stable-diffusion.cpp) et une voix (Kokoro via sherpa-onnx).
- Six langues d'histoire : français, anglais, espagnol, italien, allemand, portugais.
- Un dossier `Documents\ElectroTale` pour modifier mondes, personnages, règles et modèles.
- Jouer depuis un téléphone Android ou un iPhone sur le même Wi-Fi : le PC fait tourner les IA, le téléphone affiche l'aventure (Menu → Téléphone).

## Installer

Télécharge l'installateur dans les *Releases*. Si Windows affiche « Windows a protégé votre ordinateur », clique sur **Informations complémentaires** puis **Exécuter quand même**.

Configuration : Windows 10 ou 11 en 64 bits, 16 Go de mémoire conseillés, une carte graphique compatible Vulkan (une puce Intel ou AMD récente suffit, en plus lent).

## Code signing policy

Signature de code gratuite prévue plus tard avec [SignPath.io](https://about.signpath.io/) et [SignPath Foundation](https://signpath.org/). Pour l’instant, l’installateur n’est pas signé.

- Auteurs et relecteurs : [Béryl](https://github.com/ElectroTale) (comptes ElectroTale et Nojf-design). Le code est écrit par Claude (Anthropic) à la demande de Béryl, et chaque modification passe par ce dépôt.
- Approbation des signatures : [Béryl](https://github.com/ElectroTale).
- Les installateurs sont construits automatiquement par GitHub Actions à partir de ce dépôt (`.github/workflows/build.yml`).

**Vie privée.** This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. ÉlectroTale ne se connecte à internet que lorsque tu demandes de télécharger un modèle : il le récupère alors sur Hugging Face, soumis à [sa politique de confidentialité](https://huggingface.co/privacy). Tes histoires restent sur ton PC.

## Construire depuis le code

Sous Linux, avec Node.js 20 et `nsis` :

```sh
npm install
./build-win.sh
```

Le script produit `ElectroTale-Installation.exe`. Pour lancer l'application en développement : `npm start`.

## Licences

Le code d'ÉlectroTale est sous licence **GPL v3 ou ultérieure** (voir `LICENSE`).

Les modèles d'IA ne sont pas inclus : le lanceur les télécharge depuis Hugging Face, et chacun garde sa propre licence (liste complète dans l'onglet *Licences & crédits* du jeu). **Built with Llama.** Llama 3.1 et 3.2 sont sous Llama Community License, Copyright © Meta Platforms, Inc.

---

## English

*ÉlectroTale* is a local, offline text adventure game for Windows: an AI narrates your story, illustrates scenes and reads them aloud. No account, no subscription, no filter. **Adults only (18+).**

**Beta.** Designed and directed by Béryl, who doesn't code; all code was written by Claude, Anthropic's AI. Bug reports are welcome as issues.

Build with Node.js 20 and `nsis` on Linux: `npm install && ./build-win.sh`. Code licensed under GPL-3.0-or-later. AI models are downloaded separately and keep their own licenses. Built with Llama.
