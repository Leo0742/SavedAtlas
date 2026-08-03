# Архитектура

SavedAtlas состоит из трёх изолированных частей. Electron main владеет SQLite, Telegram, RouterAI, файловой системой и `safeStorage`. Preload экспортирует только явный типизированный allowlist IPC. React renderer работает с `contextIsolation: true`, `nodeIntegration: false`, sandbox и строгой CSP.

Поток синхронизации: `GramJS GetHistory(peer: "me") → нормализация/хэш → SQLite transaction/checkpoint → очередь анализа → RouterAI → валидированный Zod результат → FTS5/UI`. Неизменившийся `contentHash` не отправляется на повторный анализ. Ручная тема помечается `user_overridden` и имеет приоритет.

RouterAI использует официальный OpenAI JS client с `baseURL=https://routerai.ru/api/v1`. Web search передаётся через `plugins: [{id:"web"}]`. Основной процесс блокирует произвольную навигацию, а внешние HTTPS‑ссылки открывает системным браузером.
