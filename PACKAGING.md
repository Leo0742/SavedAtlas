# Упаковка macOS

```bash
npm run package:mac
```

Electron Builder создаёт arm64 DMG в `release/`. Сборка в этой среде unsigned: `identity: null`, notarization отключена. Для публикации добавьте Developer ID Application certificate, hardened runtime entitlements и переменные нотарификации согласно актуальной документации Apple; затем удалите `identity: null`.

Application ID: `app.savedatlas.desktop`. База и encrypted secrets располагаются в `app.getPath("userData")`, логи — в стандартном Electron logs path.
