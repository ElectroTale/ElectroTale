# ÉlectroTale

🌍 [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Italiano](README.it.md) · **Deutsch** · [Português](README.pt.md)

*Das elektronische Grimoire.* Ein Textabenteuer für Windows, in dem eine KI deine Geschichte erzählt, die Szenen zeichnet und sie vorliest. Alles läuft auf deinem PC: kein Konto, kein Abo, keine Zensur.

> **Beta.** ÉlectroTale wurde von Béryl erdacht und geleitet, ohne Programmierkenntnisse. Der gesamte Code wurde von Claude, der KI von Anthropic, nach Béryls Ideen und Rückmeldungen geschrieben. Fehler sind möglich: Melde sie bitte über ein *Issue*.

**Nur für Erwachsene (ab 18).** Die angebotenen KI-Modelle sind unzensiert. Sexuelle Inhalte mit Minderjährigen werden blockiert, im Text wie in Bildern.

## Was drin ist

- Die ganze App in 6 Sprachen: Deutsch, Englisch, Französisch, Spanisch, Italienisch, Portugiesisch. Wähle deine auf dem Startbildschirm (🌍); die Geschichte folgt.
- Die Weltenschmiede: Wähle ein Genre und eine Idee, und der Erzähler erschafft Beschreibung, Völker, Orte, Figuren und den Anfang der Geschichte. Alles bleibt in der Werkstatt bearbeitbar.
- Ein Launcher, der deinen PC prüft (Prozessor, Speicher, Grafikkarte) und die passenden Modelle herunterlädt.
- Schicksal per W20, Kämpfe und Proben, Tarotkarten, ein Quest-Tagebuch, 31 Heldentaten und eine tägliche Belohnung.
- Lokal erzeugte Bilder (stable-diffusion.cpp) und eine Erzählerstimme (Kokoro über sherpa-onnx).
- Ein Ordner `Documents\ElectroTale`, um Welten, Figuren, Regeln und Modelle zu ändern.

## Installieren

Lade das Installationsprogramm unter *Releases* herunter. Wenn Windows „Der Computer wurde durch Windows geschützt“ anzeigt, klicke auf **Weitere Informationen** und dann auf **Trotzdem ausführen**.

Voraussetzungen: Windows 10 oder 11 (64 Bit), 16 GB RAM empfohlen, eine Vulkan-fähige Grafikkarte (ein aktueller Intel- oder AMD-Chip reicht auch, langsamer).

Hinweis: Kokoro hat keine deutsche Stimme. Für deutsche Geschichten klingt eine deutsche Windows-Stimme natürlicher (Aussehen & Stimme).

## ÉlectroTale übersetzen

Deine Sprache fehlt oder ein Satz klingt falsch? Jede Sprache ist eine einzige Datei in [`app/langues/`](app/langues). [TRANSLATING.md](TRANSLATING.md) erklärt, wie man eine Übersetzung korrigiert oder eine Sprache hinzufügt, ganz ohne Programmieren.

## Datenschutz

ÉlectroTale geht nur ins Internet, wenn du ein Modell herunterladen lässt: Es holt es dann von Hugging Face, gemäß [deren Datenschutzerklärung](https://huggingface.co/privacy). Deine Geschichten bleiben auf deinem PC. Das Installationsprogramm ist noch nicht signiert ([Details](README.md#code-signing-policy)).

## Lizenzen

Der Code von ÉlectroTale steht unter **GPL v3 oder später** (siehe `LICENSE`). KI-Modelle sind nicht enthalten: Der Launcher lädt sie von Hugging Face, und jedes behält seine eigene Lizenz (vollständige Liste im Reiter *Lizenzen & Credits* des Spiels). **Built with Llama.** Llama 3.1 und 3.2 stehen unter der Llama Community License, Copyright © Meta Platforms, Inc.
