# UI action inventory

| Screen | Control | Action | Test |
|---|---|---|---|
| Fatal | Copy diagnostics / Quit | Copies redacted details / closes app | preload packaged assertion |
| Wizard | Start / Demo / Back / Continue | Real setup or isolated demo | RTL + packaged |
| Wizard | Telegram API/auth/resend/code/2FA/cancel | Explicit MTProto auth state | unit + packaged |
| Wizard | RouterAI save/test | Configures and probes model | packaged |
| Wizard | Full sync/pause/resume/cancel/retry | Durable initial import | sync + packaged |
| Navigation | Home/library/queue/topics/freshness/review/without-topic/archive/settings | Opens matching query/view | RTL + packaged |
| Header | Search/clear/filters/reset/sync/menu/export/settings | Global FTS, filters, incremental sync, menu | RTL + packaged |
| Library | Open/load more/select shown/bulk move | Inspector, pagination, bulk topic assignment | database + packaged |
| Inspector | Close/copy/open source/topic/tags/note/recheck | Operates on selected material | unit + packaged |
| Inspector | Citation/alternative/hide/restore | Evidence links and local archive | unit + packaged |
| Topics | Category/topic create/edit/merge/archive/restore | Maintains two-level taxonomy | unit + packaged |
| Topics | Proposal accept/edit/existing/reject | Resolves visible AI proposals | packaged |
| Topics | Markdown export | Exports selected topic | packaged |
| Settings | Connections and immediate credential deletion | Reconfigures/clears live services | packaged |
| Settings | Sync/jobs/web/classification/topic thresholds | Persists operational settings | RTL control audit |
| Settings | Theme/density/export/reveal/reset | Applies preferences and local actions | packaged |
| Settings | Enter/reset/exit demo | Switches isolated profile | unit + packaged |

Card view, decorative row checkboxes, attachment Analyze controls, and media jobs are absent.
