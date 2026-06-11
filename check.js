#!/usr/bin/env node
// Проверка сгенерированного текста по чек-листу документа — обёртка над чистым
// модулем ../../../src/lib/textcheck. Параметры берёт из brief-JSON (вывод
// collect.js, поле "brief"), текст — из файла.
//
//   node check.js --text out.html --brief brief.json
//   (brief.json = объект brief из collect, либо весь вывод collect — оба ок)

const fs = require('fs');
const path = require('path');
// Движок: репозиторий (../../../src/lib) или вендоренный ./lib в бандле.
function resolveLib() {
  const cands = [path.join(__dirname, 'lib'), path.join(__dirname, '..', '..', '..', 'src', 'lib')];
  for (const c of cands) { try { if (fs.existsSync(path.join(c, 'textcheck.js'))) return c; } catch (e) {} }
  return cands[1];
}
const textcheck = require(path.join(resolveLib(), 'textcheck'));

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { a[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv);
  if (!a.text || !a.brief) throw new Error('нужны --text <файл> и --brief <json>');
  const text = fs.readFileSync(a.text, 'utf8');
  let brief = JSON.parse(fs.readFileSync(a.brief, 'utf8'));
  if (brief.brief) brief = brief.brief; // приняли весь вывод collect — берём вложенный brief

  const res = textcheck.check({
    text,
    mainKey: brief.mainKey || '',
    keywords: brief.keywords || [],
    lsi: brief.lsi || [],
    volumeZbp: +brief.volumeZbp || 0,
    pageType: brief.pageType || 'category',
    lang: brief.lang || 'ru',
  });

  const icon = { ok: '✓', warn: '⚠', fail: '✗', info: '·', skip: '—' };
  const lines = [];
  lines.push(`Метрики: ${res.metrics.zbp} збп · ${res.metrics.words} слов · плотность ${res.metrics.density}% · тошнота/слово ${res.metrics.wordNausea}%` +
    (res.ruMetrics ? ` · академ. ≈${res.metrics.academic}% · вода ≈${res.metrics.stopShare}%` : ' · (тошнота/вода — не для EN)'));
  lines.push(`Итог: ✓ ${res.counts.ok || 0} · ⚠ ${res.counts.warn || 0} · ✗ ${res.counts.fail || 0}` +
    ((res.counts.skip || 0) ? ` · — ${res.counts.skip}` : ''));
  lines.push('');
  for (const c of res.checks) {
    lines.push(`${icon[c.status] || '·'} ${c.label}${c.details ? ' — ' + c.details : ''}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
  // ненулевой код, если есть фейлы — удобно для «переписать до чистоты»
  process.exit((res.counts.fail || 0) > 0 ? 2 : 0);
}

try { main(); } catch (e) { process.stderr.write(String((e && e.message) || e) + '\n'); process.exit(1); }
