# Конфиденциальность

На Mac остаются база сообщений, темы, результаты анализа, заметки, очередь и при разрешении пользователя media cache. В Telegram отправляются только стандартные read‑only MTProto‑запросы истории собственного чата «Избранное».

В RouterAI передаётся нормализованный текст конкретного сообщения, source metadata, доступные темы и минимально необходимые инструкции. Перед отправкой маскируются вероятные API‑ключи, токены, пароли и authorization headers. Исходный локальный текст не изменяется.

`api_hash`, RouterAI key и Telegram session шифруются через macOS Keychain‑backed Electron `safeStorage`. Коды входа и 2FA password не сохраняются. Экспорт и backup не содержат секреты. Телеметрия и аналитика отсутствуют.

Demo Mode использует отдельную SQLite-базу и не читает и не изменяет real-profile credentials, checkpoint или очередь. JSON/Markdown exports не содержат Telegram session, API credentials, RouterAI key или зашифрованный secret-файл.
