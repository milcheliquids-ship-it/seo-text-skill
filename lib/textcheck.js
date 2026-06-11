const { JSDOM, VirtualConsole } = require('jsdom');
const { tokenize } = require('./analyze');
const { stemWord } = require('./normalize');
const { STOPWORDS } = require('./stopwords');

// ───────────────────────────────────────────────────────────────────────────
// Пост-проверка сгенерированного текста по требованиям документа
// universal-seo-prompt-ecommerce.md (разделы 4, 5, 7, 8–15). Pure + тесты.
//
// Вход: { text (ответ нейронки целиком: HTML или plain), mainKey, keywords[],
//         lsi[], volumeZbp, pageType }.
// Выход: { metrics, checks: [{ id, status: ok|warn|fail|info|skip, label,
//          details }], counts }.
//
// Честность метрик: плотность ключа, тошнота по слову, объём, вхождения,
// бан-лист, структура — считаются ТОЧНО по формулам документа. Академическая
// тошнота, вода и заспамленность — приближения (формулы Advego/Text.ru
// закрыты), помечены «≈»; финальную цифру даёт сам сервис — наша задача
// поймать грубые промахи до отправки текста на проверку.
// ───────────────────────────────────────────────────────────────────────────

// Бан-лист клише из раздела 11 — дословно (поиск без учёта регистра/запятых).
const BANNED = [
  'в наше время', 'на сегодняшний день', 'не секрет что',
  'широкий ассортимент по доступным ценам', 'команда профессионалов',
  'индивидуальный подход', 'динамично развивающаяся компания',
  'высочайшее качество', 'лидер рынка', 'важно отметить', 'стоит подчеркнуть',
  'в современном мире', 'играет важную роль',
];

// Диапазоны объёма по типу страницы (раздел 3 соответствующего документа), збп:
// e-commerce / блог / контент-сервис — см. promptdocs.js и md-файлы в корне.
const VOLUME_BY_TYPE = {
  category: [2500, 4000], product: [1000, 1800], brand: [1500, 2500], filter: [800, 1500],
  guide: [4000, 7000], explainer: [2500, 4500], listicle: [4000, 8000], comparison: [3000, 5000],
  content: [800, 1500], catalog: [1500, 3000], landing: [2500, 4000], eduguide: [3000, 6000],
};

const norm = (s) => String(s || '').toLowerCase().replace(/[,]/g, '').replace(/\s+/g, ' ').trim();
const zbpOf = (s) => String(s || '').replace(/\s+/g, '').length;

// Значимые стемы фразы (без стоп-слов и чисел).
function sigStems(phrase) {
  return tokenize(String(phrase || ''))
    .filter((w) => !STOPWORDS.has(w) && !/^[\d-]+$/.test(w))
    .map(stemWord);
}

// Вхождения фразы «со словоформами»: скользящее окно по значимым стемам
// текста; совпадение — когда мультимножество окна равно мультимножеству
// стемов ключа (покрывает словоформы, перестановки и вставные предлоги).
function stemOccurrences(textStems, kwStems) {
  const n = kwStems.length;
  if (!n || textStems.length < n) return 0;
  const need = new Map();
  for (const s of kwStems) need.set(s, (need.get(s) || 0) + 1);
  let count = 0;
  for (let i = 0; i + n <= textStems.length; i++) {
    const win = new Map();
    let ok = true;
    for (let j = i; j < i + n; j++) {
      const s = textStems[j];
      if (!need.has(s)) { ok = false; break; }
      win.set(s, (win.get(s) || 0) + 1);
      if (win.get(s) > need.get(s)) { ok = false; break; }
    }
    if (ok) { count++; i += n - 1; } // без перекрытий
  }
  return count;
}

// Точные вхождения (подстрока, нормализованные пробелы/регистр) + позиции.
function exactPositions(haystackNorm, phrase) {
  const p = norm(phrase);
  if (!p) return [];
  const out = [];
  let idx = 0;
  while ((idx = haystackNorm.indexOf(p, idx)) !== -1) { out.push(idx); idx += p.length; }
  return out;
}

