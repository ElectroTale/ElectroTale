// Langue de l'interface. L'appli est écrite en français ; les autres langues sont des dictionnaires
// « texte français → traduction » rangés dans app/langues/<code>.js (ET_LANGUES.<code> = {...}).
// Les textes affichés sont traduits au vol, y compris ceux qui apparaissent plus tard (messages, fenêtres).
// Pour ajouter une langue : copier langues/en.js, traduire les valeurs, ajouter le fichier dans index.html.
(function(){
  "use strict";
  const LANGUES = window.ET_LANGUES = window.ET_LANGUES || {};
  LANGUES.fr = LANGUES.fr || {nom:"Français", drap:"🇫🇷", t:{}};
  let cur = "fr", map = new Map(), pats = [], phraseRe = null, phraseMap = new Map();
  const orig = new WeakMap(), lastSet = new WeakMap(), origAttr = new WeakMap();
  const ATTRS = ["title", "placeholder", "aria-label"];
  // zones jamais traduites (le récit, ce que le joueur écrit, le texte de l'IA)
  const SKIP = "#story .chunk, #talkMsgs, .tk-msg, #ctx, #absText, #engLog, textarea, script, style, code, pre, [data-notr]";
  // zones de contenu du joueur : seulement les textes identiques à un texte de l'appli (« Nouvelle chronique »…)
  const EXACT = ".t, .ex, .p, .jr-t, .jr-d, .fb-foe, .fb-what, .tribbon, .hm-char .s, .ctitle, [data-exact]";
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const norm = s => s.replace(/\s+/g, " ").trim();

  function prepare(code){
    map = new Map(); pats = []; phraseMap = new Map(); phraseRe = null;
    const d = (LANGUES[code] || {}).t || {};
    const keys = Object.keys(d);
    for(const k of keys){
      const v = d[k]; if(typeof v !== "string" || !v) continue;
      const nk = norm(k);
      if(/\{\d\}/.test(nk)){
        const parts = nk.split(/\{(\d)\}/), order = [];
        let re = "^";
        parts.forEach((p, i) => { if(i % 2){ re += "([\\s\\S]+?)"; order.push(+p); } else re += esc(p); });
        pats.push({re:new RegExp(re + "$"), order, t:v, len:nk.length});
      } else {
        map.set(nk, v);
        if(nk.length >= 5 && /[\p{L}]{2}/u.test(nk) && (/\s/.test(nk) || nk.length >= 7)) phraseMap.set(nk, v);
      }
    }
    pats.sort((a, b) => b.len - a.len);
    const ph = [...phraseMap.keys()].sort((a, b) => b.length - a.length);
    if(ph.length) phraseRe = new RegExp("(?<![\\p{L}\\p{N}])(?:" + ph.map(esc).join("|") + ")(?![\\p{L}\\p{N}])", "gu");
  }
  function trCore(core, exactOnly){
    let r = map.get(core);
    if(r != null || exactOnly) return r;
    for(const p of pats){
      const m = core.match(p.re);
      if(m){
        const vals = []; p.order.forEach((n, i) => vals[n] = m[i + 1]);
        const r1 = p.t.replace(/\{(\d)\}/g, (x, n) => { const v = vals[+n] == null ? "" : vals[+n]; const t = /\p{L}/u.test(v) ? trCore(norm(v), false) : null; return t != null ? t : v; });
        if(r1 !== core) return r1;
      }
    }
    if(phraseRe){
      phraseRe.lastIndex = 0;
      const r2 = core.replace(phraseRe, m => phraseMap.get(m));
      if(r2 !== core) return r2;
    }
    return null;
  }
  function tr(s, exactOnly){
    if(cur === "fr" || s == null) return s;
    s = String(s);
    const core = norm(s); if(!core || !/\p{L}/u.test(core)) return s;
    const r = trCore(core, exactOnly);
    if(r == null) return s;
    return (s.match(/^\s*/)[0]) + r + (s.match(/\s*$/)[0]);
  }
  const zone = el => !el ? "skip" : el.closest(SKIP) ? "skip" : el.closest(EXACT) ? "exact" : "full";

  function doText(n){
    const el = n.parentElement, z = zone(el);
    if(z === "skip") return;
    let fr = orig.get(n);
    if(fr == null || n.nodeValue !== lastSet.get(n)){ fr = n.nodeValue; orig.set(n, fr); }
    const t = cur === "fr" ? fr : tr(fr, z === "exact");
    if(t !== n.nodeValue){ lastSet.set(n, t); n.nodeValue = t; } else lastSet.set(n, t);
  }
  function doAttrs(el){
    if(el.closest(SKIP + ", " + EXACT) && !el.matches("textarea, input")) return;
    let o = origAttr.get(el); if(!o){ o = {}; origAttr.set(el, o); }
    for(const a of ATTRS){
      if(!el.hasAttribute(a)) continue;
      const v = el.getAttribute(a);
      if(o[a] == null || v !== o["_" + a]) o[a] = v;
      const t = cur === "fr" ? o[a] : tr(o[a]);
      o["_" + a] = t;
      if(t !== v) el.setAttribute(a, t);
    }
  }
  function walk(root){
    if(root.nodeType === 3) return doText(root);
    if(root.nodeType !== 1) return;
    if(root.matches(SKIP) && !root.matches("textarea, input")) return;
    if(root.hasAttribute && ATTRS.some(a => root.hasAttribute(a))) doAttrs(root);
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: n => n.nodeType === 1 && n.matches(SKIP) && !n.matches("textarea, input") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    let n;
    while((n = it.nextNode())){
      if(n.nodeType === 3) doText(n);
      else if(ATTRS.some(a => n.hasAttribute(a))) doAttrs(n);
    }
  }
  let obs = null;
  function observe(){
    if(obs) return;
    obs = new MutationObserver(list => {
      for(const m of list){
        if(m.type === "childList") m.addedNodes.forEach(walk);
        else if(m.type === "characterData") { if(m.target.nodeValue !== lastSet.get(m.target)) doText(m.target); }
        else if(m.type === "attributes" && ATTRS.includes(m.attributeName)){ const o = origAttr.get(m.target); if(!o || m.target.getAttribute(m.attributeName) !== o["_" + m.attributeName]) doAttrs(m.target); }
      }
    });
    obs.observe(document.documentElement, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:ATTRS});
  }
  let titleFr = null;
  function setLang(code){
    if(!LANGUES[code]) code = "fr";
    cur = code; prepare(code);
    document.documentElement.lang = code;
    if(titleFr == null) titleFr = document.title;
    document.title = tr(titleFr);
    if(document.body) walk(document.body);
    observe();
  }
  // les fenêtres alert / confirm / prompt passent aussi par le dictionnaire
  for(const f of ["alert", "confirm", "prompt"]){
    const o = window[f];
    if(typeof o === "function") window[f] = function(msg, ...rest){ return o.call(window, tr(msg), ...rest); };
  }
  // les crochets du récit ([Jet : 14 contre 12 — Réussite]) s'affichent dans la langue choisie, le texte envoyé à l'IA ne change pas
  function brackets(text){
    if(cur === "fr" || !text) return text;
    return String(text).replace(/\[([^\]\n]{2,300})\]/g, (m, inner) => {
      const t = tr(inner);
      return t === inner && phraseRe ? "[" + inner.replace(phraseRe, x => phraseMap.get(x)) + "]" : "[" + t + "]";
    });
  }
  // la langue du système, pour le premier lancement
  function guess(){
    const l = String((navigator.languages && navigator.languages[0]) || navigator.language || "fr").slice(0, 2).toLowerCase();
    return LANGUES[l] ? l : (l === "fr" ? "fr" : (LANGUES.en ? "en" : "fr"));
  }
  window.I18N = {tr, setLang, brackets, guess, get lang(){ return cur; }, langues:() => Object.keys(LANGUES).map(c => ({code:c, nom:LANGUES[c].nom, drap:LANGUES[c].drap || ""}))};
})();
