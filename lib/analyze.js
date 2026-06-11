const { STOPWORDS } = require('./stopwords');

// Split text into words. Unicode-aware so Cyrillic works correctly.
function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) || [];
}

// Analyze an array of page texts. For every kept word we track:
//   count — total occurrences across all pages
//   docs  — on how many distinct pages it appears (document frequency)
//   _byDoc — Map(docIndex -> occurrences on that page)
// docs is the strongest "junk vs. real" signal for LSI: a word on many of the
// top pages is part of the shared semantic core; a one-page word is usually noise.
// _byDoc lets the UI recompute totals when the user disables a site, without
// re-scraping. Strip/serialize it before sending over IPC.
//
// Returns [{ word, count, docs, _byDoc }] sorted by count desc.
function analyze(texts, { minLen = 3, stopSet = null } = {}) {
  const stop = stopSet || STOPWORDS;
  const perDoc = new Map(); // word -> Map(docIndex -> count)

  texts.forEach((text, di) => {
    for (const word of tokenize(text)) {
      if (word.length < minLen) continue;
      if (/^[\d-]+$/.test(word)) continue; // pure numbers / dashes
      if (stop.has(word)) continue;
      let m = perDoc.get(word);
      if (!m) { m = new Map(); perDoc.set(word, m); }
      m.set(di, (m.get(di) || 0) + 1);
    }
  });

  const out = [];
  for (const [word, m] of perDoc) {
    let count = 0;
    for (const c of m.values()) count += c;
    out.push({ word, count, docs: m.size, _byDoc: m });
  }
  return out.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'ru'));
}

module.exports = { tokenize, analyze };
