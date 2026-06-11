const { JSDOM, VirtualConsole } = require('jsdom');
const { Readability } = require('@mozilla/readability');

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

// Parse a page's heading outline and main-content word count.
//   { title, headings: [{ level, text }], words, zbp, noText }
// zbp = символы без пробелов основного текста — единица объёма из
// universal-seo-prompt-ecommerce.md (правило «медиана топа +10–15%»).
//
// H1 is ALWAYS taken from the page (it's the page's real subject). H2/H3 are
// taken ONLY from the main article body (via Readability) — so we ignore
// headings scattered in navigation, sidebars, "related", and footers. If the
// page has no real article text, we flag noText and keep only the H1(s).
function parseHeadings(html, url, { minChars = 200 } = {}) {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;

  const titleEl = doc.querySelector('title');
  const title = titleEl ? clean(titleEl.textContent) : '';

  // H1 + a document-wide H2/H3 fallback — captured BEFORE Readability mutates
  // the DOM. The fallback matters for commerce/category pages: Readability finds
  // no "article" there, so without it only the H1 survived and the recommended
  // structure was always a lone H1.
  const h1s = [...doc.querySelectorAll('h1')]
    .map((n) => clean(n.textContent))
    .filter((t) => t && t.length <= 200);
  const docHeadings = [...doc.querySelectorAll('h2, h3')]
    .map((n) => ({ level: Number(n.tagName.slice(1)), text: clean(n.textContent) }))
    .filter((h) => h.text && h.text.length <= 200);

  let words = 0;
  let zbp = 0;
  let noText = false;
  let articleHeadings = [];
  try {
    const article = new Readability(doc).parse();
    const text = article && article.textContent ? clean(article.textContent) : '';
    words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    zbp = text ? text.replace(/\s+/g, '').length : 0;

    if (text && text.length >= minChars && article.content) {
      const adoc = new JSDOM(article.content, { virtualConsole: new VirtualConsole() }).window.document;
      articleHeadings = [...adoc.querySelectorAll('h2, h3')]
        .map((n) => ({ level: Number(n.tagName.slice(1)), text: clean(n.textContent) }))
        .filter((h) => h.text && h.text.length <= 200);
    } else {
      noText = true; // no usable article body (word count unavailable)
    }
  } catch (e) {
    noText = true;
  }

  // Prefer the clean article-body H2/H3; fall back to the page's layout H2/H3
  // when the article body produced none (the user trims noise via checkboxes).
  const subHeadings = articleHeadings.length ? articleHeadings : docHeadings;

  const headings = [
    ...h1s.map((t) => ({ level: 1, text: t })),
    ...subHeadings,
  ];

  return { title, headings, words, zbp, noText };
}

module.exports = { parseHeadings };
