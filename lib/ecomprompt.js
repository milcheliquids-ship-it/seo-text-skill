const { t } = require('./i18n');
const { DOCS, docForPageType } = require('./promptdocs');

// Сборка промпта СТРОГО по одному из трёх документов в корне репозитория
// (universal-seo-prompt-ecommerce/-blog/-service.md). Документ выбирается по
// типу страницы (см. promptdocs.docForPageType); инструкции зашиты дословно в
// promptdocs.js (генерируется из md: node scripts/gen-promptdocs.js), а
// test/ecomprompt.test.js сверяет каждую строку с md — расхождение валит тест.
//
// Генерируется только блок «ВВОДНЫЕ ДАННЫЕ» (раздел 1): поля со ★ обязательны,
// пустые опциональные строки опускаются — срабатывают дефолты документа
// (объём по типу страницы, регион «Украина», тон, формат HTML). Имена полей,
// различающиеся между документами (тема/факты/цена-тариф), берутся из конфига
// документа. Язык промпта — всегда русский (документ и есть контракт); язык
// будущего ТЕКСТА задаётся полем ★ ЯЗЫК.
//
// «Дополнительные требования» и микроразметка (кроме FAQ — он уже обязателен
// разделами 9/14) добавляются ПОСЛЕ промпта отдельным блоком заказчика, не
// изменяя ни одной строки документа.

const keyName = (k) => (typeof k === 'string' ? k : (k && k.keyword) || '').trim();
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// «ключ (частота)» — частота добавляется, когда известна (док: «желательно»).
function keyWithVolume(k) {
  const name = keyName(k);
  const vol = k && typeof k === 'object' && k.volume != null && k.volume !== '' ? +k.volume : null;
  return vol ? `${name} (${vol})` : name;
}

// Фразы-коллокации: строки textarea идут как есть; объекты конвейера — в
// «фраза — N сайт.» (раздел 5 дока опирается на встречаемость у нескольких).
function phraseLine(p) {
  if (typeof p === 'string') return p.trim();
  if (!p || !p.phrase) return '';
  return p.sites ? `${p.phrase} — ${p.sites} сайт.` : String(p.phrase);
}

// ---- Раздел 1: блок вводных --------------------------------------------
// Однострочные поля: «ИМЯ: значение». Многострочные (ядро, заголовки, факты,
// ссылки): «ИМЯ:» + строки значения как есть — следующее ИМЯ_КАПСОМ открывает
// новое поле, двусмысленности нет. Пустые опциональные поля опускаются. Имена
// полей и единица объёма берутся из L.labels выбранного языка документа;
// reqLang — язык ТЕКСТА (значение поля ★ ЯЗЫК), может отличаться от языка
// документа при фолбэке (англ. текст по русскому документу).
function inputBlock(tz, L, reqLang) {
  const lab = L.labels;
  const out = [];
  const push = (label, value) => { const v = String(value == null ? '' : value).trim(); if (v) out.push(label + ': ' + v); };
  const pushMulti = (label, text) => {
    const v = String(text == null ? '' : text).replace(/\s+$/, '');
    if (!v.trim()) return;
    out.push(label + ':');
    for (const line of v.split('\n')) out.push(line.replace(/\s+$/, ''));
  };

  const firstType = Object.values(L.pageTypes)[0];
  push(lab.pageType, L.pageTypes[tz.pageType] || firstType);
  push(lab.topic, tz.topic);

  out.push(`${lab.langField}: ${reqLang}${lab.langSuffix}`);

  const keys = (Array.isArray(tz.keywords) ? tz.keywords : []).filter((k) => keyName(k));
  const mainKey = String(tz.mainKey || '').trim() || keyName(keys[0]) || String(tz.topic || '').trim();
  push(lab.mainKey, mainKey);

  const secondary = keys.filter((k) => norm(keyName(k)) !== norm(mainKey));
  if (secondary.length) push(lab.secondary, secondary.map(keyWithVolume).join(', '));

  pushMulti(lab.core, tz.core);

  const lsi = (Array.isArray(tz.lsi) ? tz.lsi : []).map((w) => String(w).trim()).filter(Boolean);
  if (lsi.length) push(lab.lsi, lsi.join(', '));

  pushMulti(lab.headings, tz.competitorHeadings);

  const phrases = (Array.isArray(tz.competitorPhrases) ? tz.competitorPhrases : [])
    .map(phraseLine).filter(Boolean);
  if (phrases.length) pushMulti(lab.collocations, phrases.join('\n'));

  pushMulti(lab.facts, tz.facts);
  push(lab.region, tz.region);
  if (lab.price) push(lab.price, tz.priceFrom);

  // Единица объёма зависит от языка SEO: рунет — символы без пробелов (поле
  // volumeZbp), англо-SEO — слова (поле requirements.volume).
  const volRaw = lab.volumeSource === 'words'
    ? (tz.requirements && tz.requirements.volume)
    : tz.volumeZbp;
  const volStr = String(volRaw == null ? '' : volRaw).trim();
  if (volStr && +volStr > 0) push(lab.volume, `${+volStr} ${lab.volumeUnit}`);

  pushMulti(lab.links, tz.links);
  push(lab.tone, tz.tone);
  out.push(`${lab.format}: ` + (tz.format === 'md' || tz.format === 'markdown' ? 'Markdown' : 'HTML'));

  return [lab.inputHeading, '', '```', ...out, '```'].join('\n');
}

// ---- Блок заказчика ПОСЛЕ промпта (ничего из документа не меняет) -------
// Сюда идут «Дополнительные требования» и отмеченная микроразметка. FAQ
// отфильтрован: видимый FAQ + JSON-LD FAQPage уже обязательны разделами 9/14.
// lang = язык документа (для локализации заголовка и инструкций схем).
function appendix(tz, lang) {
  const extra = String(tz.extra || '').trim();
  const schemas = (Array.isArray(tz.schemas) ? tz.schemas : []).filter((s) => s && s !== 'faq');
  if (!extra && !schemas.length) return '';

  const L = [t(lang, 'customerReqHeader')];
  if (extra) { L.push(''); L.push(extra); }
  if (schemas.length) {
    const map = {
      howto: 'schemaHowto', article: 'schemaArticle', product: 'schemaProduct',
      review: 'schemaReview', breadcrumb: 'schemaBreadcrumb', itemlist: 'schemaItemlist',
    };
    const lines = schemas.map((s) => map[s] && t(lang, map[s])).filter(Boolean);
    if (lines.length) {
      L.push('');
      L.push(t(lang, 'schemaHeader'));
      L.push(t(lang, 'schemaJsonld'));
      L.push(...lines);
    }
  }
  return L.join('\n');
}

// Готовый к вставке промпт: преамбула → раздел 1 (вводные) → разделы 2–15
// выбранного документа дословно → опциональный блок заказчика. Документ —
// по типу страницы; язык — по tz.lang (фолбэк на ru, если язык не написан).
function buildEcomPrompt(tz = {}) {
  const doc = docForPageType(tz.pageType);
  const reqLang = tz.lang === 'en' || tz.lang === 'uk' ? tz.lang : 'ru';
  const docLang = doc.langs[reqLang] ? reqLang : 'ru';
  const L = doc.langs[docLang];
  const parts = [L.preamble, '', inputBlock(tz, L, reqLang), '', L.rules];
  const app = appendix(tz, docLang);
  if (app) { parts.push('', '---', '', app); }
  return parts.join('\n');
}

module.exports = { buildEcomPrompt, DOCS, docForPageType };
