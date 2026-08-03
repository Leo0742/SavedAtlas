# Упаковка macOS

```bash
npm run package:mac
```

Electron Builder создаёт arm64 DMG в `release/`. Сборка в этой среде unsigned: `identity: null`, notarization отключена. Для публикации добавьте Developer ID Application certificate, hardened runtime entitlements и переменные нотарификации согласно актуальной документации Apple; затем удалите `identity: null`.

Команда использует активный macOS SDK (`xcrun --show-sdk-path`) для libc++ headers во время native rebuild. Нужны Xcode Command Line Tools. После упаковки выполните `npm run test:e2e:packaged`: тест проверяет именно `.app`, preload IPC, mocked first run, импорт 260 сообщений, drain очереди и global FTS.

Application ID: `app.savedatlas.desktop`. База и encrypted secrets располагаются в `app.getPath("userData")`, логи — в стандартном Electron logs path.
