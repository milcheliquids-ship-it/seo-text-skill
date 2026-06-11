const { newStemmer } = require('snowball-stemmers');

const ru = newStemmer('russian');
const en = newStemmer('english');

// Reduce a word to its stem so different forms collapse together:
//   консоли / консолю / консоль  ->  консол
function stemWord(word) {
  if (/[а-яёіїєґ]/i.test(word)) return ru.stem(word); // cyrillic -> russian
  if (/[a-z]/i.test(word)) return en.stem(word);       // latin -> english
  return word;
}

// Turn a Map(docIndex -> count) into a plain object for IPC.
function byDocToObj(map) {
  const o = {};
  if (map) for (const [d, c] of map) o[d] = c;
  return o;
}

// Serialize a single analyze() entry (no form-merging) into the IPC shape.
//   { word, count, docs, forms: [word], byDoc: { idx: count } }
function toEntry(e) {
  return { word: e.word, count: e.count, docs: e.docs, forms: [e.word], byDoc: byDocToObj(e._byDoc) };
}

// Collapse word forms by stem.
//   in:  [{ word, count, docs, _byDoc }, ...]
//   out: [{ word, count, docs, forms: [...], byDoc: { idx: count } }, ...]
// count = summed; docs = number of pages in the UNION across all forms;
// byDoc = per-page counts summed across forms (used by per-site toggles);
// representative = most frequent surface form (ties -> shortest).
function dedupeForms(entries) {
  const groups = new Map(); // stem -> { byDoc: Map(idx->count), forms: Map(word -> count) }

  for (const e of entries) {
    const stem = stemWord(e.word);
    if (!groups.has(stem)) groups.set(stem, { byDoc: new Map(), forms: new Map() });
    const g = groups.get(stem);
    let wc = 0;
    if (e._byDoc) for (const [d, c] of e._byDoc) { g.byDoc.set(d, (g.byDoc.get(d) || 0) + c); wc += c; }
    else wc = e.count;
    g.forms.set(e.word, (g.forms.get(e.word) || 0) + wc);
  }

  const out = [];
  for (const g of groups.values()) {
    let best = null;
    for (const [w, c] of g.forms) {
      if (!best || c > best.c || (c === best.c && w.length < best.w.length)) {
        best = { w, c };
      }
    }
    let count = 0;
    for (const c of g.byDoc.values()) count += c;
    out.push({ word: best.w, count, docs: g.byDoc.size, forms: [...g.forms.keys()], byDoc: byDocToObj(g.byDoc) });
  }

  return out.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'ru'));
}

module.exports = { stemWord, dedupeForms, toEntry, byDocToObj };
