const { analyze } = require('./analyze');
const { extractPhrases } = require('./phrases');
const { selectKeywords, phraseStems, isSubset } = require('./select');
const { cleanLsi } = require('./lsi');
const { synthesizeStructure } = require('./structure');
const { dedupeForms } = require('./normalize');
const { stemWord } = require('./normalize');
const volume = require('./volume');
const readability = require('./readability');
const { DEFAULT_STOPWORDS } = require('./stopwords');

// ───────────────────────────────────────────────────────────────────────────
// Stage 2-6 of the ТЗК auto-pipeline (PURE — no Electron, unit-tested).
//
// Crawl I/O lives in main.js (crawlPages); this module is handed the already-
// extracted competitor artifacts and the keyword group ("ядро"), and produces a
// filled brief plus per-stage status. The order matters and is the result of
// the eng-review (see ~/.gstack/.../milcheliquids-main-design-...-pipeline-4a.md):
//
//   ЯДРО (группа) ─► [0] ЧИТАБЕЛЬНОСТЬ (пре-фильтр, бьёт сигнал конкурентов)
//                     │
//   pages ──┬─ texts ─┼─► analyze ─────► LSI words (источник A)
//           │         ├─► extractPhrases ─► overlap-фразы  ┐ сигнал конкурентов
//           ├─ headings ──────────────────► заголовки      ┘ (stem-subset)
//           └─ chars ─► volume.charStats/recommend ─► объём, N
//                     │
//   [2] set-cover(readable, signals, dropNested=FALSE) ─► selected (force-include
//        confirmed) + leftover                              │
//   [3] LSI = dedup(  A  ∪  words(leftover)  ) − основы(selected)   ─► lsi
//   [4] synthesizeStructure(headings, h1=ядро) ─► H1/H2/H3
//   [5] СБОРКА ТЗ {topic, volume, structure, keywords:selected, lsi}
//
// dropNested is FALSE here on purpose: «купить столовую ложку» is a key-worthy
// modifier phrase, not a redundant nested one — volume+budget prune the rest,
// and the true remainder («…в Украине») feeds LSI. dropNested=true (the manual
// button's default) would wrongly drop the modifier phrase.
// ───────────────────────────────────────────────────────────────────────────

// Content stems of a key with action verbs stripped — competitor headings /
// overlap phrases describe topics ("ложки столовые"), not intents ("купить …"),
// so the verb must not block the match.
function contentStems(keyword, stop, verbStems) {
  const out = new Set();
  for (const s of phraseStems(keyword, stop)) if (!verbStems.has(s)) out.add(s);
  return out;
}

// Split leftover phrases into clean content words (drop stop-words, short tokens,
// pure numbers), deduped by stem (representative = first seen). Feeds LSI source B.
function wordsFromPhrases(phrases, stop, minLen = 3) {
  const seenStem = new Set();
  const out = [];
  for (const phrase of phrases || []) {
    for (const w of String(phrase || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) || []) {
      if (w.length < minLen || stop.has(w) || /^[\d-]+$/.test(w)) continue;
      const st = stemWord(w);
      if (seenStem.has(st)) continue;
      seenStem.add(st);
      out.push(w);
    }
  }
  return out;
}

// Dedup a flat word list by stem, keeping the first (A is listed before B so a
// nice competitor surface form wins over a raw query form).
function dedupByStem(words) {
  const seen = new Set();
  const out = [];
  for (const w of words) {
    const st = stemWord(String(w).toLowerCase());
    if (seen.has(st)) continue;
    seen.add(st);
    out.push(w);
  }
  return out;
}

function structureToText(st) {
  if (!st || !st.sections) return '';
  const lines = ['H1: ' + (st.h1 || '')];
  for (const s of st.sections) {
    lines.push('H2: ' + s.text);
    for (const c of s.children || []) lines.push('  H3: ' + c.text);
  }
  return lines.join('\n');
}

function countHeadings(st) {
  if (!st || !st.sections) return 0;
  return st.sections.reduce((n, s) => n + 1 + (s.children ? s.children.length : 0), 0);
}

