const { tokenize } = require('./analyze');
const { stemWord, byDocToObj } = require('./normalize');
const { DEFAULT_STOPWORDS } = require('./stopwords');

// Extract 2–4 word phrases (collocations) from each page's text and measure how
// many of the pages (sites) share each phrase — the core of competitor overlap.
// The 2–4 range matches the КОЛЛОКАЦИИ_КОНКУРЕНТОВ input of
// universal-seo-prompt-ecommerce.md («частые 2–4-словные сочетания из текстов
// топа»); 4-word collocations shared by several sites are strong TF-IDF themes.
//
// Word forms are collapsed by stem so "сушка для посуды" and "сушку для посуды"
// count as the same phrase; the most frequent surface form is the label.
// Phrases whose first/last word is a stop-word (or a number) are dropped — they
// are rarely meaningful ("для посуды и").
//
// Returns [{ phrase, sites, count, byDoc: { idx: count } }] sorted by site
// coverage desc. Only phrases appearing on >= minSites pages are kept.
function extractPhrases(texts, { stopSet = null, ns = [2, 3, 4], minWordLen = 3, minSites = 2, limit = 400 } = {}) {
  const stop = stopSet || new Set(DEFAULT_STOPWORDS);
  const map = new Map(); // stemmed key -> { byDoc: Map(idx->count), surf: Map(surface->count) }

  texts.forEach((text, di) => {
    const tokens = tokenize(text); // lowercase, unicode-aware
    for (const n of ns) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const gram = tokens.slice(i, i + n);
        const first = gram[0];
        const last = gram[n - 1];
        if (stop.has(first) || stop.has(last)) continue;
        if (first.length < minWordLen || last.length < minWordLen) continue;
        if (gram.some((w) => /^[\d-]+$/.test(w))) continue;

        const key = gram.map(stemWord).join(' ');
        const surf = gram.join(' ');
        let e = map.get(key);
        if (!e) { e = { byDoc: new Map(), surf: new Map() }; map.set(key, e); }
        e.byDoc.set(di, (e.byDoc.get(di) || 0) + 1);
        e.surf.set(surf, (e.surf.get(surf) || 0) + 1);
      }
    }
  });

  const out = [];
  for (const e of map.values()) {
    if (e.byDoc.size < minSites) continue;
    let best = null;
    for (const [s, c] of e.surf) {
      if (!best || c > best.c || (c === best.c && s.length < best.s.length)) best = { s, c };
    }
    let count = 0;
    for (const c of e.byDoc.values()) count += c;
    out.push({ phrase: best.s, sites: e.byDoc.size, count, byDoc: byDocToObj(e.byDoc) });
  }

  out.sort((a, b) => b.sites - a.sites || b.count - a.count || a.phrase.localeCompare(b.phrase, 'ru'));
  return out.slice(0, limit);
}

module.exports = { extractPhrases };
