import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  appStateSchema, settingsSchema, type AppState, type JobProgress, type SavedMessage,
  type SearchQuery, type SearchResult, type Settings, type SetupState
} from '../../shared/contracts'
import type { z } from 'zod'
import type { classificationResponseSchema, freshnessResponseSchema } from '../../shared/contracts'
import { contentHash, extractUrls, isFreshnessCacheValid, normalizeContent, normalizeTopicName } from '../services/content'
import { demoCategories, demoMessages, demoTopics } from './demo'

export type ImportedMessage = {
  telegramMessageId: number; date: string; editDate: string | null; originalPostDate?: string | null;
  text: string; caption: string; entities?: unknown[]; mediaType: string; mediaMetadata?: Record<string, unknown>;
  groupedId?: string | null; sourcePeerId?: string | null; sourceMessageId?: number | null; sourceTitle: string;
  sourceUsername: string | null; sourceType?: string; sourcePublicUrl: string | null; forwardingMetadata?: Record<string, unknown>;
  rawJson: string
}

export type JobType = 'classification' | 'freshness' | 'media' | 'fts'
export type AnalysisJob = {
  id: number; messageId: number; jobType: JobType; attempts: number; maxAttempts: number;
  contentHash: string; promptVersion: string; dependencyId: number | null
}

const defaultSettings: Settings = settingsSchema.parse({})
const nowIso = (): string => new Date().toISOString()

