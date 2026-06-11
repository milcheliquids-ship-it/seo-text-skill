// Serpstat API v4 client. JSON-RPC over POST; token in the query string.
// Docs: https://api-docs.serpstat.com  (SerpstatKeywordProcedure / SerpstatUrlProcedure)
//
// Three result SHAPES flow back to the UI, tagged by `kind`:
//   'keywords'    -> [{ keyword, volume, cpc, competition, difficulty }]
//   'competitors' -> [{ domain, common, visible, traffic }]
//   'top'         -> [{ position, domain, url }]
// Field names vary across methods, so every value is read through pick() with
// several candidate names — a renamed field shows up as a blank cell, never a
// crash. The shapers are unit-tested against representative payloads.

const ENDPOINT = 'https://api.serpstat.com/v4';

async function call(token, method, params) {
  const res = await fetch(ENDPOINT + '?token=' + encodeURIComponent(token), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: '1', method, params }),
  });

  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error('ответ не распознан (HTTP ' + res.status + ')');
  }
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  if (!json.result) throw new Error('пустой ответ от Serpstat');
  return json.result;
}

function pick(o, keys) {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return null;
}

// Volume may be a plain number or a RANGE string like "1-5" (Serpstat returns
// ranges for low-volume keywords). Take the lower bound; treat space/comma as
// thousand separators. "1-5" -> 1, "1 200" -> 1200, 5400 -> 5400, "" -> null.
function volumeToInt(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  const head = String(v).split(/[-–—]/)[0]; // hyphen / en-dash / em-dash = range
  const digits = head.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

// result.data is the common container; some methods use result.top / result.keywords.
// getKeywordTop nests the rows one level deeper: result.data = { top:[...], ads, types }.
function rowsOf(result) {
  if (Array.isArray(result.data)) return result.data;
  if (result.data && Array.isArray(result.data.top)) return result.data.top; // getKeywordTop
  return result.top || result.keywords || result.competitors || [];
}

// ---- shapers (pure, unit-tested) ---------------------------------------
function normalizeKeyword(r) {
  return {
    keyword: r.keyword || r.phrase || '',
    volume: volumeToInt(pick(r, ['region_queries_count', 'queries', 'region_queries_count_wide'])),
    cpc: pick(r, ['cost', 'cpc']),
    competition: pick(r, ['concurrency', 'competition']),
    difficulty: pick(r, ['difficulty', 'keyword_difficulty']),
  };
}
function normalizeCompetitor(r) {
  return {
    domain: r.domain || '',
    common: pick(r, ['common_keywords', 'common']),
    visible: pick(r, ['visible', 'visible_dynamic']),
    traffic: pick(r, ['traff', 'traffic']),
  };
}
function normalizeTop(r) {
  return {
    position: pick(r, ['position', 'pos']),
    domain: r.domain || '',
    url: r.url || '',
  };
}

const shapeKeywords = (result) => ({ kind: 'keywords', rows: rowsOf(result).map(normalizeKeyword), summary: result.summary_info || {} });
const shapeCompetitors = (result) => ({ kind: 'competitors', rows: rowsOf(result).map(normalizeCompetitor), summary: result.summary_info || {} });
const shapeTop = (result) => ({ kind: 'top', rows: rowsOf(result).map(normalizeTop), summary: result.summary_info || {} });

// Keep only question-style phrases (FAQ / structure ideas). Client-side so it
// never depends on Serpstat's filter-param names.
const QUESTION_RE = /(^|\s)(как|что|почему|зачем|чому|навіщо|где|куди|куда|откуда|звідки|когда|коли|сколько|скільки|чем|чём|чим|какой|какая|какое|какие|який|яка|яке|які|чей|можно ли|нужно ли|стоит ли|чи )/i;
function onlyQuestions(rows) {
  return rows.filter((r) => QUESTION_RE.test(r.keyword || ''));
}

// ---- methods -----------------------------------------------------------
// Semantically related keywords.
async function getRelated(token, keyword, se, size = 100) {
  return shapeKeywords(await call(token, 'SerpstatKeywordProcedure.getRelatedKeywords', { keyword, se, size }));
}
// All keywords containing the phrase.
async function getPhrase(token, keyword, se, size = 100) {
  return shapeKeywords(await call(token, 'SerpstatKeywordProcedure.getKeywords', { keyword, se, size }));
}
// Metrics for a manual list of keywords.
async function getInfo(token, keywords, se) {
  return shapeKeywords(await call(token, 'SerpstatKeywordProcedure.getKeywordsInfo', { keywords, se }));
}
// Live search-suggest (autocomplete) keywords.
async function getSuggestions(token, keyword, se, size = 100) {
  return shapeKeywords(await call(token, 'SerpstatKeywordProcedure.getSuggestions', { keyword, se, size }));
}
// Question-style keywords: pull the phrase set, keep only questions.
async function getQuestions(token, keyword, se, size = 1000) {
  const res = shapeKeywords(await call(token, 'SerpstatKeywordProcedure.getKeywords', { keyword, se, size }));
  return { ...res, rows: onlyQuestions(res.rows) };
}
// Keywords that a specific competitor PAGE ranks for.
async function getUrlKeywords(token, url, se, size = 100) {
  return shapeKeywords(await call(token, 'SerpstatUrlProcedure.getUrlKeywords', { url, se, size }));
}
// Competitor domains for a keyword.
async function getCompetitors(token, keyword, se, size = 50) {
  return shapeCompetitors(await call(token, 'SerpstatKeywordProcedure.getCompetitors', { keyword, se, size }));
}
// Google top-100 organic results for a keyword.
async function getKeywordTop(token, keyword, se) {
  return shapeTop(await call(token, 'SerpstatKeywordProcedure.getKeywordTop', { keyword, se }));
}

module.exports = {
  getRelated, getPhrase, getInfo, getSuggestions, getQuestions,
  getUrlKeywords, getCompetitors, getKeywordTop,
  // exported for unit tests
  _shapers: { shapeKeywords, shapeCompetitors, shapeTop, onlyQuestions, normalizeKeyword, volumeToInt },
};
