# ÉlectroTale

🌍 [English](README.md) · **Français** · [Español](README.es.md) · [Italiano](README.it.md) · [Deutsch](README.de.md) · [Português](README.pt.md)

*Le grimoire électronique.* Un jeu d'aventure textuelle pour Windows où une IA raconte ton histoire, dessine les scènes et les lit à voix haute. Tout tourne sur ton PC : pas de compte, pas d'abonnement, pas de censure.

> **Version bêta.** ÉlectroTale est imaginé et dirigé par Béryl, qui ne sait pas programmer. Tout le code a été écrit par Claude, l'IA d'Anthropic, à partir de ses idées et de ses retours. Des bugs sont possibles : ouvre une *issue* pour les signaler.

**Réservé aux 18 ans et plus.** Les modèles d'IA proposés ne sont pas censurés. Tout contenu sexuel impliquant des mineurs est bloqué, dans le texte comme dans les images.

## Ce qu'il y a dedans

- Toute l'appli en 6 langues : français, anglais, espagnol, italien, allemand, portugais. Choisis la tienne sur l'accueil (🌍) ; l'histoire suit.
- La Forge du monde : choisis un genre et une idée, le Conteur crée la description, les peuples, les lieux, les personnages et le début de l'histoire. Tout reste modifiable dans l'Atelier.
- Un lanceur qui analyse le PC (processeur, mémoire, carte graphique) et télécharge les modèles adaptés.
- Le destin au d20, des combats et des épreuves, des cartes de tarot, un journal de quêtes, 31 hauts faits et une récompense quotidienne.
- Des images générées en local (stable-diffusion.cpp) et une voix (Kokoro via sherpa-onnx).
- Un dossier `Documents\ElectroTale` pour modifier mondes, personnages, règles et modèles.

## Installer

Télécharge l'installateur dans les *Releases*. Si Windows affiche « Windows a protégé votre ordinateur », clique sur **Informations complémentaires** puis **Exécuter quand même**.

Configuration : Windows 10 ou 11 en 64 bits, 16 Go de mémoire conseillés, une carte graphique compatible Vulkan (une puce Intel ou AMD récente suffit, en plus lent).

## Traduire ÉlectroTale

Ta langue manque, ou une phrase sonne faux ? Chaque langue est un seul fichier dans [`app/langues/`](app/langues). [TRANSLATING.md](TRANSLATING.md) explique comment corriger une traduction ou ajouter une langue, sans programmer.

## Signature du code

Signature de code gratuite prévue plus tard avec [SignPath.io](https://about.signpath.io/) et [SignPath Foundation](https://signpath.org/). Pour l'instant, l'installateur n'est pas signé. Détails dans le [README anglais](README.md#code-signing-policy).

**Vie privée.** ÉlectroTale ne se connecte à internet que lorsque tu demandes de télécharger un modèle : il le récupère alors sur Hugging Face, soumis à [sa politique de confidentialité](https://huggingface.co/privacy). Tes histoires restent sur ton PC.

## Construire depuis le code

Sous Linux, avec Node.js 20 et `nsis` : `npm install` puis `./build-win.sh`. Pour lancer l'application en développement : `npm start`.

## Licences

Le code d'ÉlectroTale est sous licence **GPL v3 ou ultérieure** (voir `LICENSE`). Les modèles d'IA ne sont pas inclus : le lanceur les télécharge depuis Hugging Face, et chacun garde sa propre licence (liste complète dans l'onglet *Licences & crédits* du jeu). **Built with Llama.** Llama 3.1 et 3.2 sont sous Llama Community License, Copyright © Meta Platforms, Inc.