// run({ pages, group, core, opts }) -> { ok, tz, stages, ... }
//   pages: [{ ok, text, chars, headings:[{level,text}], url }]  (crawlPages output)
//   group: [{ keyword, volume }]                                 (the ядро)
//   core:  string (optional; default = highest-volume readable key)
//   opts:  { count, useVolume, freqWeight, dropNested, coef, minSites, stopSet }
function run({ pages = [], group = [], core = '', opts = {} } = {}) {
  const stop = opts.stopSet || new Set(DEFAULT_STOPWORDS);
  const structMinSites = opts.minSites || 1;        // структура: показать тему даже с 1 сайта
  const overlapMinSites = opts.overlapMinSites || 2; // сигнал конкурентов: «общая» фраза = ≥2 сайтов
  const verbStems = new Set([...readability.ACTION_VERBS].map(stemWord));

  const okPages = (pages || []).filter((p) => p && p.ok);
  const texts = okPages.map((p) => p.text || '').filter(Boolean);
  const chars = okPages.map((p) => p.chars || 0);

  // Компактные метаданные конкурентов для блока ЗАГОЛОВКИ_КОНКУРЕНТОВ промпта
  // (universal-seo-prompt-ecommerce.md): H1–H3 по сайтам + объём в збп (символы
  // без пробелов) — по нему документ применяет «медиана топа +10–15%».
  const pagesMeta = okPages.map((p) => ({
    url: p.url,
    host: p.host || '',
    zbp: String(p.text || '').replace(/\s+/g, '').length,
    headings: (p.headings || []).filter((h) => h && h.level >= 1 && h.level <= 3),
  }));
  const zstats = volume.charStats(pagesMeta.map((m) => m.zbp));
  const zbpMedian = zstats ? zstats.median : 0;

  const stages = {};
  stages.crawl = okPages.length === 0 ? 'failed'
    : (pages.length && okPages.length < pages.length ? 'warn' : 'ok');

  // [1] Volume
  const vstats = volume.charStats(chars);
  const rec = volume.recommend(vstats, opts.coef);
  stages.volume = vstats ? 'ok' : 'skipped';

  // Competitor artifacts.
  // LSI-источник A ранжируем docs-first (на скольких сайтах топа встречается
  // слово), потом по частоте: слово у нескольких конкурентов — общее
  // семантическое ядро темы, слово с одного сайта — чаще шум (бренд, меню).
  // Это критично, потому что в ТЗ уходит только верх списка (TZ_LSI_LIMIT).
  const lsiA = dedupeForms(analyze(texts, { stopSet: stop }))
    .sort((a, b) => b.docs - a.docs || b.count - a.count)
    .map((e) => e.word);
  // Competitor overlap phrases (sorted by site coverage). Top-50 stems feed the
  // "подтверждено конкурентами" key check; top-30 phrases become the brief's
  // competitor-phrases block (LSI/phrasing examples for the copywriter).
  const overlapPhrases = extractPhrases(texts, { stopSet: stop, minSites: overlapMinSites });
  const overlapSigs = overlapPhrases.slice(0, 50)
    .map((o) => phraseStems(o.phrase, stop)).filter((s) => s.size > 0);
  const headingSigs = [];
  for (const p of okPages) {
    for (const h of (p.headings || [])) {
      if (h.level >= 2) { const s = phraseStems(h.text, stop); if (s.size) headingSigs.push(s); }
    }
  }

  // Competitor-signal annotation for a core keyword — used both as the selection
  // label and to build the full "ядро ∩ конкуренты" list the UI shows below.
  const annotate = (it) => {
    const cs = contentStems(it.keyword, stop, verbStems);
    const overlapHit = cs.size > 0 && overlapSigs.some((sig) => isSubset(cs, sig));
    const headingHit = cs.size > 0 && headingSigs.some((sig) => isSubset(cs, sig));
    return { keyword: it.keyword, volume: it.volume, overlapHit, headingHit, confirmed: overlapHit || headingHit };
  };
  // Every core keyword confirmed by competitors (overlap OR headings). The UI's
  // bottom panel; «только подтверждённые» pulls these up, promote moves them in.
  const groupConfirmed = (group || []).map(annotate).filter((a) => a.confirmed)
    .map((a) => ({ keyword: a.keyword, volume: a.volume, confirmed: true }));

  // [0] Readability pre-filter on the ядро (outranks competitor signal)
  const { readable, dropped: unreadable } = readability.filterReadable(group || []);
  stages.readability = { kept: readable.length, dropped: unreadable.length };

  // [2] Selection.
  //  • preselected (user pressed «Подобрать ключи» / unchecked some) — REUSE
  //    those exact keys, skip set-cover; leftover = the rest (feeds LSI).
  //  • otherwise — annotate the readable core and run set-cover.
  let selected = [];
  let leftover = [];
  let coreResolved = (core || '').trim();
  const preselected = Array.isArray(opts.preselected) ? opts.preselected.filter(Boolean) : null;

  if (preselected && preselected.length) {
    const volOf = new Map((group || []).map((g) => [g.keyword, g.volume]));
    selected = preselected.map((kw) => {
      const a = annotate({ keyword: kw, volume: volOf.get(kw) || 0 });
      return { keyword: a.keyword, volume: a.volume, confirmed: a.confirmed, newStems: null, stemCount: 0 };
    });
    const preSet = new Set(preselected);
    leftover = (group || []).filter((g) => !preSet.has(g.keyword)).map((g) => ({ keyword: g.keyword, volume: g.volume }));
    stages.select = 'ok';
    if (!coreResolved) coreResolved = selected[0] ? selected[0].keyword : '';
  } else if (readable.length) {
    const annotated = readable.map(annotate);
    const res = selectKeywords(annotated, {
      count: opts.count != null ? opts.count : (rec ? rec.keys : 8),
      useVolume: opts.useVolume !== false,
      freqWeight: opts.freqWeight,
      dropNested: opts.dropNested === true, // default FALSE for the pipeline
      stopSet: stop,
    });
    selected = res.selected;
    leftover = res.leftover;
    stages.select = 'ok';
    if (!coreResolved) {
      const top = annotated.slice().sort((a, b) => (b.volume || 0) - (a.volume || 0))[0];
      coreResolved = top ? top.keyword : '';
    }
  } else {
    stages.select = 'skipped'; // empty group / all unreadable (D4-A)
  }

  // [3] LSI = dedup(A ∪ words(leftover)) − stems(selected)
  const bWords = wordsFromPhrases(leftover.map((l) => l.keyword), stop);
  let lsiWords = dedupByStem([...lsiA, ...bWords]);
  const selectedKeywords = selected.map((s) => s.keyword);
  const cleaned = cleanLsi(lsiWords.map((w) => ({ word: w })), selectedKeywords, { stopSet: stop });
  // Cap the brief's LSI at a sane default (competitor words are frequency-sorted,
  // so the top N are the strongest). Overridable via opts.lsiLimit (0 = no cap).
  const lsiLimit = opts.lsiLimit != null ? opts.lsiLimit : 150;
  const lsiAll = cleaned.kept.map((e) => e.word);
  const lsi = lsiLimit > 0 ? lsiAll.slice(0, lsiLimit) : lsiAll;
  stages.lsi = 'ok';

  // [4] Structure
  const structure = synthesizeStructure(pages, { h1: coreResolved, minSites: structMinSites, stopSet: stop });
  stages.structure = structure.sections.length ? 'ok' : 'warn';

  // [5] Assemble ТЗ (shape matches the renderer's tz form fields)
  const tz = {
    topic: coreResolved,
    requirements: {
      volume: rec ? rec.words : '',
      uniqueness: '', nausea: '',
      headingsCount: countHeadings(structure) || '',
    },
    structure: structureToText(structure),
    keywords: selected.map((s) => ({ keyword: s.keyword, confirmed: !!s.confirmed })),
    lsi,
    competitorPhrases: overlapPhrases.slice(0, 30)
      .map((o) => ({ phrase: o.phrase, sites: o.sites, count: o.count })),
  };

  return {
    ok: true,
    tz,
    stages,
    pagesOk: okPages.length,
    pagesMeta,
    zbpMedian,
    zbpTarget: volume.zbpTarget(zbpMedian),
    volume: rec,
    selected,
    leftover,
    structure,
    unreadable, // [{ item, reason }] — for the "отброшено по читабельности: N" UI counter
    groupConfirmed, // [{ keyword, volume, confirmed }] — full ядро ∩ конкуренты
  };
}

module.exports = { run, wordsFromPhrases, dedupByStem, contentStems, structureToText, countHeadings };
