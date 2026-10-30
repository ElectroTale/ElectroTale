# Translating ÉlectroTale

🌍 Français plus bas · Instrucciones similares en español, italiano, deutsch, português: the steps are the same, see the examples below.

ÉlectroTale is written in French. Every other language is **one file** in [`app/langues/`](app/langues): a list of *French text → translation*. No programming needed.

```js
ET_LANGUES.en = {nom: "English", drap: "🇬🇧", t: {
  "Nouvelle chronique": "New chronicle",
  "Points de vie : {0}/{1}{2}": "Hit points: {0}/{1}{2}",
  ...
}};
```

All language files are sorted the same way, so line 120 of `en.js` and line 120 of `de.js` are the same French text. Keep `en.js` open next to yours if you don't read French.

## Fix a translation

1. Open the file of your language, for example [`app/langues/es.js`](app/langues/es.js).
2. Change **only the text on the right** of the colon. Never change the French text on the left: it is how the app finds the sentence.
3. Open a pull request (on GitHub you can edit the file directly in the browser with the ✏️ button).

## Add a new language

1. Copy `app/langues/en.js` to `app/langues/<code>.js`, where `<code>` is the two-letter code of your language (`nl`, `pl`, `ja`, `tr`…).
2. In the new file, replace `ET_LANGUES.en` with `ET_LANGUES.<code>`, then set `nom` (the language name in that language, e.g. `"Nederlands"`) and `drap` (a flag emoji).
3. Translate the texts on the right. Untranslated lines can stay in English, or be deleted: a missing line is simply shown in French.
4. In [`app/index.html`](app/index.html), add one line next to the other languages:
   ```html
   <script src="langues/<code>.js"></script>
   ```
5. Open a pull request. Your language then appears in the 🌍 menu of the home screen.

The **story** language (what the Storyteller AI writes) is a separate list, for now English, French, Spanish, Italian, German and Portuguese. A new interface language works even if the story stays in one of those; ask in an issue if you want your language added there too.

## Rules

- Keep `{0}`, `{1}`… exactly: they are replaced by names and numbers. You may move them inside the sentence.
- Keep emojis and the dice notation (`d20`, `2d6`). German uses `W20`: it's fine to adapt it like that.
- Texts in square brackets such as `[Jet : {0} — {1}]` are shown inside the story: keep the brackets.
- Speak to the player informally (*tu*, *du*, *tú*…) like the French version, unless it sounds wrong in your language.
- The game is for adults, but the rule about minors stays strict in every language.

To test: `npm install` then `npm start`, pick your language with 🌍 on the home screen. Any text still in French means a line is missing: open an issue with a screenshot.

---

## Traduire ÉlectroTale (français)

Chaque langue est **un seul fichier** dans `app/langues/` : une liste *texte français → traduction*.

- **Corriger une traduction** : ouvre le fichier de la langue, change seulement le texte à droite des deux-points, puis propose une *pull request* (bouton ✏️ de GitHub).
- **Ajouter une langue** : copie `app/langues/en.js` en `app/langues/<code>.js`, remplace `ET_LANGUES.en` par `ET_LANGUES.<code>`, règle `nom` et `drap`, traduis les textes à droite, puis ajoute `<script src="langues/<code>.js"></script>` dans `app/index.html` à côté des autres langues.
- Garde les `{0}`, `{1}`… : ils sont remplacés par des noms et des nombres.
