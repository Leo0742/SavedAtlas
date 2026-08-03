# Модель данных

Миграция создаёт `messages`, `categories`, `topics`, `message_topics`, `tags`, `message_tags`, `message_analysis`, `freshness_analysis`, `manual_overrides`, `user_notes`, `sync_state`, `analysis_jobs`, `router_attempts`, `usage_events`, `app_settings` и управляемый приложением FTS5 `messages_fts`.

`analysis_jobs` хранит content hash, prompt version, dependency, attempts, retry time и terminal status. FTS содержит текст, caption, source, summary, topic, category, tags и note и переиндексируется после каждого изменения этих полей. SQLite работает в WAL‑режиме с foreign keys. Telegram session и API‑ключи не являются частью модели и хранятся отдельно, в зашифрованном `secrets.enc`.
