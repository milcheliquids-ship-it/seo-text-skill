// Centralized user-agent strings.
//
//   competitor page  ──► GOOGLEBOT_UA   (extract.js fetch, render.js window)
//   google.com SERP  ──► BROWSER_UA     (serp.js window)
//
// Why: language/geo-cloaking sites 302-redirect real browsers to a localized
// version (e.g. a Russian URL that serves Ukrainian text to UA visitors), but
// serve Googlebot the canonical indexed version. Crawling competitor pages AS
// Googlebot gets us the same text Google ranks — the whole point of the tool.
// The Google SERP window must stay a real browser: a bot UA on google.com
// trips CAPTCHA/blocks and breaks the persisted login session.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Googlebot smartphone (Google indexes mobile-first). The trailing
// "(compatible; Googlebot/2.1; ...)" token is what cloaking sites key on.
const GOOGLEBOT_UA =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 ' +
  '(compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

module.exports = { BROWSER_UA, GOOGLEBOT_UA };
