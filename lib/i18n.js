// i18n for GENERATED OUTPUT (docx brief labels, brief-table note, Schema.org
// instruction lines). Pure + unit-tested. UI chrome is localized separately
// (renderer/ui-i18n.js); the AI prompt itself is NOT here — it is built
// verbatim-Russian from universal-seo-prompt-ecommerce.md (lib/ecomprompt.js),
// which reuses only the schema* lines below for its customer block.
// t(lang, key, vars) interpolates {topic}/{n}; unknown lang or key falls back
// to Russian.

const DICT = {
  ru: {
    customerReqHeader: 'ДОПОЛНИТЕЛЬНЫЕ ТРЕБОВАНИЯ ЗАКАЗЧИКА (выполни вместе с промптом выше; при конфликте приоритет у разделов 1–15):',
    schemaHeader: 'МИКРОРАЗМЕТКА (Schema.org) — сгенерируй валидную разметку:',
    schemaJsonld: '• Дополнительную разметку добавь в конец того же HTML-блока — в JSON-LD рядом с FAQPage (можно объединить в один <script type="application/ld+json"> через @graph). Только реальные данные из текста — ничего не выдумывай; где данных нет, ставь понятный плейсхолдер.',
    schemaHowto: '• HowTo: видимая пошаговая инструкция нумерованными шагами в тексте (полезно для пользователя и featured snippet). HowTo в JSON-LD — по желанию: rich-результаты HowTo Google отключил (2023), разметка валидна, но ценность теперь семантическая (для ИИ/парсинга).',
    schemaArticle: '• Article: JSON-LD Article (headline, description, author «Редакция», datePublished — плейсхолдер-дата).',
    schemaProduct: '• Product: JSON-LD Product (name, brand, description, offers с price/priceCurrency/availability — плейсхолдеры, если цен нет).',
    schemaReview: '• Review/AggregateRating: JSON-LD с рейтингом — ТОЛЬКО если на странице реально есть отзывы/оценка; не выдумывай рейтинг.',
    schemaBreadcrumb: '• BreadcrumbList: JSON-LD цепочки навигации (Главная → Раздел → Текущая страница).',
    schemaItemlist: '• ItemList: JSON-LD списка позиций обзора/подборки в порядке упоминания.',
    docTitle: 'Техническое задание',
    docRegion: 'Регион',
    docDate: 'Дата',
    docMeta: 'Метатеги',
    docReqs: 'Требования к тексту',
    docVolume: 'Объём: от {n} слов',
    docUniq: 'Уникальность: от {n}%',
    docNausea: 'Макс. тошнота: {n}',
    docHeadingsCount: 'Кол-во заголовков: {n}',
    docStructure: 'Структура заголовков',
    docKeywords: 'Ключевые слова',
    docNoCluster: 'Без кластера',
    docLsi: 'Ключевые слова (LSI)',
    docPhrases: 'Фразы конкурентов',
    docPhrasesNote: 'Часто используемые словосочетания у конкурентов из топа — примеры LSI/словоформ. Использовать по смыслу, не обязательно все.',
    docExtra: 'Дополнительные требования',
    noteBase: 'Необходимо написать текст, внедряя все указанные ключевые запросы и по возможности все LSI-слова.',
    noteVolume: ' Объём: {n} слов.',
    noteUniq: ' Уникальность: от {n}%.',
    noteNausea: ' Тошнота: не выше {n}.',
  },
  uk: {
    customerReqHeader: 'ДОДАТКОВІ ВИМОГИ ЗАМОВНИКА (виконай разом із промптом вище; за конфлікту пріоритет у розділів 1–15):',
    schemaHeader: 'МІКРОРОЗМІТКА (Schema.org) — згенеруй валідну розмітку:',
    schemaJsonld: '• Додаткову розмітку додай у кінець того ж HTML-блоку — у JSON-LD поруч із FAQPage (можна обʼєднати в один <script type="application/ld+json"> через @graph). Лише реальні дані з тексту — нічого не вигадуй; де даних немає, постав зрозумілий плейсхолдер.',
    schemaHowto: '• HowTo: видима покрокова інструкція нумерованими кроками в тексті (корисно для користувача та featured snippet). HowTo в JSON-LD — за бажанням: rich-результати HowTo Google вимкнув (2023), розмітка валідна, але цінність тепер семантична (для ШІ/парсингу).',
    schemaArticle: '• Article: JSON-LD Article (headline, description, author «Редакція», datePublished — плейсхолдер-дата).',
    schemaProduct: '• Product: JSON-LD Product (name, brand, description, offers з price/priceCurrency/availability — плейсхолдери, якщо цін немає).',
    schemaReview: '• Review/AggregateRating: JSON-LD з рейтингом — ЛИШЕ якщо на сторінці справді є відгуки/оцінка; не вигадуй рейтинг.',
    schemaBreadcrumb: '• BreadcrumbList: JSON-LD ланцюжка навігації (Головна → Розділ → Поточна сторінка).',
    schemaItemlist: '• ItemList: JSON-LD списку позицій огляду/добірки в порядку згадування.',
    docTitle: 'Технічне завдання',
    docRegion: 'Регіон',
    docDate: 'Дата',
    docMeta: 'Метатеги',
    docReqs: 'Вимоги до тексту',
    docVolume: 'Обсяг: від {n} слів',
    docUniq: 'Унікальність: від {n}%',
    docNausea: 'Макс. нудота: {n}',
    docHeadingsCount: 'Кількість заголовків: {n}',
    docStructure: 'Структура заголовків',
    docKeywords: 'Ключові слова',
    docNoCluster: 'Без кластера',
    docLsi: 'Ключові слова (LSI)',
    docPhrases: 'Фрази конкурентів',
    docPhrasesNote: 'Часто вживані словосполучення в конкурентів із топу — приклади LSI/словоформ. Вживати за змістом, не обовʼязково всі.',
    docExtra: 'Додаткові вимоги',
    noteBase: 'Необхідно написати текст, впроваджуючи всі зазначені ключові запити та за можливості всі LSI-слова.',
    noteVolume: ' Обсяг: {n} слів.',
    noteUniq: ' Унікальність: від {n}%.',
    noteNausea: ' Нудота: не вище {n}.',
  },
  en: {
    customerReqHeader: 'ADDITIONAL CLIENT REQUIREMENTS (do these together with the prompt above; on conflict, sections 1–15 take priority):',
    schemaHeader: 'STRUCTURED DATA (Schema.org) — generate valid markup:',
    schemaJsonld: '• Add the extra markup to the end of the same HTML block — into the JSON-LD next to FAQPage (one <script type="application/ld+json"> with an @graph is fine). Use only real data from the text — invent nothing; where data is missing, use a clear placeholder.',
    schemaHowto: '• HowTo: a visible step-by-step guide with numbered steps in the copy (useful for users and featured snippets). HowTo JSON-LD is optional: Google removed HowTo rich results (2023), the markup stays valid but its value is now semantic (for AI/parsing).',
    schemaArticle: '• Article: JSON-LD Article (headline, description, author "Editorial", datePublished — placeholder date).',
    schemaProduct: '• Product: JSON-LD Product (name, brand, description, offers with price/priceCurrency/availability — placeholders if no price).',
    schemaReview: '• Review/AggregateRating: JSON-LD rating — ONLY if the page really has reviews/a rating; do not invent ratings.',
    schemaBreadcrumb: '• BreadcrumbList: JSON-LD navigation chain (Home → Section → Current page).',
    schemaItemlist: '• ItemList: JSON-LD list of the roundup/comparison items in order of mention.',
    docTitle: 'Content brief',
    docRegion: 'Region',
    docDate: 'Date',
    docMeta: 'Meta tags',
    docReqs: 'Text requirements',
    docVolume: 'Length: from {n} words',
    docUniq: 'Uniqueness: {n}%+',
    docNausea: 'Max keyword density: {n}',
    docHeadingsCount: 'Headings: {n}',
    docStructure: 'Heading structure',
    docKeywords: 'Keywords',
    docNoCluster: 'No cluster',
    docLsi: 'Keywords (LSI)',
    docPhrases: 'Competitor phrases',
    docPhrasesNote: 'Phrases frequently used by top competitors — examples of LSI/word-forms. Use by meaning, not all required.',
    docExtra: 'Additional requirements',
    noteBase: 'Write the text incorporating all the listed keywords and, where possible, all the LSI words.',
    noteVolume: ' Length: {n} words.',
    noteUniq: ' Uniqueness: {n}%+.',
    noteNausea: ' Over-optimization: max {n}.',
  },
};

const LANGS = Object.keys(DICT);

function t(lang, key, vars = {}) {
  const table = DICT[lang] || DICT.ru;
  let s = (table[key] != null ? table[key] : (DICT.ru[key] != null ? DICT.ru[key] : key));
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

module.exports = { t, LANGS, DICT };
