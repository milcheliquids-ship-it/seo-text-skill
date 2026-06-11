const { JSDOM, VirtualConsole } = require('jsdom');
const { Readability } = require('@mozilla/readability');

const { GOOGLEBOT_UA } = require('./useragents');

// Pull ONLY the main article text out of an HTML string (no nav/ads/footers),
// using Mozilla Readability — the engine behind Firefox Reader Mode.
//   { ok: true, text, chars } | { ok: false, reason: 'no-text' | 'parse', ... }
function extractFromHtml(html, url, { minChars = 200 } = {}) {
  try {
    const virtualConsole = new VirtualConsole(); // silence jsdom warnings
    const dom = new JSDOM(html, { url, virtualConsole });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    const text = article && article.textContent
      ? article.textContent.replace(/\s+/g, ' ').trim()
      : '';

    if (!text || text.length < minChars) {
      return { ok: false, reason: 'no-text', chars: text.length };
    }
    return { ok: true, text, chars: text.length };
  } catch (err) {
    return { ok: false, reason: 'parse', error: String((err && err.message) || err) };
  }
}

// Request headers with a chosen User-Agent (default Googlebot — cloaking sites
// serve the canonical indexed text to Googlebot, which is exactly what we want).
// Callers without a Chromium fallback (e.g. the seo-text skill) can retry with
// BROWSER_UA on the sites that 403 a fake Googlebot.
function headersFor(ua) {
  return {
    'User-Agent': ua || GOOGLEBOT_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ru,en;q=0.8',
  };
}

// Release an HTTP body we are NOT going to read. Leaving a keep-alive response
// undrained is what later trips undici's HTTP/1 parser into the fatal
// `assert(!this.paused)` crash on socket end — so whenever we bail before
// reading (non-200, non-HTML), cancel the stream to close the connection
// cleanly. Best-effort: never throw from cleanup.
async function discardBody(res) {
  try { if (res && res.body && !res.body.locked) await res.body.cancel(); } catch (e) {}
}

// Fast path: plain HTTP fetch from the user's machine, then extract.
//   { url, ok, ... } — adds reason 'http' | 'not-html' | 'timeout' | 'error'
async function fetchPageText(url, { timeoutMs = 15000, minChars = 200, ua } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: headersFor(ua) });

    if (!res.ok) { await discardBody(res); return { url, ok: false, reason: 'http', status: res.status }; }
    const ctype = res.headers.get('content-type') || '';
    if (!ctype.includes('text/html')) { await discardBody(res); return { url, ok: false, reason: 'not-html' }; }

    const html = await res.text();
    return { url, ...extractFromHtml(html, url, { minChars }) };
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? 'timeout' : 'error';
    return { url, ok: false, reason, error: String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

// Fetch raw HTML (for heading extraction etc.). Returns { ok, html } | { ok:false, reason }.
async function fetchHtml(url, { timeoutMs = 15000, ua } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: headersFor(ua) });
    if (!res.ok) { await discardBody(res); return { ok: false, reason: 'http', status: res.status }; }
    const ctype = res.headers.get('content-type') || '';
    if (!ctype.includes('text/html')) { await discardBody(res); return { ok: false, reason: 'not-html' }; }
    return { ok: true, html: await res.text() };
  } catch (err) {
    return { ok: false, reason: err && err.name === 'AbortError' ? 'timeout' : 'error' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchPageText, extractFromHtml, fetchHtml };
