const { tokenize } = require('./analyze');
const { stemWord } = require('./normalize');
const { DEFAULT_STOPWORDS } = require('./stopwords');

// Content-word stems of a phrase (drop stop-words and very short tokens).
// "купить сушку для посуды" -> { куп, сушк, посуд }
function phraseStems(phrase, stop, minLen = 3) {
  const out = new Set();
  for (const w of tokenize(phrase)) {
    if (w.length < minLen || stop.has(w)) continue;
    out.add(stemWord(w));
  }
  return out;
}

function isSubset(a, b) { for (const s of a) if (!b.has(s)) return false; return true; }

// Greedy keyword selection for a content brief.
//
// Picks up to `count` keywords from `items` ({ keyword, volume }) so they cover
// the widest spread of unique word-stems ("spectrum"), weighted by frequency
// (Serpstat volume). Mirrors the user's manual method:
//   1. frequency first  — higher-volume phrases score higher (freqWeight);
//   2. no redundancy     — nested phrases (stems ⊆ another) are dropped, keeping
//                          the SHORTER one; its extra words spill into leftover
//                          (LSI candidates);
//   3. spectrum          — each pick is rewarded for the NEW stems it adds.
//
// Returns { selected:[{ keyword, volume, newStems, stemCount }], leftover,
//           coveredStems, totalStems }.
function selectKeywords(items, opts = {}) {
  const { count = 8, stopSet = null, useVolume = true, dropNested = true, freqWeight = 0.5 } = opts;
  const stop = stopSet || new Set(DEFAULT_STOPWORDS);

  let cand = (items || [])
    .map((it) => ({
      keyword: it.keyword,
      volume: Math.max(0, +it.volume || 0),
      stems: phraseStems(it.keyword, stop),
      // "Confirmed by competitors": the auto-pipeline sets overlapHit/headingHit
      // when the key's stems are found in competitor overlap phrases or headings.
      // Absent for the manual button -> false -> behavior unchanged.
      confirmed: !!(it.confirmed || it.overlapHit || it.headingHit),
    }))
    .filter((c) => c.keyword && c.stems.size > 0);

  // Drop nested phrases: keep the shorter, drop the longer that merely extends it.
  // The dropped (longer) phrases are NOT discarded — they go to `dropped` and are
  // appended to leftover below, so their extra words still reach the LSI stage.
  const dropped = [];
  if (dropNested) {
    cand.sort((a, b) => a.stems.size - b.stems.size || b.volume - a.volume);
    const kept = [];
    for (const c of cand) {
      const nestedLonger = kept.some((k) => k.stems.size < c.stems.size && isSubset(k.stems, c.stems));
      if (nestedLonger) dropped.push(c); else kept.push(c);
    }
    cand = kept;
  }

  const allStems = new Set();
  cand.forEach((c) => c.stems.forEach((s) => allStems.add(s)));
  const maxVol = Math.max(1, ...cand.map((c) => c.volume));
  const maxStems = Math.max(1, ...cand.map((c) => c.stems.size));
  const fw = useVolume ? Math.min(1, Math.max(0, freqWeight)) : 0;

  const covered = new Set();
  const selected = [];
  const pool = cand.slice();

  // Competitor confirmation (overlapHit/headingHit) is a LABEL ONLY: it is
  // carried into selected[].confirmed for display, but does NOT force a key into
  // the result. Force-including every confirmed key used to dump the whole core
  // as near-duplicates on a tight topic (where everything appears at
  // competitors). Selection is the diversity gate below for ALL keys equally;
  // the label just marks which picks are backed by competitor text/headings.
  while (selected.length < count && pool.length) {
    let bi = -1, bestScore = -Infinity, bestNew = -1;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      let nw = 0;
      c.stems.forEach((s) => { if (!covered.has(s)) nw++; });
      // GATE: never pick a phrase that adds NO new word-stem. A high-volume
      // synonym ("купить сушку" after "купить сушилку"; "сушки" after "сушка")
      // covers nothing new — picking it just produces near-duplicate keys. We
      // prize spectrum over volume, so such phrases are skipped entirely; volume
      // only ranks among phrases that DO add new stems.
      if (nw === 0) continue;
      const score = fw * (c.volume / maxVol) + (1 - fw) * (nw / maxStems);
      const better = score > bestScore + 1e-9 ||
        (Math.abs(score - bestScore) <= 1e-9 && (nw > bestNew ||
          (nw === bestNew && bi >= 0 && c.volume > pool[bi].volume)));
      if (better) { bestScore = score; bi = i; bestNew = nw; }
    }
    if (bi < 0) break; // nothing left adds new coverage -> stop (no synonym padding)
    const chosen = pool.splice(bi, 1)[0];
    let added = 0;
    chosen.stems.forEach((s) => { if (!covered.has(s)) { covered.add(s); added++; } });
    selected.push({ keyword: chosen.keyword, volume: chosen.volume, newStems: added, stemCount: chosen.stems.size, confirmed: chosen.confirmed });
  }

  // Leftover = non-selected candidates + nested-dropped phrases, sorted by volume
  // desc. This is the LSI candidate pool consumed by the LSI-cleanup stage.
  const leftover = [...pool, ...dropped]
    .sort((a, b) => b.volume - a.volume)
    .map((c) => ({ keyword: c.keyword, volume: c.volume }));

  return {
    selected,
    leftover,
    coveredStems: covered.size,
    totalStems: allStems.size,
  };
}

module.exports = { selectKeywords, phraseStems, isSubset };
