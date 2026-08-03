# Настройка Telegram

1. Откройте [my.telegram.org](https://my.telegram.org) → API development tools.
2. Создайте приложение и скопируйте `api_id` и `api_hash`.
3. В SavedAtlas откройте **Настройки → Telegram → Настроить подключение**.
4. Введите номер, код из Telegram и при необходимости пароль двухэтапной проверки.

После успеха StringSession немедленно шифруется через `safeStorage`. SavedAtlas обращается только к `messages.GetHistory` для peer `me`; отправляющих/изменяющих методов в сервисе нет. При FloodWait приложение сохраняет checkpoint и показывает время ожидания.
