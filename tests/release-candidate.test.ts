import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SavedAtlasDatabase, SCHEMA_VERSION, type ImportedMessage } from '../src/main/database'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const location = () => { const directory = mkdtempSync(join(tmpdir(), 'savedatlas-rc-')); directories.push(directory); return { directory, path: join(directory, 'savedatlas.sqlite') } }
const message = (id: number, text = `Release candidate record ${id}`): ImportedMessage => ({ telegramMessageId: id, date: new Date(1_700_000_000_000 + id * 1000).toISOString(), editDate: null, text, caption: '', mediaType: 'text', mediaMetadata: {}, sourceTitle: `Source ${id % 3}`, sourceUsername: null, sourcePublicUrl: null, rawJson: '{}' })

describe('release candidate invariants', () => {
  it('archives the exact incompatible prototype table shapes and starts with the canonical schema', () => {
    const target = location(); const old = new Database(target.path); old.pragma('journal_mode = WAL'); old.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE messages(id INTEGER PRIMARY KEY, telegram_message_id INTEGER NOT NULL UNIQUE, date TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', caption TEXT NOT NULL DEFAULT '', normalized_content TEXT NOT NULL, content_hash TEXT NOT NULL, analysis_state TEXT NOT NULL DEFAULT 'complete', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE sync_state(id INTEGER PRIMARY KEY CHECK(id=1), last_known_message_id INTEGER NOT NULL DEFAULT 0, last_sync_at TEXT, full_sync_complete INTEGER NOT NULL DEFAULT 0, current_offset INTEGER NOT NULL DEFAULT 0, sync_status TEXT NOT NULL DEFAULT 'idle', checkpoint_json TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE analysis_jobs(id INTEGER PRIMARY KEY, message_id INTEGER REFERENCES messages(id), job_type TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error_code TEXT, redacted_error_message TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, dependency_id INTEGER REFERENCES analysis_jobs(id));
      CREATE VIRTUAL TABLE messages_fts USING fts5(text,caption,source,summary,tags,notes,content='');
      INSERT INTO schema_migrations VALUES(1,datetime('now')); INSERT INTO sync_state(id) VALUES(1);
      INSERT INTO messages(telegram_message_id,date,text,caption,normalized_content,content_hash,created_at,updated_at) VALUES(1,datetime('now'),'prototype','','prototype','old',datetime('now'),datetime('now'));
    `); old.close()
    const db = new SavedAtlasDatabase(target.path)
    expect(db.getPrototypeBackupPath()).toMatch(/savedatlas-prototype-backup-\d+\.sqlite$/)
    expect(db.getState().dashboard.total).toBe(0)
    expect(db.importMessage(message(2, 'canonical searchable'))).toBe('added')
    expect(db.searchMessages({ query: 'canonical', limit: 10, offset: 0 }).total).toBe(1)
    const canonical = new Database(target.path, { readonly: true }); expect((canonical.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version).toBe(SCHEMA_VERSION); canonical.close(); db.close()
  })

  it('isolates Demo Mode from 450 real messages and exports every real message exactly once', () => {
    const target = location(); const db = new SavedAtlasDatabase(target.path)
    for (let id = 1; id <= 450; id += 1) db.importMessage(message(id))
    const categoryId = db.createCategory('Export category'); const topicId = db.createTopic(categoryId, 'Export topic'); db.changeTopic(db.getState().messages[0].id, topicId)
    const exported = db.exportData() as { messages: Array<{ id: number; telegram: { sourceType: string } }>; manualOverrides: Array<{ field: string }> }
    expect(exported.messages).toHaveLength(450); expect(new Set(exported.messages.map((item) => item.id)).size).toBe(450)
    expect(exported.messages.every((item) => item.telegram.sourceType === 'unknown')).toBe(true); expect(exported.manualOverrides.some((item) => item.field === 'primary_topic')).toBe(true)
    db.enterDemo(); expect(db.getState().dashboard.demoMode).toBe(true); expect(db.getState().dashboard.total).toBeGreaterThanOrEqual(20)
    db.resetDemo(); db.exitDemo(); expect(db.getState().dashboard.total).toBe(450); db.close()
  })

  it('searches beyond 1,000 records and supports hidden archive restore', () => {
    const target = location(); const db = new SavedAtlasDatabase(target.path)
    for (let id = 1; id <= 1_050; id += 1) db.importMessage(message(id, id === 1_025 ? 'needle beyond one thousand' : `ordinary ${id}`))
    const found = db.searchMessages({ query: 'needle', limit: 10, offset: 0 }); expect(found.total).toBe(1)
    db.hideMessage(found.items[0].id); expect(db.searchMessages({ query: 'needle', limit: 10, offset: 0 }).total).toBe(0)
    const archived = db.searchMessages({ query: 'needle', includeHidden: true, hiddenOnly: true, limit: 10, offset: 0 }); expect(archived.total).toBe(1)
    db.restoreMessage(archived.items[0].id); expect(db.searchMessages({ query: 'needle', limit: 10, offset: 0 }).total).toBe(1); db.close()
  })

  it('terminates impossible dependent work and keeps FTS reachable', () => {
    const target = location(); const db = new SavedAtlasDatabase(target.path); db.importMessage(message(1, 'local index survives'))
    const raw = (db as unknown as { db: Database.Database }).db
    const classification = raw.prepare("SELECT id FROM analysis_jobs WHERE job_type='classification'").get() as { id: number }
    raw.prepare("UPDATE analysis_jobs SET status='failed',completed_at=datetime('now') WHERE id=?").run(classification.id)
    raw.prepare("INSERT INTO analysis_jobs(message_id,job_type,content_hash,prompt_version,status,available_at,created_at,dependency_id) SELECT id,'freshness',content_hash,'freshness-test','pending',datetime('now'),datetime('now'),? FROM messages LIMIT 1").run(classification.id)
    db.claimJob()
    expect(raw.prepare("SELECT status FROM analysis_jobs WHERE job_type='freshness'").get()).toMatchObject({ status: 'cancelled' })
    expect(db.searchMessages({ query: 'survives', limit: 10, offset: 0 }).total).toBe(1); db.close()
  })

  it('contains only read-only Telegram history operations outside authorization', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/services/telegram.ts'), 'utf8')
    expect(source).toContain('Api.messages.GetHistory')
    expect(source).not.toMatch(/Api\.messages\.(Send|Edit|Delete|Forward|SendReaction|UpdatePinned|Toggle|Reorder|SetHistoryTTL)/)
    expect(source).not.toMatch(/\.sendMessage\(|\.editMessage\(|\.deleteMessages\(|\.forwardMessages\(/)
  })
})
