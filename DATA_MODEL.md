# Модель данных

Миграция создаёт `messages`, `categories`, `topics`, `message_topics`, `tags`, `message_tags`, `message_analysis`, `freshness_analysis`, `manual_overrides`, `user_notes`, `sync_state`, `analysis_jobs`, `usage_events`, `app_settings` и contentless FTS5 `messages_fts`.

Индексы покрывают дату, хэш, freshness status и очередь. SQLite работает в WAL‑режиме с foreign keys. Схема ограничивает иерархию до `Category → Topic`. Telegram session и API‑ключи не являются частью модели и хранятся отдельно, в зашифрованном `secrets.enc`.
