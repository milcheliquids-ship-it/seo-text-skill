#!/usr/bin/env node
// Оркестратор скила «seo-text»: собирает данные и готовый промпт-инструкцию для
// генерации SEO-текста. Переиспользует ЧИСТЫЕ модули десктоп-приложения из
// ../../../src/lib (один движок на оба фронтенда — без Electron).
//
// Поток:
//   Serpstat (топ выдачи + related + suggestions + ключи 1-го конкурента + вопросы)
//     → краул страниц конкурентов (extract + headings)
//     → pipeline.run (set-cover ключи, LSI, коллокации, структура, объём в збп)
//     → ecomprompt.buildEcomPrompt (инструкция нужного документа/языка)
//   → JSON в stdout: { ok, prompt, brief, faqSeeds, diagnostics }
//
// Запуск (через Serpstat):
//   node collect.js --token <SERPSTAT> --category "<ВЧ-ключ>" --site shop.ua \
//        --type category --lang ru --region ua [--facts "<факты>"] [--count 10]
//
// Ручной режим без Serpstat (для теста / если ключи уже на руках):
//   node collect.js --no-serp --category "..." --kw "ключ1,ключ2" --url "https://a,https://b"
//
// На выходе поле `prompt` — это полный набор инструкций; модель (Claude в скиле)
// пишет текст, СЛЕДУЯ ему, затем проверяет себя через check.js.

const path = require('path');
const fs = require('fs');
// Модули движка: в проектном скиле — из репозитория (../../../src/lib), в
// самодостаточном бандле (~/.claude/skills/seo-text) — из вендоренного ./lib.
function resolveLib() {
  const cands = [path.join(__dirname, 'lib'), path.join(__dirname, '..', '..', '..', 'src', 'lib')];
  for (const c of cands) { try { if (fs.existsSync(path.join(c, 'serpstat.js'))) return c; } catch (e) {} }
  return cands[1];
}
const LIB = resolveLib();
const serpstat = require(path.join(LIB, 'serpstat'));
const { fetchHtml, extractFromHtml } = require(path.join(LIB, 'extract'));
const { parseHeadings } = require(path.join(LIB, 'headings'));
const { BROWSER_UA } = require(path.join(LIB, 'useragents'));
const pipeline = require(path.join(LIB, 'pipeline'));
const { buildEcomPrompt } = require(path.join(LIB, 'ecomprompt'));
const { hostFromUrl, isBlocked } = require(path.join(LIB, 'blocklist'));

// ---- args ----------------------------------------------------------------
function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { a[key] = true; }
      else { a[key] = next; i++; }
    }
  }
  return a;
}

