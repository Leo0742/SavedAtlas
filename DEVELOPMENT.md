# Разработка

```bash
npm ci
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm run package:mac
npm run test:e2e:packaged
```

Main: `src/main`, preload: `src/preload`, renderer: `src/renderer`, общие Zod‑контракты: `src/shared`. Тесты используют временные SQLite‑базы и mock services; реальные ключи не нужны. Packaged E2E требует предварительно выполненный `npm run package:mac` и запускает `.app` только с `SAVEDATLAS_E2E=1` в отдельном временном userData. Не добавляйте credentials в `.env`, fixtures, пути или логи.
