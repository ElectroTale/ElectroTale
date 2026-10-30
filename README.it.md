# ÉlectroTale

🌍 [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · **Italiano** · [Deutsch](README.de.md) · [Português](README.pt.md)

*Il grimorio elettronico.* Un gioco d'avventura testuale per Windows in cui un'IA racconta la tua storia, disegna le scene e le legge ad alta voce. Tutto gira sul tuo PC: niente account, niente abbonamento, niente censura.

> **Beta.** ÉlectroTale è ideato e diretto da Béryl, che non sa programmare. Tutto il codice è stato scritto da Claude, l'IA di Anthropic, a partire dalle sue idee e dai suoi riscontri. Possono esserci bug: apri una *issue* per segnalarli.

**Riservato ai maggiori di 18 anni.** I modelli di IA proposti non sono censurati. Qualsiasi contenuto sessuale che coinvolga minori è bloccato, nel testo come nelle immagini.

## Cosa contiene

- Tutta l'app in 6 lingue: italiano, inglese, francese, spagnolo, tedesco e portoghese. Scegli la tua nella schermata iniziale (🌍); la storia la segue.
- Un launcher che analizza il PC (processore, memoria, scheda grafica) e scarica i modelli adatti.
- Il destino su un d20, combattimenti e prove, carte dei tarocchi, un diario delle missioni, 31 imprese e una ricompensa giornaliera.
- Immagini generate in locale (stable-diffusion.cpp) e una voce narrante (Kokoro tramite sherpa-onnx).
- Una cartella `Documents\ElectroTale` per modificare mondi, personaggi, regole e modelli.

## Installare

Scarica il programma di installazione dalle *Releases*. Se Windows mostra «Windows ha protetto il PC», clicca su **Ulteriori informazioni** e poi su **Esegui comunque**.

Requisiti: Windows 10 o 11 a 64 bit, 16 GB di RAM consigliati, una scheda grafica compatibile Vulkan (va bene anche un chip Intel o AMD recente, più lentamente).

## Tradurre ÉlectroTale

Manca la tua lingua o una frase suona male? Ogni lingua è un solo file in [`app/langues/`](app/langues). [TRANSLATING.md](TRANSLATING.md) spiega come correggere una traduzione o aggiungere una lingua, senza programmare.

## Privacy

ÉlectroTale si collega a internet solo quando gli chiedi di scaricare un modello: lo prende da Hugging Face, secondo [la sua informativa sulla privacy](https://huggingface.co/privacy). Le tue storie restano sul tuo PC. Il programma di installazione non è ancora firmato ([dettagli](README.md#code-signing-policy)).

## Licenze

Il codice di ÉlectroTale è sotto licenza **GPL v3 o successiva** (vedi `LICENSE`). I modelli di IA non sono inclusi: il launcher li scarica da Hugging Face e ognuno mantiene la propria licenza (elenco completo nella scheda *Licenze e crediti* del gioco). **Built with Llama.** Llama 3.1 e 3.2 sono sotto Llama Community License, Copyright © Meta Platforms, Inc.
