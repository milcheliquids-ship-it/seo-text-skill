const { phraseStems } = require('./select');
const { stemWord } = require('./normalize');
const { DEFAULT_STOPWORDS } = require('./stopwords');

// Stage 4 — LSI cleanup. Subtract the chosen keywords' word-stems from an LSI
// word list, so the brief's LSI section only carries SEMANTIC words that aren't
// already present in the main keywords. Mirrors the user's manual method:
// "вычитание по основам выбранных ключей".
//
//   words:    [{ word, count, ... }]    — output of the "Поиск LSI" tool
//   keywords: ["купить сушилку посуды", ...] — Stage-3 selected phrases
//
//          keyword stems            LSI words
//          { куп, сушилк, посуд }   сушилка ─┐ stem сушилк ∈ set → removed
//                                   посуда  ─┤ stem посуд  ∈ set → removed
//                                   кухня   ─┘ stem кухн   ∉ set → kept
//
// Returns { kept, removed, coveredStems } — same entry shape, partitioned.
function cleanLsi(words, keywords, opts = {}) {
  const { stopSet = null } = opts;
  const stop = stopSet || new Set(DEFAULT_STOPWORDS);

  const covered = new Set();
  for (const kw of keywords || []) {
    for (const s of phraseStems(kw, stop)) covered.add(s);
  }

  const kept = [];
  const removed = [];
  for (const e of words || []) {
    const w = ((e && e.word) || '').toLowerCase();
    if (!w) continue;
    (covered.has(stemWord(w)) ? removed : kept).push(e);
  }

  return { kept, removed, coveredStems: covered.size };
}

module.exports = { cleanLsi };
