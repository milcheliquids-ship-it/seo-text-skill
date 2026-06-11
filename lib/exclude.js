// Result exclusion list ("минус-слова для результатов"): drop competitor
// headings / phrases that CONTAIN any of these words (case-insensitive
// substring). Used by the Заголовки and Пересечения tools to hide junk like
// FAQ blocks, promo banners, and anti-bot interstitials ("Триває перевірка
// безпеки", Cloudflare "checking your browser").
//
// Deliberately SEPARATE from DEFAULT_STOPWORDS (stopwords.js), which is for
// keyword tokenization. Putting UI-junk phrases into the tokenizer stop-set
// would distort the word-frequency analysis — so these lists never mix.
const DEFAULT_EXCLUDE = [
  'faq',
  'вопрос', 'питання', 'часто задаваемые', 'часті запитання',
  'бесплатно', 'безкоштовно',
  'акция', 'акції', 'акція', 'скидк', 'знижк',
  'перевірка безпеки', 'проверка безопасности', 'перевір', 'checking your browser', 'cloudflare',
  'войти', 'увійти', 'вход', 'логин', 'регистрация', 'реєстрація',
  'корзина', 'кошик', 'cookie', 'cookies',
  'подпис', 'підпис', 'рассылк', 'розсилк',
  'новости', 'новини', 'отзыв', 'відгук', 'контакт',
  'политика', 'політика', 'privacy', 'конфиденциальн', 'конфіденційн',
];

// Normalize a raw list (trim, lowercase, dedupe, drop empties).
function normExclude(list) {
  return [...new Set((list || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean))];
}

// Build a predicate: matches(text) === true if text contains any list word.
function makeExcludeMatcher(list) {
  const words = normExclude(list);
  return (text) => {
    if (!words.length) return false;
    const t = String(text || '').toLowerCase();
    return words.some((w) => t.includes(w));
  };
}

module.exports = { DEFAULT_EXCLUDE, normExclude, makeExcludeMatcher };
