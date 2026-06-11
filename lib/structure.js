const { phraseStems } = require('./select');
const { DEFAULT_STOPWORDS } = require('./stopwords');
const { makeExcludeMatcher } = require('./exclude');

// Stage 5 — synthesize ONE recommended H1/H2/H3 outline from competitors'
// headings. Not a per-site dump: themes are grouped by word-STEM signature so
// "Оплата и доставка" and "Доставка, оплата" collapse into one section, and a
// theme is recommended only when enough competitors share it.
//
//   site A:  H2 Доставка ─┐                       recommended outline
//            H3 Курьером  │  group by stem-sig     H1: <keyword>
//   site B:  H2 доставка ─┤  count distinct sites  H2: Доставка   (3 сайта)
//            H3 курьером  │  keep count >= minSites   H3: Курьером (3)
//   site C:  H2 Доставка ─┘                       H2: Гарантия   (dropped, 1)
//
// Section order = average heading position across sites (natural reading flow).
// Representative text = most frequent surface form (ties -> shortest).
//
//   pages:  [{ ok, headings: [{ level, text }], url }]  (output of headings:run)
//   opts:   { excluded:[idx], minSites=2, h1='', stopSet=null, excludeWords=[] }
// Returns { h1, sections:[{ text, count, children:[{ text, count }] }], sites }.
// excludeWords drops junk headings (FAQ, promo, anti-bot) outright so they
// never reach the recommended outline.
function synthesizeStructure(pages, opts = {}) {
  const { excluded = [], minSites = 1, h1 = '', stopSet = null, excludeWords = [] } = opts;
  const stop = stopSet || new Set(DEFAULT_STOPWORDS);
  const exSet = excluded instanceof Set ? excluded : new Set(excluded);
  const isJunk = makeExcludeMatcher(excludeWords);

  // Canonical stem signature: sorted content-word stems. Empty -> skip heading.
  const sig = (text) => [...phraseStems(text, stop)].sort().join(' ');
  // Representative surface form: most frequent, ties -> shortest.
  const rep = (texts) => {
    let best = null;
    for (const [t, c] of texts) {
      if (!best || c > best.c || (c === best.c && t.length < best.t.length)) best = { t, c };
    }
    return best ? best.t : '';
  };
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  // Included, parseable sites (keep ORIGINAL page index for toggle identity).
  const sites = [];
  (pages || []).forEach((p, idx) => {
    if (p && p.ok && !exSet.has(idx)) sites.push(p);
  });

  // Cluster H2 themes across sites; nest H3 children under their H2 cluster.
  const h2map = new Map(); // sig -> { texts:Map, sites:Set, pos:[], h3:Map }
  sites.forEach((p, si) => {
    let cur = null; // current H2 bucket (H3s attach here until next H2)
    (p.headings || []).forEach((h, hi) => {
      if (isJunk(h.text)) return; // skip FAQ / promo / anti-bot headings
      if (h.level === 2) {
        const k = sig(h.text);
        if (!k) { cur = null; return; }
        if (!h2map.has(k)) h2map.set(k, { texts: new Map(), sites: new Set(), pos: [], h3: new Map() });
        cur = h2map.get(k);
        cur.texts.set(h.text, (cur.texts.get(h.text) || 0) + 1);
        cur.sites.add(si);
        cur.pos.push(hi);
      } else if (h.level === 3 && cur) {
        const k3 = sig(h.text);
        if (!k3) return;
        if (!cur.h3.has(k3)) cur.h3.set(k3, { texts: new Map(), sites: new Set(), pos: [] });
        const b3 = cur.h3.get(k3);
        b3.texts.set(h.text, (b3.texts.get(h.text) || 0) + 1);
        b3.sites.add(si);
        b3.pos.push(hi);
      }
    });
  });

  const sections = [...h2map.values()]
    .filter((b) => b.sites.size >= minSites)
    .map((b) => ({
      text: rep(b.texts),
      count: b.sites.size,
      _pos: avg(b.pos),
      children: [...b.h3.values()]
        .filter((c) => c.sites.size >= minSites)
        .map((c) => ({ text: rep(c.texts), count: c.sites.size, _pos: avg(c.pos) }))
        .sort((a, b2) => a._pos - b2._pos)
        .map(({ _pos, ...rest }) => rest),
    }))
    .sort((a, b) => a._pos - b._pos)
    .map(({ _pos, ...rest }) => rest);

  return { h1, sections, sites: sites.length };
}

module.exports = { synthesizeStructure };
