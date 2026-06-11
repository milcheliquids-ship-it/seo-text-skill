const { BROWSER_UA } = require('./useragents');
const { stemWord } = require('./normalize');

// Сбор внутренних URL сайта из sitemap.xml для подсказок перелинковки.
// Рекурсивно разворачивает <sitemapindex>, пропуская товарные карты (их тысячи
// и они не нужны для анкоров на разделы). Возвращает список URL разделов/брендов/
// фильтров. Pure-ish: единственный I/O — fetch (как и весь краул движка).

async function fetchText(url, ua, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal, redirect: 'follow',
      headers: { 'User-Agent': ua || BROWSER_UA, Accept: 'application/xml,text/xml,text/html,*/*' },
    });
    if (!res.ok) { try { if (res.body && !res.body.locked) await res.body.cancel(); } catch (e) {} return null; }
    return await res.text();
  } catch (e) { return null; } finally { clearTimeout(timer); }
}

const locsOf = (xml) => [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim());

function originOf(u) { try { return new URL(u).origin; } catch (e) { return ''; } }

// site может быть и доменом, и прямым URL карты. Если карта не указана —
// пробуем /sitemap.xml.
function sitemapUrl(site) {
  const s = String(site || '').trim();
  if (!s) return '';
  const full = s.includes('//') ? s : 'https://' + s;
  if (/\.xml(\?|$)/i.test(full)) return full;
  return full.replace(/\/+$/, '') + '/sitemap.xml';
}

// Собрать URL разделов сайта. opts: { maxChildSitemaps, maxUrls, ua }.
async function collectSiteUrls(site, { maxChildSitemaps = 8, maxUrls = 2000, ua } = {}) {
  const start = sitemapUrl(site);
  if (!start) return [];
  const seen = new Set();
  const out = new Set();
  async function walk(u, depth) {
    if (depth > 2 || seen.has(u) || out.size >= maxUrls) return;
    seen.add(u);
    const xml = await fetchText(u, ua);
    if (!xml) return;
    const found = locsOf(xml);
    if (/<sitemapindex/i.test(xml)) {
      // дочерние карты: товарные пропускаем (огромные и не нужны для анкоров)
      const children = found.filter((c) => !/product/i.test(c)).slice(0, maxChildSitemaps);
      for (const c of children) await walk(c, depth + 1);
    } else {
      for (const l of found) out.add(l);
    }
  }
  await walk(start, 0);
  return [...out];
}

// Токены пути URL (слаг), очищенные от языковых/служебных префиксов.
const STOP_SLUG = new Set(['ru', 'uk', 'ua', 'en', 'brand', 'category', 'c', 'index', 'php', 'html', 'www']);
function slugTokens(url) {
  let path = url;
  try { path = new URL(url).pathname; } catch (e) {}
  return path.toLowerCase().split(/[\/_\-.]+/).filter((t) => t && t.length >= 2 && !STOP_SLUG.has(t) && !/^\d+$/.test(t));
}

// Человекочитаемый анкор из слага: «brand-hot-toys» → «hot toys», «star-wars» → «star wars».
function anchorFromUrl(url) {
  return slugTokens(url).join(' ');
}

// Отобрать кандидатов перелинковки: URL раздела релевантен, если его слаг
// пересекается по основам со словарём темы (тема + ключи + LSI + слова заголовков
// конкурентов). Возвращает [{ url, anchor, hits }] по убыванию релевантности.
// Длинные товарные URL (много сегментов / числовой хвост) отсекаются — нужны разделы.
function pickInternalLinks(urls, vocabWords, { limit = 8, prefer = '' } = {}) {
  const vocab = new Set();
  for (const w of vocabWords || []) {
    for (const t of String(w).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (t && t.length >= 2) vocab.add(stemWord(t));
    }
  }
  const scored = [];
  for (const url of urls || []) {
    const toks = slugTokens(url);
    if (!toks.length || toks.length > 4) continue; // разделы — короткий слаг
    const stems = toks.map(stemWord);
    const hits = stems.filter((s) => vocab.has(s)).length;
    // prefer — языковой сегмент пути (для ru предпочитаем /ru/…, чтобы не дать
    // украинский URL под русский текст).
    const pref = prefer && url.includes(prefer) ? 1 : 0;
    if (hits > 0) scored.push({ url, anchor: anchorFromUrl(url), hits, pref, depth: toks.length });
  }
  scored.sort((a, b) => b.hits - a.hits || b.pref - a.pref || a.depth - b.depth || a.url.length - b.url.length);
  // дедуп по анкору
  const seen = new Set();
  const out = [];
  for (const s of scored) {
    if (seen.has(s.anchor)) continue;
    seen.add(s.anchor);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { collectSiteUrls, pickInternalLinks, sitemapUrl, slugTokens, anchorFromUrl, fetchText };
