// Volume calculator — competitor text-length stats + recommended brief volume.
//
// Extracted from the renderer's live LSI panel so the auto-pipeline (Node side,
// src/lib/pipeline.js) can compute the recommended volume from crawled pages.
//
//   chars[] ──► charStats ──► { median, mean, trimmed, min, max, n }
//                              │
//                  recommend(stats, coef) ──► { volume, words, keys }
//
// `keys` is a SOFT ceiling (volume / chars-per-keyword: commerce≈500, blog≈350),
// NOT a density rule — Google doesn't reward a fixed keyword density. See the
// project memory note `seo-keyword-density-verified`.
//
// NOTE: the renderer's own lsiCharStats/renderVolume keep a parallel copy — the
// browser context can't require Node modules under contextIsolation. Unifying
// the two via an IPC call (volume:stats) is a deliberate follow-up TODO so this
// PR doesn't touch the working live panel.

// Competitor char-length stats from a list of per-page char counts.
// Zero/empty entries are ignored. Returns null when nothing usable remains.
function charStats(chars) {
  const arr = (chars || []).map((c) => +c || 0).filter((c) => c > 0).sort((a, b) => a - b);
  if (!arr.length) return null;
  const n = arr.length;
  const median = n % 2 ? arr[(n - 1) / 2] : Math.round((arr[n / 2 - 1] + arr[n / 2]) / 2);
  const sum = arr.reduce((a, b) => a + b, 0);
  const mean = Math.round(sum / n);
  // Trim ~20% of outliers from each end before averaging (robust mean).
  const k = Math.floor(n * 0.2);
  const mid = arr.slice(k, n - k);
  const trimmed = mid.length ? Math.round(mid.reduce((a, b) => a + b, 0) / mid.length) : mean;
  return { median, mean, trimmed, min: arr[0], max: arr[n - 1], n };
}

// Recommended brief volume (= median competitor chars) and a SOFT keyword-count
// ceiling. words ≈ chars / 6 (rough RU word length). coef floored at 50.
function recommend(stats, coef = 500) {
  if (!stats) return null;
  const c = Math.max(50, +coef || 500);
  const volume = stats.median;
  return { volume, words: Math.round(volume / 6), keys: Math.max(1, Math.round(volume / c)) };
}

// Целевой объём текста в збп по правилу universal-seo-prompt-ecommerce.md:
// «Если даны объёмы текстов конкурентов — ориентир: медиана топа +10–15%».
// Берём середину диапазона (+12%) и округляем до 50, чтобы цифра в ТЗ не
// выглядела ложно-точной. 0 — когда медианы нет (поле ОБЪЁМ опускается,
// работают дефолты раздела 3 документа).
function zbpTarget(median) {
  const m = +median || 0;
  if (m <= 0) return 0;
  return Math.round((m * 1.12) / 50) * 50;
}

module.exports = { charStats, recommend, zbpTarget };
