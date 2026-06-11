// Site blocklist — drop unwanted domains from the Google SERP before crawling
// (marketplaces, aggregators, the user's own site) so they don't pollute LSI /
// headings / overlap. Pure + unit-tested; used by every crawl tool.
//
//   entry "https://www.Rozetka.com.ua/cat" -> normalized "rozetka.com.ua"
//   a result host matches an entry when it IS the domain or a subdomain of it
//   ("bt.rozetka.com.ua" is blocked by "rozetka.com.ua").

function normalizeDomain(s) {
  let d = String(s == null ? '' : s).trim().toLowerCase();
  if (!d) return '';
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '');
  d = d.split('/')[0].split('?')[0].split('#')[0];
  return d;
}

function hostFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch (e) { return String(url == null ? '' : url).toLowerCase(); }
}

function isBlocked(host, blockList) {
  const h = String(host == null ? '' : host).replace(/^www\./, '').toLowerCase();
  if (!h) return false;
  for (const raw of blockList || []) {
    const d = normalizeDomain(raw);
    if (d && (h === d || h.endsWith('.' + d))) return true;
  }
  return false;
}

// Filter SERP results ([{ url, ... }]) by the blocklist. Empty list = no-op.
function filterResults(results, blockList) {
  if (!blockList || !blockList.length) return results || [];
  return (results || []).filter((r) => !isBlocked(hostFromUrl(r.url), blockList));
}

module.exports = { normalizeDomain, hostFromUrl, isBlocked, filterResults };
