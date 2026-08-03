# Dependency audit

- Runtime baseline: Node.js >=22.12 in `.nvmrc`, package engines and CI.
- Electron 39.8.5, Playwright 1.55.1 and better-sqlite3 12.6.2 replace vulnerable or ABI-incompatible versions; no force audit fix was used.
- Packaging explicitly rebuilds native modules for Electron 39 ABI before electron-builder copies them into the app bundle.
- `npm audit` and `npm audit --omit=dev` against the official npm registry report zero vulnerabilities.
- `telegram`/GramJS 2.26.22 is archived upstream but remains pinned because authorization, sessions and GetHistory pagination depend on its API. Follow-up: evaluate a maintained API-compatible MTProto client in an isolated branch, gated by auth, pagination and read-only allowlist tests.