// Регион → код поисковой базы Serpstat (можно перекрыть через --se).
const SE_BY_REGION = {
  ua: 'g_ua', ukraine: 'g_ua', украина: 'g_ua', україна: 'g_ua',
  ru: 'g_ru', russia: 'g_ru', россия: 'g_ru',
  us: 'g_us', usa: 'g_us', uk: 'g_uk', kz: 'g_kz', by: 'g_by', pl: 'g_pl', de: 'g_de',
};
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// ЗАГОЛОВКИ_КОНКУРЕНТОВ: «host (N збп):» + H1–H3 по сайтам (как в приложении).
function competitorHeadingsText(pagesMeta) {
  return (pagesMeta || [])
    .filter((p) => (p.headings || []).length)
    .map((p) => {
      const head = (p.host || '') + (p.zbp ? ` (${p.zbp} збп)` : '') + ':';
      const lines = (p.headings || [])
        .filter((h) => h.level >= 1 && h.level <= 3)
        .map((h) => (h.level === 3 ? '  ' : '') + 'H' + h.level + ': ' + h.text);
      return lines.length ? [head, ...lines].join('\n') : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

// Полный кластер «запрос — частота» для СЕМАНТИЧЕСКОГО_ЯДРА.
function coreLines(rows) {
  return rows.map((r) => r.keyword + (r.volume != null && r.volume !== '' ? ' — ' + r.volume : '')).join('\n');
}

// Объединить списки ключей в один пул, дедуп по нормализованной фразе,
// сохраняя максимальную известную частоту.
function mergeKeywords(...lists) {
  const byKw = new Map();
  for (const list of lists) {
    for (const r of list || []) {
      const kw = (r.keyword || '').trim();
      if (!kw) continue;
      const k = norm(kw);
      const prev = byKw.get(k);
      const vol = r.volume != null ? r.volume : null;
      if (!prev) byKw.set(k, { keyword: kw, volume: vol });
      else if (vol != null && (prev.volume == null || vol > prev.volume)) prev.volume = vol;
    }
  }
  return [...byKw.values()];
}

// Скачать страницы конкурентов и привести к форме, которую ждёт pipeline.run.
async function crawl(urls) {
  const limit = 5;
  const out = [];
  for (let i = 0; i < urls.length; i += limit) {
    const batch = urls.slice(i, i + limit);
    const res = await Promise.all(batch.map(async (url) => {
      try {
        // Сначала как Googlebot (каноничный ранжируемый контент), при блоке
        // (403/таймаут) — повтор браузерным UA (без Chromium-фолбэка приложения).
        let r = await fetchHtml(url);
        if (!r.ok && (r.reason === 'http' || r.reason === 'timeout')) {
          const r2 = await fetchHtml(url, { ua: BROWSER_UA });
          if (r2.ok) r = r2;
        }
        if (!r.ok) return { url, ok: false, reason: r.reason };
        let headings = [];
        try { headings = parseHeadings(r.html, url).headings || []; } catch (e) {}
        const ex = extractFromHtml(r.html, url);
        if (!ex.ok) return { url, ok: false, reason: ex.reason, headings };
        return { url, ok: true, host: hostFromUrl(url), text: ex.text, chars: ex.chars, headings };
      } catch (e) {
        return { url, ok: false, reason: 'error', error: String((e && e.message) || e) };
      }
    }));
    out.push(...res);
  }
  return out;
}

async function main() {
  const a = parseArgs(process.argv);
  const category = String(a.category || '').trim();
  if (!category) throw new Error('нужен --category "<ВЧ-ключ категории>"');

  const pageType = a.type || 'category';
  const lang = a.lang === 'uk' || a.lang === 'en' ? a.lang : 'ru';
  const se = a.se || SE_BY_REGION[norm(a.region)] || 'g_ua';
  // Человекочитаемое имя региона для поля РЕГИОН (а --region/--se — код базы).
  const REGION_NAME = {
    ua: { ru: 'Украина', uk: 'Україна', en: 'Ukraine' }[lang],
    ru: { ru: 'Россия', uk: 'Росія', en: 'Russia' }[lang],
    us: 'United States', uk: 'United Kingdom', kz: 'Казахстан', by: 'Беларусь', pl: 'Poland', de: 'Germany',
  };
  const region = a['region-name'] || REGION_NAME[norm(a.region)] || a.region ||
    { ru: 'Украина', uk: 'Україна', en: 'United States' }[lang];
  const count = a.count ? parseInt(a.count, 10) : undefined;
  const facts = a.facts || '';
  // Доп. пожелания заказчика (свободный текст после стандартных параметров):
  // «упомянуть X», «ссылка на картинку <url>», особые блоки и т.п. → блок
  // ДОПОЛНИТЕЛЬНЫЕ ТРЕБОВАНИЯ в промпте. Микроразметка — через --schemas.
  // Требование к объёму («минимум 4000 знаков») задаётся --volume-zbp / --words
  // (переопределяет рассчитанный по конкурентам объём, чтобы промпт и проверка совпали).
  const extra = a.extra ? String(a.extra) : '';
  const schemas = a.schemas ? String(a.schemas).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const ovZbp = a['volume-zbp'] ? parseInt(a['volume-zbp'], 10) : 0;
  const ovWords = a.words ? parseInt(a.words, 10) : 0;
  const ownHost = a.site ? hostFromUrl(a.site.includes('//') ? a.site : 'http://' + a.site) : '';

  let group = [];      // пул ключей (ядро) [{keyword, volume}]
  let urls = [];       // URL конкурентов для краула
  let faqSeeds = [];   // вопросные ключи для FAQ
  const diag = { source: a['no-serp'] ? 'manual' : 'serpstat', se, errors: [] };

  if (a['no-serp']) {
    // Ручной режим: ключи и url переданы напрямую (тест / готовые данные).
    group = mergeKeywords(
      [{ keyword: category, volume: null }],
      String(a.kw || '').split(',').map((s) => ({ keyword: s.trim(), volume: null })).filter((r) => r.keyword),
    );
    urls = String(a.url || '').split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    const token = String(a.token || '').trim();
    if (!token) throw new Error('нужен --token <Serpstat API> (или --no-serp для ручного режима)');
    // Serpstat троттлит частые запросы (Too many requests) — пауза между вызовами.
    const gap = a.gap != null ? parseInt(a.gap, 10) : 1200;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let firstCall = true;
    const safe = async (label, fn) => {
      if (!firstCall) await sleep(gap);
      firstCall = false;
      try { return await fn(); } catch (e) { diag.errors.push(label + ': ' + String((e && e.message) || e)); return null; }
    };

    // 1) Топ органики из Serpstat → URL конкурентов (без скрейпа Google).
    const top = await safe('getKeywordTop', () => serpstat.getKeywordTop(token, category, se));
    const topRows = (top && top.rows) || [];
    urls = topRows.map((r) => r.url).filter(Boolean)
      .filter((u) => { const h = hostFromUrl(u); return h && h !== ownHost && !isBlocked(h, []); })
      .slice(0, count || 10);

    // 2) Пул ключей: related + suggestions + ключи 1-го конкурента.
    const related = await safe('getRelated', () => serpstat.getRelated(token, category, se, 100));
    const sugg = await safe('getSuggestions', () => serpstat.getSuggestions(token, category, se, 100));
    const firstUrl = urls[0];
    const urlKw = firstUrl ? await safe('getUrlKeywords', () => serpstat.getUrlKeywords(token, firstUrl, se, 100)) : null;
    const questions = await safe('getQuestions', () => serpstat.getQuestions(token, category, se, 300));
    faqSeeds = ((questions && questions.rows) || []).map((r) => r.keyword).slice(0, 20);

    group = mergeKeywords(
      [{ keyword: category, volume: (related && related.summary && related.summary.region_queries_count) || null }],
      (related && related.rows) || [],
      (sugg && sugg.rows) || [],
      (urlKw && urlKw.rows) || [],
    );
    diag.serpstat = {
      top: topRows.length, related: ((related && related.rows) || []).length,
      suggestions: ((sugg && sugg.rows) || []).length,
      urlKeywords: ((urlKw && urlKw.rows) || []).length, questions: faqSeeds.length,
    };
  }

  if (!group.length) throw new Error('пустой пул ключей — проверь категорию/ключ Serpstat');

  // 3) Краул страниц конкурентов.
  const pages = await crawl(urls);
  const okPages = pages.filter((p) => p.ok);
  diag.crawl = { requested: urls.length, ok: okPages.length, failed: urls.length - okPages.length,
    failedUrls: pages.filter((p) => !p.ok).map((p) => p.url) };

  // 4) Конвейер: ключи (set-cover + сигнал конкурентов), LSI, коллокации, структура, объём.
  const res = pipeline.run({
    pages, group, core: category,
    opts: { count, useVolume: true, dropNested: false },
  });
  const tz0 = res.tz || {};

  // 4.1) Чистка LSI от чужого языка: украинские конкуренты засоряют русский LSI
  // (и наоборот) — словарный фильтр (nspell), а не по буквам. Для EN не трогаем.
  let lsi = tz0.lsi || [];
  if ((lang === 'ru' || lang === 'uk') && lsi.length) {
    try {
      const { cleanForeign } = require(path.join(LIB, 'langfilter'));
      const r = cleanForeign(lsi.map((w) => ({ word: w })), { remove: lang === 'ru' ? 'uk' : 'ru', mode: 'soft' });
      diag.lsiDropped = r.removed.length;
      lsi = r.kept.map((e) => e.word);
    } catch (e) { diag.errors.push('langfilter: ' + String((e && e.message) || e)); }
  }

  // 5) Сборка tz для ecomprompt: частоты ключей из пула, объём — целевой збп/слова
  // (или переопределённый доп. пожеланием), доп. требования и схемы заказчика.
  const volByKw = new Map(group.map((g) => [norm(g.keyword), g.volume]));
  const keywords = (tz0.keywords || []).map((k) => ({ keyword: k.keyword, volume: volByKw.get(norm(k.keyword)) }));
  const tz = {
    pageType, lang,
    topic: category,
    mainKey: category,
    region,
    facts,
    keywords,
    core: coreLines(group),
    lsi,
    competitorPhrases: tz0.competitorPhrases || [],
    competitorHeadings: competitorHeadingsText(res.pagesMeta || []),
    volumeZbp: ovZbp || res.zbpTarget || '',
    requirements: { volume: ovWords || (res.volume && res.volume.words) || '' },
    extra,
    schemas,
    format: 'html',
  };
  const prompt = buildEcomPrompt(tz);

  diag.selectedKeys = keywords.map((k) => k.keyword);
  diag.zbpTarget = tz.volumeZbp;
  diag.wordsTarget = tz.requirements.volume;
  if (ovZbp || ovWords) diag.volumeOverride = { zbp: ovZbp || null, words: ovWords || null };
  if (extra) diag.extra = extra;
  if (schemas.length) diag.schemas = schemas;
  diag.lsiCount = tz.lsi.length;
  diag.phrasesCount = tz.competitorPhrases.length;
  diag.stages = res.stages;

  process.stdout.write(JSON.stringify({
    ok: true,
    prompt,
    brief: { mainKey: tz.mainKey, pageType, lang, volumeZbp: tz.volumeZbp,
      keywords: keywords.map((k) => k.keyword), lsi: tz.lsi },
    faqSeeds,
    diagnostics: diag,
  }, null, 2));
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2));
  process.exit(1);
});
