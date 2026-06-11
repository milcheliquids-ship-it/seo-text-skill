const { tokenize } = require('./analyze');

// Keyword readability filter — drop phrases that can't be woven into prose.
//
// A search query is not always a usable keyword. "купить ручку" reads naturally;
// "ручку купить" (inverted) and "пс5 киев" (geo-tagged query-speak) do not — a
// copywriter can't place them in a sentence. This filter is ALWAYS ON and runs
// as a PRE-FILTER before keyword selection (it outranks the competitor-presence
// signal: an unreadable phrase is dropped even if competitors use it).
//
//   phrase ─► check ─► { readable, reason }
//     reason: 'geo' | 'latin-digit' | 'verb-not-first' | 'empty' | 'ok'
//
// Heuristic + offline (deterministic, unit-tested). The long tail of subtle
// unnaturalness is handled by (a) optional Claude polish when a key is present
// (added later, hybrid) and (b) the user's manual checkboxes on the result.
// Words from dropped phrases still flow to LSI via the pipeline's split/clean.

// Action verbs (infinitives) common in commercial RU queries. In natural word
// order the verb leads ("купить ручку"); a trailing verb is query inversion.
const ACTION_VERBS = new Set([
  'купить', 'покупать', 'заказать', 'заказывать', 'выбрать', 'скачать',
  'смотреть', 'посмотреть', 'продать', 'арендовать', 'снять', 'найти',
  'оформить', 'оплатить', 'доставить', 'установить', 'отремонтировать',
  'починить', 'сделать', 'взять', 'получить', 'сравнить',
]);

// Geo tokens (cities / regions / countries, common surface forms). A geo token
// marks a search query, not prose. The user can extend this via stop-words too.
const GEO = new Set([
  'киев', 'киеве', 'киева', 'москва', 'москве', 'москвы', 'харьков', 'харькове',
  'одесса', 'одессе', 'львов', 'львове', 'днепр', 'днепре', 'запорожье',
  'украина', 'украине', 'украины', 'россия', 'россии', 'беларусь', 'минск',
  'спб', 'мск', 'питер', 'казань', 'екатеринбург', 'новосибирск', 'киеву',
]);

// Prepositions that legitimize a following geo token ("в Украине", "по Киеву").
// A bare geo token (no preposition before it) is query-speak; one after a
// preposition is natural prose and must be kept.
const PREPS = new Set(['в', 'во', 'на', 'из', 'по', 'до', 'под', 'над', 'от', 'у', 'к', 'за', 'с', 'со', 'о', 'об', 'при']);

// Returns { readable: boolean, reason: string }.
//   'empty'          — no content tokens
//   'verb-not-first' — action verb present but not leading ("ручку купить")
//   'geo'            — bare geo token with no preceding preposition ("пс5 киев")
//   'ok'             — usable in prose
//
// Note: an earlier draft also rejected letter+digit tokens ("пс5") and ANY geo
// token. Both were too aggressive — they silently dropped legit keys like
// "купить ps5" and "купить ложку в Украине". Silent false-drops are worse than
// false-keeps (the user trims keeps with checkboxes; drops are invisible).
function check(phrase) {
  const toks = tokenize(String(phrase == null ? '' : phrase));
  if (!toks.length) return { readable: false, reason: 'empty' };

  const verbIdx = toks.findIndex((t) => ACTION_VERBS.has(t));
  if (verbIdx > 0) return { readable: false, reason: 'verb-not-first' };

  for (let i = 0; i < toks.length; i++) {
    if (GEO.has(toks[i]) && !(i > 0 && PREPS.has(toks[i - 1]))) {
      return { readable: false, reason: 'geo' };
    }
  }
  return { readable: true, reason: 'ok' };
}

const isReadable = (phrase) => check(phrase).readable;

// Partition a list of items (strings or { keyword }) into readable / dropped,
// keeping the per-item reason on the dropped side for an optional UI counter.
function filterReadable(items) {
  const readable = [];
  const dropped = [];
  for (const it of items || []) {
    const phrase = typeof it === 'string' ? it : (it && it.keyword) || '';
    const r = check(phrase);
    if (r.readable) readable.push(it);
    else dropped.push({ item: it, reason: r.reason });
  }
  return { readable, dropped };
}

module.exports = { check, isReadable, filterReadable, ACTION_VERBS, GEO };
