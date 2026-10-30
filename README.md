# ÉlectroTale

🌍 **English** · [Français](README.fr.md) · [Español](README.es.md) · [Italiano](README.it.md) · [Deutsch](README.de.md) · [Português](README.pt.md)

*The electronic grimoire.* A text adventure game for Windows where an AI tells your story, draws the scenes and reads them aloud. Everything runs on your PC: no account, no subscription, no censorship.

> **Beta.** ÉlectroTale is imagined and directed by Béryl, who doesn't code. All the code was written by Claude, Anthropic's AI, from Béryl's ideas and feedback. Bugs are possible: open an *issue* to report them.

**Adults only (18+).** The AI models offered are uncensored. Any sexual content involving minors is blocked, in text and in images.

## What's inside

- The whole app in 6 languages: English, French, Spanish, Italian, German, Portuguese. Pick yours on the home screen (🌍); the story follows.
- The World Forge: pick a genre and an idea, and the Storyteller creates the description, peoples, places, characters and the beginning of the story. Everything stays editable in the Workshop.
- A launcher that checks your PC (processor, memory, graphics card) and downloads the models that fit.
- Fate on a d20, fights and trials, tarot cards, a quest journal, 31 achievements and a daily reward.
- Images generated locally (stable-diffusion.cpp) and a narrator voice (Kokoro through sherpa-onnx).
- A `Documents\ElectroTale` folder to change worlds, characters, rules and models.

## Install

Download the installer from the *Releases*. If Windows shows “Windows protected your PC”, click **More info**, then **Run anyway**.

Requirements: 64-bit Windows 10 or 11, 16 GB of RAM recommended, a Vulkan-compatible graphics card (a recent Intel or AMD chip works too, more slowly).

## Translate ÉlectroTale

Your language is missing, or a sentence sounds wrong? Each language is a single file in [`app/langues/`](app/langues). [TRANSLATING.md](TRANSLATING.md) explains how to fix a translation or add a new language, without any programming.

## Code signing policy

Free code signing is planned later with [SignPath.io](https://about.signpath.io/) and the [SignPath Foundation](https://signpath.org/). For now, the installer is not signed.

- Authors and reviewers: [Béryl](https://github.com/ElectroTale) (ElectroTale and Nojf-design accounts). The code is written by Claude (Anthropic) at Béryl's request, and every change goes through this repository.
- Signing approval: [Béryl](https://github.com/ElectroTale).
- Installers are built automatically by GitHub Actions from this repository (`.github/workflows/build.yml`).

**Privacy.** This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. ÉlectroTale only connects to the internet when you ask it to download a model: it then fetches it from Hugging Face, subject to [its privacy policy](https://huggingface.co/privacy). Your stories stay on your PC.

## Build from source

On Linux, with Node.js 20 and `nsis`:

```sh
npm install
./build-win.sh
```

The script produces `ElectroTale-Installation.exe`. To run the app in development: `npm start`.

## Licences

ÉlectroTale's code is licensed under **GPL v3 or later** (see `LICENSE`).

AI models are not included: the launcher downloads them from Hugging Face, and each one keeps its own licence (full list in the game's *Licences & credits* tab). **Built with Llama.** Llama 3.1 and 3.2 are under the Llama Community License, Copyright © Meta Platforms, Inc.