export class SavedAtlasDatabase {
  private readonly db: Database.Database
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, is_manual INTEGER NOT NULL DEFAULT 0, is_archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS topics (id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id), name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '', is_manual INTEGER NOT NULL DEFAULT 0, is_archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY, telegram_message_id INTEGER NOT NULL UNIQUE, telegram_peer_id TEXT NOT NULL DEFAULT 'self', date TEXT NOT NULL,
        edit_date TEXT, original_post_date TEXT, text TEXT NOT NULL DEFAULT '', caption TEXT NOT NULL DEFAULT '', normalized_content TEXT NOT NULL,
        entities_json TEXT NOT NULL DEFAULT '[]', urls_json TEXT NOT NULL DEFAULT '[]', media_type TEXT NOT NULL DEFAULT 'text',
        media_metadata_json TEXT NOT NULL DEFAULT '{}', local_media_path TEXT, grouped_id TEXT, source_peer_id TEXT, source_message_id INTEGER,
        source_title TEXT NOT NULL DEFAULT '', source_username TEXT, source_type TEXT NOT NULL DEFAULT 'unknown', source_public_url TEXT,
        forwarding_metadata_json TEXT NOT NULL DEFAULT '{}', content_hash TEXT NOT NULL, telegram_state TEXT NOT NULL DEFAULT 'present',
        analysis_state TEXT NOT NULL DEFAULT 'pending', raw_json TEXT NOT NULL DEFAULT '{}', duplicate_of INTEGER REFERENCES messages(id),
        hidden_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS message_topics (message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, topic_id INTEGER NOT NULL REFERENCES topics(id), is_primary INTEGER NOT NULL DEFAULT 1, confidence REAL NOT NULL DEFAULT 0, assigned_by TEXT NOT NULL DEFAULT 'ai', user_overridden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(message_id, topic_id));
      CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS message_tags (message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, tag_id INTEGER NOT NULL REFERENCES tags(id), assigned_by TEXT NOT NULL DEFAULT 'ai', confidence REAL NOT NULL DEFAULT 0.8, user_overridden INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(message_id, tag_id));
      CREATE TABLE IF NOT EXISTS message_analysis (message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, summary TEXT NOT NULL DEFAULT '', content_type TEXT NOT NULL DEFAULT 'unknown', keywords_json TEXT NOT NULL DEFAULT '[]', language TEXT NOT NULL DEFAULT 'ru', classification_confidence REAL NOT NULL DEFAULT 0, needs_review INTEGER NOT NULL DEFAULT 0, freshness_check_needed INTEGER NOT NULL DEFAULT 0, freshness_reason TEXT NOT NULL DEFAULT '', suggested_search_query TEXT, model_id TEXT NOT NULL DEFAULT 'demo', prompt_version TEXT NOT NULL DEFAULT '1', raw_validated_json TEXT NOT NULL DEFAULT '{}', analyzed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS freshness_analysis (message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'unchecked', verdict TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', confidence REAL NOT NULL DEFAULT 0, checked_at TEXT, expires_at TEXT, content_hash TEXT NOT NULL DEFAULT '', alternatives_json TEXT NOT NULL DEFAULT '[]', citations_json TEXT NOT NULL DEFAULT '[]', router_annotations_json TEXT NOT NULL DEFAULT '[]', model_id TEXT NOT NULL DEFAULT 'demo', prompt_version TEXT NOT NULL DEFAULT '1');
      CREATE TABLE IF NOT EXISTS manual_overrides (id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, field TEXT NOT NULL, previous_value_json TEXT NOT NULL, new_value_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_notes (message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY CHECK(id=1), last_known_message_id INTEGER NOT NULL DEFAULT 0, last_sync_at TEXT, full_sync_complete INTEGER NOT NULL DEFAULT 0, current_offset INTEGER NOT NULL DEFAULT 0, sync_status TEXT NOT NULL DEFAULT 'idle', sync_mode TEXT, checkpoint_json TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS analysis_jobs (
        id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, job_type TEXT NOT NULL,
        content_hash TEXT NOT NULL, prompt_version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 4, available_at TEXT NOT NULL, error_code TEXT, redacted_error_message TEXT,
        created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, dependency_id INTEGER REFERENCES analysis_jobs(id),
        UNIQUE(message_id, job_type, content_hash, prompt_version)
      );
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_events (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS router_attempts (id INTEGER PRIMARY KEY, message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE, operation TEXT NOT NULL, attempt INTEGER NOT NULL, outcome TEXT NOT NULL, error_code TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date DESC); CREATE INDEX IF NOT EXISTS idx_messages_hash ON messages(content_hash);
      CREATE INDEX IF NOT EXISTS idx_freshness_status ON freshness_analysis(status); CREATE INDEX IF NOT EXISTS idx_jobs_ready ON analysis_jobs(status, available_at, created_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, caption, source, summary, topic, category, tags, notes);
      INSERT OR IGNORE INTO sync_state(id) VALUES(1);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(2, datetime('now'));
    `)
    this.ensureColumn('messages', 'original_post_date', 'TEXT')
    this.ensureColumn('messages', 'forwarding_metadata_json', "TEXT NOT NULL DEFAULT '{}'")
    this.ensureColumn('messages', 'hidden_at', 'TEXT')
    this.ensureColumn('freshness_analysis', 'content_hash', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn('sync_state', 'sync_mode', 'TEXT')
    const ftsSql = (this.db.prepare("SELECT sql FROM sqlite_master WHERE name='messages_fts'").get() as { sql: string } | undefined)?.sql ?? ''
    if (/content\s*=\s*''/i.test(ftsSql)) this.db.exec('DROP TABLE messages_fts; CREATE VIRTUAL TABLE messages_fts USING fts5(text, caption, source, summary, topic, category, tags, notes);')
    this.recoverJobs()
    for (const [key, value] of Object.entries(defaultSettings)) this.setSettingDefault(key, value)
    this.setSettingDefault('setup_complete', false)
    this.setSettingDefault('telegram_authorized', false)
    this.setSettingDefault('router_tested', false)
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (!columns.some((entry) => entry.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }

  private setSettingDefault(key: string, value: unknown): void {
    this.db.prepare('INSERT OR IGNORE INTO app_settings(key,value) VALUES(?,?)').run(key, JSON.stringify(value))
  }
  private setting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as { value: string } | undefined
    if (!row) return fallback
    try { return JSON.parse(row.value) as T } catch { return fallback }
  }
  private putSetting(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value))
  }

  getSettings(): Settings {
    return settingsSchema.parse(Object.fromEntries(Object.entries(defaultSettings).map(([key, fallback]) => [key, this.setting(key, fallback)])))
  }
  saveSettings(input: unknown): Settings {
    const value = settingsSchema.parse(input)
    const transaction = this.db.transaction(() => { for (const [key, item] of Object.entries(value)) this.putSetting(key, item) })
    transaction(); return value
  }
  setAnalysisModels(classificationModel: string, freshnessModel: string): void { this.putSetting('classification_model', classificationModel); this.putSetting('freshness_model', freshnessModel) }
  getSetupState(): SetupState {
    const telegramAuthorized = this.setting('telegram_authorized', false); const routerConfigured = this.setting('router_configured', false); const demo = this.setting('demo_mode', false)
    return { complete: demo || (this.setting('setup_complete', false) && telegramAuthorized && routerConfigured), telegramAuthorized, routerConfigured }
  }
  completeSetup(): void { this.putSetting('setup_complete', true) }
  setConnectionState(patch: { telegramConfigured?: boolean; telegramAuthorized?: boolean; routerConfigured?: boolean; routerTested?: boolean }): void {
    for (const [key, value] of Object.entries(patch)) if (value !== undefined) this.putSetting(key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`), value)
  }

  seedDemo(): void {
    const now = nowIso()
    const tx = this.db.transaction(() => {
      this.clearUserData()
      const cat = this.db.prepare('INSERT INTO categories(name,normalized_name,description,icon,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      demoCategories.forEach((c, index) => cat.run(c[0], c[0].toLocaleLowerCase('ru-RU'), c[1], c[2], index, now, now))
      const topic = this.db.prepare('INSERT INTO topics(category_id,name,normalized_name,description,icon,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      demoTopics.forEach((t) => topic.run(t[0], t[1], t[1].toLocaleLowerCase('ru-RU'), t[2], t[3], now, now))
      for (const [index, m] of demoMessages.entries()) {
        const imported = this.importMessage({ telegramMessageId: 5000 - index, date: new Date(Date.now() - index * 86400000).toISOString(), editDate: null, text: m.text, caption: '', mediaType: m.media ?? 'text', sourceTitle: m.source, sourceUsername: null, sourceType: m.source.includes('Приват') ? 'private_channel' : 'channel', sourcePublicUrl: null, rawJson: '{}' })
        if (imported === 'unchanged') continue
        const row = this.db.prepare('SELECT id FROM messages WHERE telegram_message_id=?').get(5000 - index) as { id: number }
        const result = { message_id: row.id, summary: `${m.title}. ${m.text.slice(0, 110)}`, content_type: m.media ?? 'article', category: { existing_id: 1, proposed_name: null, confidence: .9 }, primary_topic: { existing_id: m.topic, proposed_name: null, proposed_description: null, confidence: m.review ? .58 : .9 }, tags: m.tags, language: 'ru', freshness_check_needed: m.status !== 'evergreen', freshness_reason: m.reason, suggested_search_query: null, needs_review: Boolean(m.review) }
        this.applyClassification(row.id, result, { forceTopic: true })
      }
      this.db.prepare("UPDATE analysis_jobs SET status='complete',completed_at=?").run(now)
      this.db.prepare("UPDATE sync_state SET last_known_message_id=5000,last_sync_at=?,full_sync_complete=1,sync_status='idle',current_offset=0,checkpoint_json='{}' WHERE id=1").run(now)
      this.putSetting('demo_mode', true); this.putSetting('setup_complete', true)
    })
    tx()
  }

  getState(): AppState {
    const counts = this.db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN date>=datetime('now','-7 day') THEN 1 ELSE 0 END) new_count,
      SUM(CASE WHEN analysis_state IN ('pending','running') THEN 1 ELSE 0 END) unprocessed,
      SUM(CASE WHEN analysis_state IN ('review','failed') OR COALESCE(a.needs_review,0)=1 THEN 1 ELSE 0 END) review,
      SUM(CASE WHEN f.status='current' THEN 1 ELSE 0 END) current_count,
      SUM(CASE WHEN f.status='outdated' THEN 1 ELSE 0 END) outdated,
      SUM(CASE WHEN f.status IS NULL OR f.status='unchecked' THEN 1 ELSE 0 END) unchecked
      FROM messages m LEFT JOIN freshness_analysis f ON f.message_id=m.id LEFT JOIN message_analysis a ON a.message_id=m.id WHERE m.hidden_at IS NULL`).get() as Record<string, number>
    const topicCount = (this.db.prepare('SELECT COUNT(*) value FROM topics WHERE is_archived=0').get() as { value: number }).value
    const sync = this.db.prepare('SELECT last_sync_at FROM sync_state WHERE id=1').get() as { last_sync_at: string | null }
    const setup = this.getSetupState()
    return appStateSchema.parse({
      dashboard: { total: counts.total ?? 0, topics: topicCount, newCount: counts.new_count ?? 0, current: counts.current_count ?? 0,
        unprocessed: counts.unprocessed ?? 0, outdated: counts.outdated ?? 0, unchecked: counts.unchecked ?? 0, review: counts.review ?? 0,
        lastSyncAt: sync.last_sync_at, telegramConfigured: this.setting('telegram_configured', false), telegramAuthorized: setup.telegramAuthorized,
        routerConfigured: setup.routerConfigured, routerTested: this.setting('router_tested', false), demoMode: this.setting('demo_mode', false) },
      setup, messages: this.searchMessages({ limit: 50, offset: 0 }).items, topics: this.getTopics()
    })
  }

  private ftsQuery(value: string): string | null {
    const tokens = value.normalize('NFKC').match(/[\p{L}\p{N}_]+/gu)?.slice(0, 24) ?? []
    return tokens.length ? tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(' AND ') : null
  }

  search(input: SearchQuery): SavedMessage[] { return this.searchMessages(input).items }
  searchMessages(input: SearchQuery): SearchResult {
    const value = { ...input, limit: input.limit ?? 50, offset: input.offset ?? 0 }
    const params: unknown[] = []; const clauses = ['m.hidden_at IS NULL']; let from = 'messages m'
    const fts = value.query?.trim() ? this.ftsQuery(value.query) : null
    if (fts) { from += ' JOIN messages_fts x ON x.rowid=m.id'; clauses.push('messages_fts MATCH ?'); params.push(fts) }
    if (value.status) { clauses.push("COALESCE(f.status,'unchecked')=?"); params.push(value.status) }
    if (value.topicId) { clauses.push('mt.topic_id=?'); params.push(value.topicId) }
    if (value.withoutTopic) clauses.push('mt.topic_id IS NULL')
    if (value.analysisState) { clauses.push('m.analysis_state=?'); params.push(value.analysisState) }
    if (value.source) { clauses.push('m.source_title=?'); params.push(value.source) }
    if (value.mediaType) { clauses.push('m.media_type=?'); params.push(value.mediaType) }
    const joins = `${from} LEFT JOIN message_analysis a ON a.message_id=m.id LEFT JOIN freshness_analysis f ON f.message_id=m.id LEFT JOIN message_topics mt ON mt.message_id=m.id AND mt.is_primary=1 LEFT JOIN topics t ON t.id=mt.topic_id LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN user_notes n ON n.message_id=m.id`
    const where = `WHERE ${clauses.join(' AND ')}`
    const total = (this.db.prepare(`SELECT COUNT(DISTINCT m.id) value FROM ${joins} ${where}`).get(...params) as { value: number }).value
    const rows = this.db.prepare(`SELECT m.*,a.summary,a.needs_review,f.status freshness_status,f.verdict,f.reason freshness_reason,f.confidence freshness_confidence,f.citations_json,f.alternatives_json,t.id topic_id,t.name topic_name,c.name category_name,mt.user_overridden,COALESCE(n.note,'') user_note FROM ${joins} ${where} ORDER BY m.date DESC,m.id DESC LIMIT ? OFFSET ?`).all(...params, value.limit, value.offset) as Record<string, unknown>[]
    const items = rows.map((row) => this.mapMessage(row))
    const nextOffset = value.offset + items.length < total ? value.offset + items.length : null
    return { items, total, nextOffset }
  }

  private mapMessage(r: Record<string, unknown>): SavedMessage {
    const tags = this.db.prepare('SELECT t.name FROM message_tags mt JOIN tags t ON t.id=mt.tag_id WHERE mt.message_id=? ORDER BY t.name').all(r.id) as Array<{ name: string }>
    const citations = this.jsonArray(r.citations_json).map((item) => ({ ...(item as object), verified: Boolean((item as { verified?: boolean }).verified) }))
    const alternatives = this.jsonArray(r.alternatives_json).map((item) => ({ ...(item as object), supportingSource: (item as { supportingSource?: unknown }).supportingSource ?? null }))
    return {
      id: Number(r.id), telegramMessageId: Number(r.telegram_message_id), date: String(r.date), editDate: r.edit_date ? String(r.edit_date) : null,
      originalPostDate: r.original_post_date ? String(r.original_post_date) : null, text: String(r.text ?? ''), caption: String(r.caption ?? ''),
      sourceTitle: String(r.source_title ?? ''), sourceUsername: r.source_username ? String(r.source_username) : null,
      sourcePublicUrl: r.source_public_url ? String(r.source_public_url) : null, sourceType: String(r.source_type ?? 'unknown'),
      mediaType: String(r.media_type ?? 'text'), mediaMetadata: this.jsonObject(r.media_metadata_json), contentHash: String(r.content_hash),
      summary: String(r.summary ?? ''), topicId: r.topic_id == null ? null : Number(r.topic_id), topicName: r.topic_name ? String(r.topic_name) : null,
      categoryName: r.category_name ? String(r.category_name) : null, tags: tags.map((tag) => tag.name),
      freshnessStatus: (r.freshness_status ?? 'unchecked') as SavedMessage['freshnessStatus'], freshnessVerdict: String(r.verdict ?? ''),
      freshnessReason: String(r.freshness_reason ?? ''), freshnessConfidence: Number(r.freshness_confidence ?? 0),
      citations: citations as SavedMessage['citations'], alternatives: alternatives as SavedMessage['alternatives'],
      analysisState: String(r.analysis_state), userNote: String(r.user_note ?? ''), isManual: Boolean(r.user_overridden)
    }
  }
  private jsonArray(value: unknown): unknown[] { try { const parsed = JSON.parse(String(value ?? '[]')); return Array.isArray(parsed) ? parsed : [] } catch { return [] } }
  private jsonObject(value: unknown): Record<string, unknown> { try { const parsed = JSON.parse(String(value ?? '{}')); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} } catch { return {} } }

  getTopics(): AppState['topics'] {
    const rows = this.db.prepare(`SELECT t.id,t.category_id categoryId,c.name categoryName,t.name,t.description,t.icon,COUNT(mt.message_id) messageCount,SUM(CASE WHEN m.date>=datetime('now','-7 day') THEN 1 ELSE 0 END) newCount,SUM(CASE WHEN f.status='outdated' THEN 1 ELSE 0 END) outdatedCount FROM topics t JOIN categories c ON c.id=t.category_id LEFT JOIN message_topics mt ON mt.topic_id=t.id LEFT JOIN messages m ON m.id=mt.message_id AND m.hidden_at IS NULL LEFT JOIN freshness_analysis f ON f.message_id=m.id WHERE t.is_archived=0 GROUP BY t.id ORDER BY c.sort_order,t.name`).all() as Record<string, unknown>[]
    return rows.map((row) => ({ ...row, messageCount: Number(row.messageCount ?? 0), newCount: Number(row.newCount ?? 0), outdatedCount: Number(row.outdatedCount ?? 0) })) as AppState['topics']
  }

  changeTopic(messageId: number, topicId: number): void {
    const now = nowIso(); const previous = this.db.prepare('SELECT topic_id FROM message_topics WHERE message_id=? AND is_primary=1').get(messageId) as { topic_id: number } | undefined
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM message_topics WHERE message_id=? AND is_primary=1').run(messageId)
      this.db.prepare("INSERT INTO message_topics(message_id,topic_id,is_primary,confidence,assigned_by,user_overridden,created_at,updated_at) VALUES(?,?,1,1,'user',1,?,?)").run(messageId, topicId, now, now)
      this.db.prepare('INSERT INTO manual_overrides(message_id,field,previous_value_json,new_value_json,created_at) VALUES(?,?,?,?,?)').run(messageId, 'primary_topic', JSON.stringify(previous?.topic_id ?? null), JSON.stringify(topicId), now)
      this.reindexMessage(messageId)
    })()
  }
  saveNote(messageId: number, note: string): void {
    this.db.prepare('INSERT INTO user_notes(message_id,note,updated_at) VALUES(?,?,?) ON CONFLICT(message_id) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at').run(messageId, note, nowIso())
    this.reindexMessage(messageId)
  }
  hideMessage(messageId: number): void { this.db.prepare('UPDATE messages SET hidden_at=?,updated_at=? WHERE id=?').run(nowIso(), nowIso(), messageId); this.db.prepare('DELETE FROM messages_fts WHERE rowid=?').run(messageId) }

  importMessage(message: ImportedMessage): 'added' | 'updated' | 'unchanged' {
    const normalized = normalizeContent(message.text, message.caption); const hash = contentHash(normalized || `${message.telegramMessageId}:${message.mediaType}`); const now = nowIso()
    const existing = this.db.prepare('SELECT id,content_hash FROM messages WHERE telegram_message_id=?').get(message.telegramMessageId) as { id: number; content_hash: string } | undefined
    if (existing?.content_hash === hash) return 'unchanged'
    const tx = this.db.transaction(() => {
      let id: number
      const values = [message.date, message.editDate, message.originalPostDate ?? null, message.text, message.caption, normalized, JSON.stringify(message.entities ?? []), JSON.stringify(extractUrls(normalized)), message.mediaType, JSON.stringify(message.mediaMetadata ?? {}), message.groupedId ?? null, message.sourcePeerId ?? null, message.sourceMessageId ?? null, message.sourceTitle, message.sourceUsername, message.sourceType ?? 'unknown', message.sourcePublicUrl, JSON.stringify(message.forwardingMetadata ?? {}), hash, message.rawJson, now]
      if (existing) {
        id = existing.id
        this.db.prepare("UPDATE messages SET date=?,edit_date=?,original_post_date=?,text=?,caption=?,normalized_content=?,entities_json=?,urls_json=?,media_type=?,media_metadata_json=?,grouped_id=?,source_peer_id=?,source_message_id=?,source_title=?,source_username=?,source_type=?,source_public_url=?,forwarding_metadata_json=?,content_hash=?,raw_json=?,analysis_state='pending',updated_at=?,hidden_at=NULL WHERE id=?").run(...values, id)
        this.db.prepare("UPDATE analysis_jobs SET status='cancelled',completed_at=? WHERE message_id=? AND status IN ('pending','retry','running')").run(now, id)
      } else {
        const result = this.db.prepare("INSERT INTO messages(date,edit_date,original_post_date,text,caption,normalized_content,entities_json,urls_json,media_type,media_metadata_json,grouped_id,source_peer_id,source_message_id,source_title,source_username,source_type,source_public_url,forwarding_metadata_json,content_hash,raw_json,updated_at,telegram_message_id,analysis_state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)").run(...values, message.telegramMessageId, now)
        id = Number(result.lastInsertRowid)
      }
      const settings = this.getSettings(); const classificationId = settings.analyzeText ? this.enqueueJob(id, 'classification', hash, 'classification-v2') : null
      if (!settings.analyzeText) this.db.prepare("UPDATE messages SET analysis_state='complete' WHERE id=?").run(id)
      this.enqueueJob(id, 'fts', hash, 'fts-v2', classificationId)
      if (settings.analyzeMedia && message.mediaType !== 'text') this.enqueueJob(id, 'media', hash, 'media-v1')
      this.reindexMessage(id)
    })
    tx(); return existing ? 'updated' : 'added'
  }

  private enqueueJob(messageId: number, jobType: JobType, hash: string, promptVersion: string, dependencyId: number | null = null): number {
    const now = nowIso()
    this.db.prepare("INSERT OR IGNORE INTO analysis_jobs(message_id,job_type,content_hash,prompt_version,status,available_at,created_at,dependency_id) VALUES(?,?,?,?, 'pending',?,?,?)").run(messageId, jobType, hash, promptVersion, now, now, dependencyId)
    const row = this.db.prepare('SELECT id FROM analysis_jobs WHERE message_id=? AND job_type=? AND content_hash=? AND prompt_version=?').get(messageId, jobType, hash, promptVersion) as { id: number }
    return row.id
  }
  scheduleFreshness(messageId: number, classificationJobId: number | null = null, manual = false): number | null {
    const row = this.db.prepare('SELECT content_hash FROM messages WHERE id=?').get(messageId) as { content_hash: string } | undefined
    if (!row) return null
    const model = this.setting('freshness_model', 'openai/gpt-4o-mini'); const prompt = 'freshness-v2'
    if (!manual) {
      const cache = this.db.prepare('SELECT checked_at checkedAt,expires_at expiresAt,content_hash contentHash,model_id modelId,prompt_version promptVersion FROM freshness_analysis WHERE message_id=?').get(messageId) as Parameters<typeof isFreshnessCacheValid>[0] | undefined
      if (cache && isFreshnessCacheValid(cache, { contentHash: row.content_hash, modelId: model, promptVersion: prompt })) return null
    }
    if (manual) this.db.prepare("UPDATE analysis_jobs SET status='cancelled',completed_at=? WHERE message_id=? AND job_type='freshness' AND status IN ('pending','retry','running')").run(nowIso(), messageId)
    return this.enqueueJob(messageId, 'freshness', row.content_hash, manual ? `${prompt}:${Date.now()}` : prompt, classificationJobId)
  }

  getTaxonomy(): { categories: Array<{ id: number; name: string; description: string }>; topics: Array<{ id: number; categoryId: number; name: string; description: string }> } {
    return { categories: this.db.prepare('SELECT id,name,description FROM categories WHERE is_archived=0').all() as never[], topics: this.db.prepare('SELECT id,category_id categoryId,name,description FROM topics WHERE is_archived=0').all() as never[] }
  }
  getMessageForAnalysis(messageId: number): { id: number; content: string; source: string; date: string; contentHash: string } | null {
    const row = this.db.prepare('SELECT id,normalized_content content,source_title source,date,content_hash contentHash FROM messages WHERE id=?').get(messageId)
    return (row as ReturnType<SavedAtlasDatabase['getMessageForAnalysis']>) ?? null
  }
  getFreshnessInput(messageId: number): { content: string; query: string } | null {
    const row = this.db.prepare("SELECT m.normalized_content content,COALESCE(a.suggested_search_query,a.freshness_reason,'') query FROM messages m LEFT JOIN message_analysis a ON a.message_id=m.id WHERE m.id=?").get(messageId) as { content: string; query: string } | undefined
    return row && row.query ? row : null
  }

  private similarTopic(name: string): number | null {
    const target = new Set(normalizeTopicName(name).split(' ').filter(Boolean)); if (!target.size) return null
    const rows = this.db.prepare('SELECT id,normalized_name FROM topics WHERE is_archived=0').all() as Array<{ id: number; normalized_name: string }>
    let best: { id: number; score: number } | null = null
    for (const row of rows) { const candidate = new Set(row.normalized_name.split(' ').filter(Boolean)); const intersection = [...target].filter((token) => candidate.has(token)).length; const union = new Set([...target, ...candidate]).size; const score = union ? intersection / union : 0; if (!best || score > best.score) best = { id: row.id, score } }
    return best && best.score >= .72 ? best.id : null
  }

  applyClassification(messageId: number, result: z.infer<typeof classificationResponseSchema>, options: { forceTopic?: boolean; classificationJobId?: number } = {}): { needsReview: boolean; topicCreated: boolean; freshnessJobId: number | null } {
    const now = nowIso(); const settings = this.getSettings(); let topicId = result.primary_topic.existing_id ?? 0; let topicCreated = false
    if (topicId && !this.db.prepare('SELECT 1 FROM topics WHERE id=? AND is_archived=0').get(topicId)) topicId = 0
    const canCreate = options.forceTopic || (settings.automaticTopics && !result.needs_review && result.primary_topic.confidence >= settings.topicConfidenceThreshold)
    if (!topicId && result.primary_topic.proposed_name) topicId = this.similarTopic(result.primary_topic.proposed_name) ?? 0
    if (!topicId && result.primary_topic.proposed_name && canCreate) {
      let categoryId = result.category.existing_id ?? 0
      if (!categoryId || !this.db.prepare('SELECT 1 FROM categories WHERE id=?').get(categoryId)) {
        const categoryName = result.category.proposed_name || 'Разное'; const normalized = normalizeTopicName(categoryName)
        const found = this.db.prepare('SELECT id FROM categories WHERE normalized_name=?').get(normalized) as { id: number } | undefined
        categoryId = found?.id ?? Number(this.db.prepare("INSERT INTO categories(name,normalized_name,description,icon,sort_order,created_at,updated_at) VALUES(?,?,?,'folder',99,?,?)").run(categoryName, normalized, 'Категория предложена анализом', now, now).lastInsertRowid)
      }
      topicId = Number(this.db.prepare("INSERT INTO topics(category_id,name,normalized_name,description,icon,created_at,updated_at) VALUES(?,?,?,?, 'sparkles',?,?)").run(categoryId, result.primary_topic.proposed_name, normalizeTopicName(result.primary_topic.proposed_name), result.primary_topic.proposed_description ?? '', now, now).lastInsertRowid)
      topicCreated = true
    }
    const needsReview = result.needs_review || (!topicId && Boolean(result.primary_topic.proposed_name))
    let freshnessJobId: number | null = null
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO message_analysis(message_id,summary,content_type,keywords_json,language,classification_confidence,needs_review,freshness_check_needed,freshness_reason,suggested_search_query,model_id,prompt_version,raw_validated_json,analyzed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(message_id) DO UPDATE SET summary=excluded.summary,content_type=excluded.content_type,keywords_json=excluded.keywords_json,language=excluded.language,classification_confidence=excluded.classification_confidence,needs_review=excluded.needs_review,freshness_check_needed=excluded.freshness_check_needed,freshness_reason=excluded.freshness_reason,suggested_search_query=excluded.suggested_search_query,model_id=excluded.model_id,prompt_version=excluded.prompt_version,raw_validated_json=excluded.raw_validated_json,analyzed_at=excluded.analyzed_at`).run(messageId, result.summary, result.content_type, JSON.stringify(result.tags), result.language, result.primary_topic.confidence, needsReview ? 1 : 0, result.freshness_check_needed ? 1 : 0, result.freshness_reason, result.suggested_search_query, 'routerai', 'classification-v2', JSON.stringify(result), now)
      const manual = this.db.prepare('SELECT 1 FROM message_topics WHERE message_id=? AND is_primary=1 AND user_overridden=1').get(messageId)
      if (!manual && topicId) { this.db.prepare('DELETE FROM message_topics WHERE message_id=? AND is_primary=1').run(messageId); this.db.prepare("INSERT INTO message_topics(message_id,topic_id,is_primary,confidence,assigned_by,user_overridden,created_at,updated_at) VALUES(?,?,1,?,'ai',0,?,?)").run(messageId, topicId, result.primary_topic.confidence, now, now) }
      this.db.prepare("DELETE FROM message_tags WHERE message_id=? AND assigned_by='ai'").run(messageId)
      for (const name of result.tags) { const normalized = normalizeTopicName(name); this.db.prepare('INSERT OR IGNORE INTO tags(name,normalized_name,created_at) VALUES(?,?,?)').run(name, normalized, now); const tag = this.db.prepare('SELECT id FROM tags WHERE normalized_name=?').get(normalized) as { id: number }; this.db.prepare("INSERT OR REPLACE INTO message_tags(message_id,tag_id,assigned_by,confidence,user_overridden) VALUES(?,?,'ai',0.8,0)").run(messageId, tag.id) }
      this.db.prepare('UPDATE messages SET analysis_state=?,updated_at=? WHERE id=?').run(needsReview ? 'review' : 'complete', now, messageId)
      if (result.freshness_check_needed && result.suggested_search_query && settings.webSearch) freshnessJobId = this.scheduleFreshness(messageId, options.classificationJobId ?? null)
      this.reindexMessage(messageId)
    })()
    return { needsReview, topicCreated, freshnessJobId }
  }