// ---- Разбор ответа нейронки ----------------------------------------------
// Структура берётся из HTML-тегов; текстовая статистика — ТОЛЬКО из контентных
// элементов (h1-h3/p/li/td), чтобы карта ключей и JSON-LD из ответа не
// искажали плотность. Plain-текст без тегов: структурные проверки skip.
function parseAnswer(raw) {
  const text = String(raw || '');
  const isHtml = /<\s*(h1|h2|h3|p|ul|ol|li|table)[\s>]/i.test(text);

  // Title / Description — нейронка выводит их строками до H1 (раздел 14 п.2).
  const titleM = text.match(/(?:^|\n)\s*(?:\*\*|#+\s*)?title(?:\*\*)?\s*[::]\s*(.+?)\s*(?:\n|$)/i);
  const descM = text.match(/(?:^|\n)\s*(?:\*\*|#+\s*)?description(?:\*\*)?\s*[::]\s*(.+?)\s*(?:\n|$)/i);

  // JSON-LD FAQPage: из <script type="application/ld+json"> или голого блока.
  const faq = { found: false, questions: [], valid: false };
  const ldBlocks = [...text.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  if (!ldBlocks.length && /"@type"\s*:\s*"FAQPage"/i.test(text)) {
    const at = text.search(/\{[^{}]*"@type"\s*:\s*"FAQPage"/i);
    if (at !== -1) { // вырезаем сбалансированный {...} от первой скобки
      let depth = 0;
      for (let i = at; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') { depth--; if (!depth) { ldBlocks.push(text.slice(at, i + 1)); break; } }
      }
    }
  }
  for (const block of ldBlocks) {
    try {
      const data = JSON.parse(block);
      const nodes = Array.isArray(data) ? data : (data['@graph'] || [data]);
      for (const node of nodes) {
        if (node && node['@type'] === 'FAQPage' && Array.isArray(node.mainEntity)) {
          faq.found = true; faq.valid = true;
          faq.questions = node.mainEntity.map((q) => ({
            q: (q && q.name) || '',
            a: (q && q.acceptedAnswer && q.acceptedAnswer.text) || '',
          }));
        }
      }
    } catch (e) { if (/FAQPage/i.test(block)) { faq.found = true; faq.valid = false; } }
  }

  if (!isHtml) {
    const paras = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
    return {
      isHtml, title: titleM && titleM[1], desc: descM && descM[1], faq,
      h1: [], h2: [], h3: [], seq: [], paragraphs: paras, listItems: [],
      lists: 0, tables: [], strong: 0, linksPerPara: [], badTags: [],
      articleText: text, segments: paras.length ? paras : [text],
    };
  }

  const dom = new JSDOM(text, { virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  const grab = (sel) => [...doc.querySelectorAll(sel)].map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);

  const h1 = grab('h1');
  const h2 = grab('h2');
  const h3 = grab('h3');
  const seq = [...doc.querySelectorAll('h1,h2,h3')].map((n) => +n.tagName[1]);
  const paragraphs = grab('p');
  const listItems = grab('li');
  const lists = doc.querySelectorAll('ul').length + doc.querySelectorAll('ol').length;
  const tables = [...doc.querySelectorAll('table')].map((t) => t.querySelectorAll('tr').length);
  const strong = doc.querySelectorAll('strong,b').length;
  const linksPerPara = [...doc.querySelectorAll('p')].map((p) => p.querySelectorAll('a').length);
  const badTags = [];
  if (doc.querySelector('div')) badTags.push('div');
  if (doc.querySelector('[class]')) badTags.push('class=');
  if (doc.querySelector('[style]')) badTags.push('style=');
  // Текст статьи — контентные элементы; li/td уже входят в ul/table textContent,
  // поэтому собираем по верхнеуровневым блокам. segments — те же блоки, но НЕ
  // склеенные: по ним считаем вхождения ключей, чтобы скользящее окно фразы не
  // перескакивало границу элементов (ложный триграм «…Hot Toys» + «фигурка…»).
  const segments = [...doc.querySelectorAll('h1,h2,h3,p,ul,ol,table')]
    .map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const articleText = segments.join('\n');

  return { isHtml, title: titleM && titleM[1], desc: descM && descM[1], faq, h1, h2, h3, seq, paragraphs, listItems, lists, tables, strong, linksPerPara, badTags, articleText, segments };
}

// ---- Главная проверка ------------------------------------------------------
// lang влияет на набор метрик: тошнота/вода/бан-лист клише — это инструменты
// рунета (Advego/Text.ru) и применимы к ru/uk; для английского текста они не
// имеют смысла (другой алгоритм SEO-проверок) — такие пункты помечаются n/a.
function check({ text, mainKey = '', keywords = [], lsi = [], volumeZbp = 0, pageType = 'category', lang = 'ru' } = {}) {
  const isRu = lang === 'ru';
  const isRuUk = lang === 'ru' || lang === 'uk';
  const P = parseAnswer(text);
  const art = P.articleText;
  const artNorm = norm(art);
  const zbp = zbpOf(art);
  const tokens = tokenize(art);
  const totalWords = tokens.length;
  const textStems = tokens.filter((w) => !STOPWORDS.has(w) && !/^[\d-]+$/.test(w)).map(stemWord);

  // Значимые стемы ПО СЕГМЕНТАМ (элементам) — для подсчёта вхождений ключей
  // окном фразы без перескока через границу элементов. Частотные метрики
  // (тошнота/LSI) считаются по textStems (склейке) — там границы не важны.
  const segStems = (P.segments || [art]).map((s) =>
    tokenize(s).filter((w) => !STOPWORDS.has(w) && !/^[\d-]+$/.test(w)).map(stemWord));
  const countOcc = (kw) => (kw.length ? segStems.reduce((n, seg) => n + stemOccurrences(seg, kw), 0) : 0);

  const checks = [];
  const add = (id, status, label, details = '') => checks.push({ id, status, label, details });

  // — Объём (раздел 3 / чек-лист п.3)
  const range = VOLUME_BY_TYPE[pageType] || VOLUME_BY_TYPE.category;
  if (+volumeZbp > 0) {
    const target = +volumeZbp;
    const dev = (zbp - target) / target * 100;
    add('volume', Math.abs(dev) <= 10 ? 'ok' : 'fail', 'Объём в пределах задания ±10%',
      `${zbp} збп при задании ${target} (${dev > 0 ? '+' : ''}${dev.toFixed(0)}%)`);
  } else {
    const okRange = zbp >= range[0] && zbp <= range[1];
    add('volume', okRange ? 'ok' : 'warn', 'Объём в диапазоне типа страницы',
      `${zbp} збп; норма для типа — ${range[0]}–${range[1]} збп`);
  }

  // — Главный ключ (раздел 4 / чек-лист п.1)
  const kwStems = sigStems(mainKey);
  const kwLen = kwStems.length;
  if (mainKey && kwLen) {
    const inH1 = P.h1.some((h) => stemOccurrences(sigStems(h), kwStems) > 0);
    add('key-h1', inH1 ? 'ok' : 'fail', 'Главный ключ в H1', P.h1[0] ? `H1: «${P.h1[0]}»` : 'H1 не найден');
    const firstP = P.paragraphs[0] || '';
    const inLead = stemOccurrences(sigStems(firstP), kwStems) > 0;
    add('key-lead', inLead ? 'ok' : 'fail', 'Главный ключ в первом абзаце', inLead ? '' : 'в лиде нет вхождения (словоформы тоже считаются)');
    const inH2 = P.h2.some((h) => sigStems(h).some((s) => kwStems.includes(s)));
    add('key-h2', inH2 ? 'ok' : 'warn', 'Вхождение (или словоформа) в одном из H2', '');

    // точные вхождения: норма = 2 (H1+лид) + 1 на каждые 2000 збп
    const exact = exactPositions(artNorm, mainKey);
    const maxExact = 2 + Math.floor(zbp / 2000);
    add('key-exact', exact.length <= maxExact ? 'ok' : 'fail',
      'Точных вхождений главного ключа не больше нормы',
      `${exact.length} точных при норме ≤${maxExact} (2 + 1 на каждые 2000 збп)`);

    // плотность со словоформами 1–2% от слов текста
    const occ = countOcc(kwStems);
    const density = totalWords ? (occ * kwLen / totalWords * 100) : 0;
    add('key-density', density >= 1 && density <= 2 ? 'ok' : (density < 1 ? 'warn' : 'fail'),
      'Плотность главного ключа со словоформами 1–2%',
      `${occ} вхожд. × ${kwLen} сл. / ${totalWords} слов = ${density.toFixed(2)}%`);

    // дистанция ≥300 збп между точными вхождениями любых ключей
    const allExactPos = [...exact];
    for (const k of keywords) allExactPos.push(...exactPositions(artNorm, typeof k === 'string' ? k : k.keyword));
    allExactPos.sort((a, b) => a - b);
    let minGap = Infinity;
    for (let i = 1; i < allExactPos.length; i++) {
      const gap = zbpOf(artNorm.slice(allExactPos[i - 1], allExactPos[i]));
      if (gap < minGap) minGap = gap;
    }
    if (allExactPos.length > 1) {
      add('key-distance', minGap >= 300 ? 'ok' : 'warn', 'Дистанция между точными вхождениями ≥ 300 збп',
        `минимальный зазор ${minGap === Infinity ? '—' : minGap + ' збп'}`);
    }
    // ≤1 точного ключа на абзац
    const phrases = [mainKey, ...keywords.map((k) => (typeof k === 'string' ? k : k.keyword))].filter(Boolean);
    const crowded = P.paragraphs.filter((p) => {
      const pn = norm(p);
      let cnt = 0;
      for (const ph of phrases) cnt += exactPositions(pn, ph).length;
      return cnt > 1;
    }).length;
    add('key-per-para', crowded === 0 ? 'ok' : 'warn', 'Не более одного точного ключа на абзац',
      crowded ? `${crowded} абзац(а) с 2+ точными ключами` : '');
  } else {
    add('key-h1', 'skip', 'Главный ключ не задан — проверки ключа пропущены', '');
  }

  // — Вторичные ключи: каждый 1–2 раза (раздел 4)
  const secondary = keywords.map((k) => (typeof k === 'string' ? k : k.keyword))
    .filter((k) => k && norm(k) !== norm(mainKey));
  if (secondary.length) {
    const rows = secondary.map((k) => ({ k, n: countOcc(sigStems(k)) }));
    const missing = rows.filter((r) => r.n === 0);
    const over = rows.filter((r) => r.n > 2);
    const st = missing.length ? 'fail' : (over.length ? 'warn' : 'ok');
    add('secondary', st, 'Вторичные ключи: каждый 1–2 раза',
      (missing.length ? `нет вхождений: ${missing.map((r) => r.k).join(', ')}. ` : '') +
      (over.length ? `чаще 2 раз: ${over.map((r) => `${r.k} (${r.n})`).join(', ')}` : '') ||
      rows.map((r) => `${r.k} — ${r.n}`).join('; '));
  }

  // — LSI: 60–80% списка, каждое ≤2 раз (раздел 5 / чек-лист п.5)
  const lsiList = (lsi || []).map((w) => String(w).trim()).filter(Boolean);
  if (lsiList.length) {
    const stemCount = new Map();
    for (const s of textStems) stemCount.set(s, (stemCount.get(s) || 0) + 1);
    const found = [];
    const notFound = [];
    const overused = [];
    for (const w of lsiList) {
      const s = stemWord(tokenize(w)[0] || '');
      const n = stemCount.get(s) || 0;
      if (n > 0) found.push(w); else notFound.push(w);
      if (n > 2) overused.push(`${w} (${n})`);
    }
    const cov = found.length / lsiList.length * 100;
    add('lsi', cov >= 60 && cov <= 90 ? 'ok' : 'warn', 'LSI: использовано 60–80% списка',
      `${found.length}/${lsiList.length} = ${cov.toFixed(0)}%` +
      (notFound.length ? `; не вписаны: ${notFound.slice(0, 12).join(', ')}${notFound.length > 12 ? '…' : ''}` : ''));
    if (overused.length) add('lsi-over', 'warn', 'LSI чаще 2 раз', overused.join(', '));
  }

  // — Тошноты и вода (раздел 4): по слову — точно; академическая/вода — «≈»
  const sigCount = new Map();
  for (const s of textStems) sigCount.set(s, (sigCount.get(s) || 0) + 1);
  const sorted = [...sigCount.entries()].sort((a, b) => b[1] - a[1]);
  const topLemma = sorted[0] || ['—', 0];
  const wordNausea = totalWords ? topLemma[1] / totalWords * 100 : 0;
  add('nausea-word', wordNausea <= 3 ? 'ok' : 'fail', 'Тошнота по слову ≤ 3% (ни одна лемма чаще)',
    `максимум: «${topLemma[0]}» — ${topLemma[1]} раз = ${wordNausea.toFixed(2)}%`);
  const top5 = sorted.slice(0, 5).reduce((a, [, c]) => a + c, 0);
  const academic = totalWords ? top5 / totalWords * 100 : 0;
  const stopShare = totalWords ? tokens.filter((w) => STOPWORDS.has(w)).length / totalWords * 100 : 0;
  if (isRuUk) {
    add('nausea-acad', academic >= 4 && academic <= 9.5 ? 'ok' : 'info', 'Академическая тошнота ≈ 6,0–8,5% (оценка)',
      `топ-5 лемм = ${academic.toFixed(1)}% слов; финальную цифру даст Advego`);
    add('water', 'info', 'Вода (оценка; шкала Text.ru иная)',
      `служебных слов ${stopShare.toFixed(0)}%; норма RU-текста ~20–35%. Цель документа: Text.ru ≤ 15%`);
  } else {
    add('nausea-acad', 'skip', 'Академическая тошнота / вода — метрики рунета (Advego/Text.ru)',
      'для английского текста не применяются; используй Yoast/Hemingway/SurferSEO');
  }

  // — Бан-лист и «является» (раздел 11 / чек-лист п.7) — клише русские
  if (isRu) {
    const banned = BANNED.filter((b) => artNorm.includes(b));
    add('banlist', banned.length ? 'fail' : 'ok', 'Бан-лист клише',
      banned.length ? 'найдено: ' + banned.join('; ') : 'чисто');
    const yavl = tokens.filter((w) => w.startsWith('явля')).length;
    add('yavl', yavl <= 2 ? 'ok' : 'warn', '«Является» не чаще 2 раз', `${yavl} раз`);
  } else {
    add('banlist', 'skip', 'Бан-лист клише — список для русского текста',
      'для другого языка нужен свой список клише (в планах)');
  }

  // — Структура (разделы 7/14 / чек-лист п.8) — только для HTML
  if (P.isHtml) {
    add('h1', P.h1.length === 1 && P.h1[0].length <= 70 ? 'ok' : 'fail',
      'Один H1 длиной ≤ 70 символов', `H1: ${P.h1.length} шт.` + (P.h1[0] ? `, ${P.h1[0].length} симв.` : ''));
    let levelOk = true;
    let prev = 1;
    for (const lvl of P.seq) { if (lvl === 3 && prev < 2) { levelOk = false; break; } if (lvl > 1) prev = lvl; }
    add('hierarchy', levelOk ? 'ok' : 'warn', 'Иерархия H2 → H3 без перескоков', '');
    // Норма H2 масштабируется от правила «4–6 H2 на 3000–4000 збп» (≈5 на 3500):
    // длинный гайд на 7000 збп законно несёт 8–12 H2, а не 4–6.
    const h2n = P.h2.length;
    if (zbp >= 2500) {
      const mid = Math.round(zbp / 3500 * 5);
      const lo = Math.max(3, mid - 2);
      const hi = mid + 2;
      add('h2-count', h2n >= lo && h2n <= hi ? 'ok' : 'warn',
        'Число H2 соответствует объёму (4–6 на 3000–4000 збп)', `${h2n} H2 на ${zbp} збп; норма ≈ ${lo}–${hi}`);
    }
    const qShare = h2n ? P.h2.filter((h) => h.includes('?')).length / h2n : 0;
    const firsts = P.h2.map((h) => (tokenize(h)[0] || ''));
    const dupFirst = firsts.length > 1 && new Set(firsts).size === 1;
    add('h2-variety', qShare < 1 && !dupFirst ? 'ok' : 'warn', 'H2 разнообразны по форме',
      qShare === 1 ? 'все H2 — вопросы' : (dupFirst ? 'все H2 начинаются с одного слова' : ''));
    const longP = P.paragraphs.filter((p) => p.length > 600).length;
    add('para', longP === 0 ? 'ok' : 'warn', 'Абзацы ≤ 600 символов', longP ? `${longP} абзац(ев) длиннее` : '');
    add('lists', P.lists >= 1 ? 'ok' : 'fail', 'Есть ≥ 1 список', `списков: ${P.lists}`);
    if (P.tables.length) add('table', P.tables.every((r) => r <= 6) ? 'ok' : 'warn', 'Таблица до 5–6 строк', `строк: ${P.tables.join(', ')}`);
    add('strong', P.strong <= 4 ? 'ok' : 'warn', '<strong> не более 3–4 раз', `${P.strong} раз`);
    add('clean-html', P.badTags.length ? 'warn' : 'ok', 'Только разрешённые теги (без div/классов/стилей)',
      P.badTags.length ? 'найдено: ' + P.badTags.join(', ') : '');
    const maxLinks = Math.max(0, ...P.linksPerPara);
    if (maxLinks > 0) add('links', maxLinks <= 1 ? 'ok' : 'warn', 'Не более 1 ссылки на абзац', `макс. ${maxLinks}`);
    // повторяющиеся первые слова соседних абзацев / пунктов
    const paraFirsts = P.paragraphs.map((p) => tokenize(p)[0] || '');
    let dupAdj = 0;
    for (let i = 1; i < paraFirsts.length; i++) if (paraFirsts[i] && paraFirsts[i] === paraFirsts[i - 1]) dupAdj++;
    add('para-starts', dupAdj === 0 ? 'ok' : 'warn', 'Соседние абзацы не начинаются с одного слова', dupAdj ? `${dupAdj} повтора` : '');
  } else {
    add('structure', 'skip', 'Структурные проверки пропущены — текст без HTML-разметки', '');
  }

  // — FAQ + JSON-LD (раздел 9 / чек-лист п.9)
  if (P.faq.found) {
    const n = P.faq.questions.length;
    add('faq-jsonld', P.faq.valid ? 'ok' : 'fail', 'JSON-LD FAQPage валиден', P.faq.valid ? '' : 'JSON не парсится');
    add('faq-count', n >= 4 && n <= 6 ? 'ok' : 'warn', 'FAQ: 4–6 вопросов', `${n} вопрос(ов)`);
    const badLen = P.faq.questions.filter((q) => { const L = String(q.a || '').length; return L < 160 || L > 450; }).length;
    add('faq-len', badLen === 0 ? 'ok' : 'warn', 'Ответы FAQ ≈ 200–400 символов', badLen ? `${badLen} вне диапазона` : '');
    const h2set = new Set(P.h2.map((h) => norm(h)));
    const dup = P.faq.questions.filter((q) => h2set.has(norm(q.q))).length;
    add('faq-dup', dup === 0 ? 'ok' : 'warn', 'Вопросы FAQ не дублируют H2', dup ? `${dup} дублей` : '');
  } else {
    add('faq-jsonld', 'fail', 'JSON-LD FAQPage не найден', 'раздел 14 требует FAQ + JSON-LD');
  }

  // — Title / Description (раздел 10 / чек-лист п.10)
  if (P.title) {
    const L = P.title.length;
    add('title', L >= 50 && L <= 65 ? 'ok' : 'warn', 'Title 50–65 символов', `${L} симв.: «${P.title}»`);
    if (mainKey) add('title-key', stemOccurrences(sigStems(P.title), kwStems) > 0 ? 'ok' : 'warn', 'Главный ключ в Title', '');
  } else add('title', 'warn', 'Title не найден в ответе', 'ищу строку «Title: …»');
  if (P.desc) {
    const L = P.desc.length;
    add('desc', L >= 150 && L <= 160 ? 'ok' : 'warn', 'Description 150–160 символов', `${L} симв.`);
    add('desc-emoji', /[✅⚡✔️]/u.test(P.desc) ? 'ok' : 'warn', 'Description: эмодзи-разделители выгод', '');
  } else add('desc', 'warn', 'Description не найден в ответе', 'ищу строку «Description: …»');

  const counts = { ok: 0, warn: 0, fail: 0, info: 0, skip: 0 };
  for (const c of checks) counts[c.status] = (counts[c.status] || 0) + 1;

  return {
    ok: true,
    lang,
    ruMetrics: isRuUk,
    metrics: {
      zbp, words: totalWords,
      density: +(kwLen && totalWords ? (countOcc(kwStems) * kwLen / totalWords * 100) : 0).toFixed(2),
      wordNausea: +wordNausea.toFixed(2),
      academic: +academic.toFixed(1),
      stopShare: +stopShare.toFixed(0),
    },
    checks, counts,
  };
}

module.exports = { check, BANNED, VOLUME_BY_TYPE, stemOccurrences, sigStems, parseAnswer };
