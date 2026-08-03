# Corrective pass verification

Все проверки выполняются без реальных Telegram/RouterAI credentials. Packaged E2E использует только встроенные mock services и отдельный временный `userData`.

| Requirement | Evidence | Test |
|---|---|---|
| First run exits wizard after local import | `setup_complete` отделён от количества сообщений; wizard вызывает `completeSetup()` и `syncFull()` | RTL `finishes real-mode setup…`; packaged Playwright first-run |
| Full sync and resume | Checkpoint after every page, no page-count cap | 250 messages / 3 pages; interrupted DB reopen/resume |
| Incremental overlap | Latest known ID + configurable overlap across pages | 130 new messages, edited overlap, duplicate page, FloodWait |
| Persistent queue | Transactional jobs, dependencies, recovery, concurrency, retry/backoff | restart of a claimed running job and complete queue drain |
| Global search | SQLite FTS5, safe tokens, filters, pagination, virtual rows | record beyond first 50; punctuation; packaged search after 260 imports |
| FTS consistency | Central `reindexMessage` after import/classification/topic/tags/note/restore | classification, note, and manual-topic search assertions |
| Telegram metadata | Source type/peer/post/date/entities/media/album metadata and safe public URL | GramJS public-forward and hidden-author fixtures |
| RouterAI structure and annotations | JSON Schema + validation/repair/retries; API annotations stored separately | schema tests and realistic URL citation annotation fixture |
| Freshness cache and recheck | hash/model/prompt/expiry cache; manual recheck bypass | cache invalidation unit test; UI recheck IPC wiring |
| Packaged Electron | CommonJS sandbox preload, no console errors, 260 imported, jobs drained | `npm run test:e2e:packaged` |
| Responsive window | Root fills content at 900×650 through 1728×1117, maximize/fullscreen/restore | packaged matrix screenshots artifact |
| Profiles/export/topics | Isolated Demo Mode, complete export, topic/proposal lifecycle | release-candidate unit + packaged E2E |
| Dependency audit | Node >=22.12, updated Electron/Playwright | `npm audit` and `npm audit --omit=dev`: zero vulnerabilities |
| Security | no real credentials; secret store outside SQLite/export; redaction | redaction and credential-shaped export tests plus repository scan |

Local verification is not a claim that GitHub Actions passed. Check the pull request checks independently.
