# seo-text — переносимый Claude-скил

Сгенерирован `scripts/build-skill.js` из движка seo-bundle.

## Установка
```bash
git clone https://github.com/milcheliquids-ship-it/seo-text-skill.git ~/.claude/skills/seo-text
cd ~/.claude/skills/seo-text && npm install
```
Затем запусти Claude Code в любом проекте → `/seo-text`.

## Обновление
Автообновления нет — скил это git-клон, обновляется вручную:
```bash
cd ~/.claude/skills/seo-text && git pull && npm install
```
`git pull` подтянет новую версию, `npm install` — обновит зависимости (если менялись). Перезапусти Claude Code, чтобы скил перечитался.

Подробности и шаги — в `SKILL.md`. Источник истины — репозиторий seo-bundle; после правок `src/lib` пересобери: `npm run build:skill`.
