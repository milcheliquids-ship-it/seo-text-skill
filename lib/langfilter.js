const fs = require('fs');
const path = require('path');
const nspell = require('nspell');

// RU/UK word separation for cleaning one language out of a keyword/LSI list.
//
// A by-letters filter can't do this (доставка, магазин, товари share the
// alphabet). Stemming both languages with ONE stemmer also fails: the Russian
// stemmer maps Ukrainian inflections onto Russian stems (товари -> товар), so
// they look Russian. We instead spell-check each word against BOTH hunspell
// dictionaries with nspell, which applies each language's own affix rules — no
// stemming, no cross-language collision.
//
//   word ─► ruOk = ru.correct(word) || has ы/ъ/э/ё   (valid Russian?)
//           ukOk = uk.correct(word) || has і/ї/є/ґ    (valid Ukrainian?)
//
//   remove='uk' (keep Russian):  strict ─► drop if !ruOk
//                                 soft   ─► drop if ukOk && !ruOk  (confirmed UK)
//   remove='ru' (keep Ukrainian): strict ─► drop if !ukOk
//                                 soft   ─► drop if ruOk && !ukOk  (confirmed RU)
//
// soft keeps shared/unknown words (магазин is valid in both); strict keeps only
// words the target-keep language accepts.

const RUS_ONLY = /[ыъэё]/i; // letters in Russian but not Ukrainian
const UKR_ONLY = /[іїєґ]/i; // letters in Ukrainian but not Russian

let RU = null; // nspell instance
let UK = null;

function affDic(pkg) {
  const base = path.join(path.dirname(require.resolve(pkg)), 'index');
  return { aff: fs.readFileSync(base + '.aff'), dic: fs.readFileSync(base + '.dic') };
}

// Lazy + cached. First call builds both spell-checkers (~7s on the main thread,
// the UK dictionary alone is 335k lemmas); every call after is instant.
function ensureSpell() {
  if (!RU) { const d = affDic('dictionary-ru'); RU = nspell(d.aff, d.dic); }
  if (!UK) { const d = affDic('dictionary-uk'); UK = nspell(d.aff, d.dic); }
}

// Pure decision — unit-tested without loading dictionaries.
function shouldRemove(ruOk, ukOk, remove, mode) {
  ruOk = !!ruOk; ukOk = !!ukOk;
  if (remove === 'ru') return mode === 'strict' ? !ukOk : (ruOk && !ukOk);
  return mode === 'strict' ? !ruOk : (ukOk && !ruOk);
}

// Partition entries (strings, or objects with .word / .keyword).
//   opts: { remove: 'uk' | 'ru' (default 'uk'), mode: 'soft' | 'strict' }
function cleanForeign(words, opts = {}) {
  ensureSpell();
  const remove = opts.remove === 'ru' ? 'ru' : 'uk';
  const mode = opts.mode === 'strict' ? 'strict' : 'soft';
  const kept = [];
  const removed = [];
  for (const e of words || []) {
    const raw = typeof e === 'string' ? e : (e && (e.word || e.keyword)) || '';
    const w = raw.toLowerCase().trim();
    if (!w) { kept.push(e); continue; }
    const ruOk = RU.correct(w) || RUS_ONLY.test(w);
    const ukOk = UK.correct(w) || UKR_ONLY.test(w);
    (shouldRemove(ruOk, ukOk, remove, mode) ? removed : kept).push(e);
  }
  return { kept, removed, mode, remove };
}

module.exports = { cleanForeign, shouldRemove, RUS_ONLY, UKR_ONLY };
