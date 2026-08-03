# Разработка

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

Main: `src/main`, preload: `src/preload`, renderer: `src/renderer`, общие Zod‑контракты: `src/shared`. Тесты используют временные SQLite‑базы и Telegram mocks; реальные ключи не нужны. Не добавляйте credentials в `.env` — приложение намеренно читает их только из защищённого мастера.