  applyFreshness(messageId: number, result: z.infer<typeof freshnessResponseSchema>, annotations: Array<{ title: string; url: string }> = []): void {
    const message = this.db.prepare('SELECT content_hash FROM messages WHERE id=?').get(messageId) as { content_hash: string }
    const annotationUrls = new Set(annotations.map((item) => item.url))
    const citations = result.citations.map((citation) => ({ ...citation, verified: annotationUrls.has(citation.url) }))
    const alternatives = result.alternatives.map((alternative) => {
      const source = citations.find((citation) => citation.verified && (citation.url === alternative.supporting_source_url || citation.url === alternative.url)) ?? null
      return { name: alternative.name, why: alternative.why, url: alternative.url, limitations: alternative.limitations, supportingSource: source }
    })
    const checked = new Date(result.checked_at); const expires = new Date(checked.getTime() + result.recommended_recheck_days * 86400000)
    this.db.prepare(`INSERT INTO freshness_analysis(message_id,status,verdict,reason,confidence,checked_at,expires_at,content_hash,alternatives_json,citations_json,router_annotations_json,model_id,prompt_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(message_id) DO UPDATE SET status=excluded.status,verdict=excluded.verdict,reason=excluded.reason,confidence=excluded.confidence,checked_at=excluded.checked_at,expires_at=excluded.expires_at,content_hash=excluded.content_hash,alternatives_json=excluded.alternatives_json,citations_json=excluded.citations_json,router_annotations_json=excluded.router_annotations_json,model_id=excluded.model_id,prompt_version=excluded.prompt_version`).run(messageId, result.status, result.verdict, result.reason, result.confidence, result.checked_at, expires.toISOString(), message.content_hash, JSON.stringify(alternatives), JSON.stringify(citations), JSON.stringify(annotations), this.setting('freshness_model', 'openai/gpt-4o-mini'), 'freshness-v2')
  }

