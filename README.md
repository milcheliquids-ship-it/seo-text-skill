# seo-text — переносимый Claude-скил

Сгенерирован `scripts/build-skill.js` из движка seo-bundle.

## Установка
```bash
cp -r . ~/.claude/skills/seo-text
cd ~/.claude/skills/seo-text && npm install
```
Затем запусти Claude Code в любом проекте → `/seo-text`.

Подробности и шаги — в `SKILL.md`. Источник истины — репозиторий seo-bundle; после правок `src/lib` пересобери: `npm run build:skill`.
