# Архитектура

SavedAtlas состоит из трёх изолированных частей. Electron main владеет SQLite, Telegram, RouterAI, файловой системой и `safeStorage`. Preload экспортирует только явный типизированный allowlist IPC. React renderer работает с `contextIsolation: true`, `nodeIntegration: false`, sandbox и строгой CSP.

Поток синхронизации: `GramJS GetHistory(peer: "me") → нормализация/хэш → SQLite transaction/checkpoint + durable jobs → JobRunner → RouterAI → validated/repaired result → FTS5/UI`. Full sync возобновляется с page checkpoint; incremental sync читает страницы новых сообщений и настраиваемый overlap. JobRunner восстанавливает `running` jobs после restart, соблюдает dependencies, concurrency, retry/backoff и permanent failure. Ручная тема помечается `user_overridden` и имеет приоритет.

RouterAI использует OpenAI-compatible JS client с `baseURL=https://routerai.ru/api/v1`. Web search передаётся через `plugins: [{id:"web"}]`. URL из model JSON считается подтверждённым только при совпадении с API annotation. Основной процесс блокирует произвольную навигацию, а внешние HTTPS‑ссылки открывает системным браузером.