  reindexMessage(messageId: number): void {
    const row = this.db.prepare(`SELECT m.text,m.caption,m.source_title source,COALESCE(a.summary,'') summary,COALESCE(t.name,'') topic,COALESCE(c.name,'') category,COALESCE(GROUP_CONCAT(DISTINCT tag.name),'') tags,COALESCE(n.note,'') notes FROM messages m LEFT JOIN message_analysis a ON a.message_id=m.id LEFT JOIN message_topics mt ON mt.message_id=m.id AND mt.is_primary=1 LEFT JOIN topics t ON t.id=mt.topic_id LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN message_tags mtag ON mtag.message_id=m.id LEFT JOIN tags tag ON tag.id=mtag.tag_id LEFT JOIN user_notes n ON n.message_id=m.id WHERE m.id=? AND m.hidden_at IS NULL GROUP BY m.id`).get(messageId) as Record<string, string> | undefined
    this.db.prepare('DELETE FROM messages_fts WHERE rowid=?').run(messageId)
    if (row) this.db.prepare('INSERT INTO messages_fts(rowid,text,caption,source,summary,topic,category,tags,notes) VALUES(?,?,?,?,?,?,?,?,?)').run(messageId, row.text, row.caption, row.source, row.summary, row.topic, row.category, row.tags, row.notes)
  }

  claimJob(): AnalysisJob | null {
    const job = this.db.prepare(`SELECT j.id,j.message_id messageId,j.job_type jobType,j.attempts,j.max_attempts maxAttempts,j.content_hash contentHash,j.prompt_version promptVersion,j.dependency_id dependencyId FROM analysis_jobs j LEFT JOIN analysis_jobs d ON d.id=j.dependency_id WHERE j.status IN ('pending','retry') AND j.available_at<=? AND (j.dependency_id IS NULL OR d.status='complete') ORDER BY j.created_at,j.id LIMIT 1`).get(nowIso()) as AnalysisJob | undefined
    if (!job) return null
    const changed = this.db.prepare("UPDATE analysis_jobs SET status='running',started_at=?,attempts=attempts+1 WHERE id=? AND status IN ('pending','retry')").run(nowIso(), job.id).changes
    if (!changed) return null
    this.db.prepare("UPDATE messages SET analysis_state='running' WHERE id=? AND analysis_state='pending'").run(job.messageId)
    return { ...job, attempts: job.attempts + 1 }
  }
  completeJob(jobId: number): void { this.db.prepare("UPDATE analysis_jobs SET status='complete',completed_at=?,error_code=NULL,redacted_error_message=NULL WHERE id=?").run(nowIso(), jobId) }
  failJob(job: AnalysisJob, errorCode: string, redactedMessage: string, temporary: boolean): void {
    const retry = temporary && job.attempts < job.maxAttempts
    const delay = Math.min(300, 2 ** Math.max(0, job.attempts - 1))
    this.db.prepare('UPDATE analysis_jobs SET status=?,available_at=?,completed_at=?,error_code=?,redacted_error_message=? WHERE id=?').run(retry ? 'retry' : 'failed', new Date(Date.now() + delay * 1000).toISOString(), retry ? null : nowIso(), errorCode, redactedMessage.slice(0, 300), job.id)
    if (!retry) this.db.prepare("UPDATE messages SET analysis_state='review',updated_at=? WHERE id=?").run(nowIso(), job.messageId)
  }
  recoverJobs(): number { return this.db.prepare("UPDATE analysis_jobs SET status='pending',started_at=NULL WHERE status='running'").run().changes }
  cancelPendingJobs(): number { const now = nowIso(); return this.db.prepare("UPDATE analysis_jobs SET status='cancelled',completed_at=? WHERE status IN ('pending','retry')").run(now).changes }
  getJobProgress(): JobProgress {
    const row = this.db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status IN ('pending','retry') THEN 1 ELSE 0 END) pending,SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) running,SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END) completed,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed FROM analysis_jobs`).get() as Record<string, number>
    return { state: (row.running ?? 0) > 0 ? 'running' : 'idle', pending: row.pending ?? 0, running: row.running ?? 0, completed: row.completed ?? 0, failed: row.failed ?? 0, total: row.total ?? 0 }
  }
  countJobs(status?: string): number { return Number((this.db.prepare(`SELECT COUNT(*) value FROM analysis_jobs${status ? ' WHERE status=?' : ''}`).get(...(status ? [status] : [])) as { value: number }).value) }
  nextJobDelayMs(): number | null {
    const row = this.db.prepare("SELECT available_at FROM analysis_jobs WHERE status IN ('pending','retry') ORDER BY available_at LIMIT 1").get() as { available_at: string } | undefined
    return row ? Math.max(0, new Date(row.available_at).getTime() - Date.now()) : null
  }
  recordRouterAttempt(messageId: number, operation: string, attempt: number, outcome: string, errorCode?: string): void { this.db.prepare('INSERT INTO router_attempts(message_id,operation,attempt,outcome,error_code,created_at) VALUES(?,?,?,?,?,?)').run(messageId, operation, attempt, outcome, errorCode ?? null, nowIso()) }

  updateSyncCheckpoint(lastKnownMessageId: number, offset: number, status: string, mode: 'full' | 'incremental', checkpoint: Record<string, unknown> = {}): void {
    this.db.prepare('UPDATE sync_state SET last_known_message_id=MAX(last_known_message_id,?),current_offset=?,sync_status=?,sync_mode=?,checkpoint_json=? WHERE id=1').run(lastKnownMessageId, offset, status, mode, JSON.stringify({ offsetId: offset, ...checkpoint }))
  }
  getSyncCheckpoint(): { lastKnownMessageId: number; currentOffset: number; fullSyncComplete: boolean; status: string; mode: string | null } {
    const row = this.db.prepare('SELECT last_known_message_id lastKnownMessageId,current_offset currentOffset,full_sync_complete fullSyncComplete,sync_status status,sync_mode mode FROM sync_state WHERE id=1').get() as Record<string, unknown>
    return { lastKnownMessageId: Number(row.lastKnownMessageId), currentOffset: Number(row.currentOffset), fullSyncComplete: Boolean(row.fullSyncComplete), status: String(row.status), mode: row.mode ? String(row.mode) : null }
  }
  markSyncComplete(mode: 'full' | 'incremental', latestKnownId: number): void {
    this.db.prepare("UPDATE sync_state SET last_known_message_id=MAX(last_known_message_id,?),last_sync_at=?,full_sync_complete=CASE WHEN ?='full' THEN 1 ELSE full_sync_complete END,current_offset=0,sync_status='idle',sync_mode=NULL,checkpoint_json='{}' WHERE id=1").run(latestKnownId, nowIso(), mode)
  }

  exportData(): unknown { return { schemaVersion: 2, exportedAt: nowIso(), categories: this.db.prepare('SELECT id,name,description,icon FROM categories').all(), topics: this.db.prepare('SELECT id,category_id,name,description,icon FROM topics').all(), messages: this.searchMessages({ limit: 200, offset: 0 }).items } }
  clearUserData(): void {
    this.db.exec("DELETE FROM analysis_jobs;DELETE FROM router_attempts;DELETE FROM message_tags;DELETE FROM tags;DELETE FROM message_topics;DELETE FROM freshness_analysis;DELETE FROM message_analysis;DELETE FROM user_notes;DELETE FROM manual_overrides;DELETE FROM messages;DELETE FROM messages_fts;DELETE FROM topics;DELETE FROM categories;UPDATE sync_state SET last_known_message_id=0,last_sync_at=NULL,full_sync_complete=0,current_offset=0,sync_status='idle',sync_mode=NULL,checkpoint_json='{}';")
  }
  close(): void { this.db.close() }
  backup(destination: string): void { void this.db.backup(destination) }
}
