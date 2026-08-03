import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { appStateSchema, type AppState, type SavedMessage } from '../../shared/contracts'
import type { z } from 'zod'
import type { classificationResponseSchema, freshnessResponseSchema } from '../../shared/contracts'
import { contentHash, extractUrls, normalizeContent, normalizeTopicName } from '../services/content'
import { demoCategories, demoMessages, demoTopics } from './demo'

export type ImportedMessage = { telegramMessageId:number; date:string; editDate:string|null; text:string; caption:string; mediaType:string; sourceTitle:string; sourceUsername:string|null; sourcePublicUrl:string|null; rawJson:string }

export class SavedAtlasDatabase {
  private db: Database.Database
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
      CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, telegram_message_id INTEGER NOT NULL UNIQUE, telegram_peer_id TEXT NOT NULL DEFAULT 'self', date TEXT NOT NULL, edit_date TEXT, text TEXT NOT NULL DEFAULT '', caption TEXT NOT NULL DEFAULT '', normalized_content TEXT NOT NULL, entities_json TEXT NOT NULL DEFAULT '[]', urls_json TEXT NOT NULL DEFAULT '[]', media_type TEXT NOT NULL DEFAULT 'text', media_metadata_json TEXT NOT NULL DEFAULT '{}', local_media_path TEXT, grouped_id TEXT, source_peer_id TEXT, source_message_id INTEGER, source_title TEXT NOT NULL DEFAULT '', source_username TEXT, source_type TEXT NOT NULL DEFAULT 'unknown', source_public_url TEXT, content_hash TEXT NOT NULL, telegram_state TEXT NOT NULL DEFAULT 'present', analysis_state TEXT NOT NULL DEFAULT 'complete', raw_json TEXT NOT NULL DEFAULT '{}', duplicate_of INTEGER REFERENCES messages(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS message_topics (message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, topic_id INTEGER NOT NULL REFERENCES topics(id), is_primary INTEGER NOT NULL DEFAULT 1, confidence REAL NOT NULL DEFAULT 0, assigned_by TEXT NOT NULL DEFAULT 'ai', user_overridden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(message_id, topic_id));
      CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS message_tags (message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, tag_id INTEGER NOT NULL REFERENCES tags(id), assigned_by TEXT NOT NULL DEFAULT 'ai', confidence REAL NOT NULL DEFAULT 0.8, user_overridden INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(message_id, tag_id));
      CREATE TABLE IF NOT EXISTS message_analysis (message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, summary TEXT NOT NULL DEFAULT '', content_type TEXT NOT NULL DEFAULT 'unknown', keywords_json TEXT NOT NULL DEFAULT '[]', language TEXT NOT NULL DEFAULT 'ru', classification_confidence REAL NOT NULL DEFAULT 0, needs_review INTEGER NOT NULL DEFAULT 0, freshness_check_needed INTEGER NOT NULL DEFAULT 0, freshness_reason TEXT NOT NULL DEFAULT '', suggested_search_query TEXT, model_id TEXT NOT NULL DEFAULT 'demo', prompt_version TEXT NOT NULL DEFAULT '1', raw_validated_json TEXT NOT NULL DEFAULT '{}', analyzed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS freshness_analysis (message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'unchecked', verdict TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', confidence REAL NOT NULL DEFAULT 0, checked_at TEXT, expires_at TEXT, alternatives_json TEXT NOT NULL DEFAULT '[]', citations_json TEXT NOT NULL DEFAULT '[]', router_annotations_json TEXT NOT NULL DEFAULT '[]', model_id TEXT NOT NULL DEFAULT 'demo', prompt_version TEXT NOT NULL DEFAULT '1');
      CREATE TABLE IF NOT EXISTS manual_overrides (id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, field TEXT NOT NULL, previous_value_json TEXT NOT NULL, new_value_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_notes (message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY CHECK(id=1), last_known_message_id INTEGER NOT NULL DEFAULT 0, last_sync_at TEXT, full_sync_complete INTEGER NOT NULL DEFAULT 0, current_offset INTEGER NOT NULL DEFAULT 0, sync_status TEXT NOT NULL DEFAULT 'idle', checkpoint_json TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS analysis_jobs (id INTEGER PRIMARY KEY, message_id INTEGER REFERENCES messages(id), job_type TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error_code TEXT, redacted_error_message TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, dependency_id INTEGER REFERENCES analysis_jobs(id));
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_events (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date DESC); CREATE INDEX IF NOT EXISTS idx_messages_hash ON messages(content_hash); CREATE INDEX IF NOT EXISTS idx_freshness_status ON freshness_analysis(status); CREATE INDEX IF NOT EXISTS idx_jobs_status ON analysis_jobs(status, created_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, caption, source, summary, tags, notes, content='');
      INSERT OR IGNORE INTO sync_state(id) VALUES(1);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, datetime('now'));
    `)
    this.db.prepare("UPDATE analysis_jobs SET status='pending', started_at=NULL WHERE status='running'").run()
  }

  seedDemo(): void {
    const now = new Date().toISOString()
    const tx = this.db.transaction(() => {
      this.db.exec('DELETE FROM message_tags; DELETE FROM tags; DELETE FROM message_topics; DELETE FROM freshness_analysis; DELETE FROM message_analysis; DELETE FROM user_notes; DELETE FROM manual_overrides; DELETE FROM messages; DELETE FROM topics; DELETE FROM categories; DELETE FROM messages_fts;')
      const cat = this.db.prepare('INSERT INTO categories(name, normalized_name, description, icon, sort_order, created_at, updated_at) VALUES(?,?,?,?,?,?,?)')
      demoCategories.forEach((c, index) => cat.run(c[0], c[0].toLocaleLowerCase('ru-RU'), c[1], c[2], index, now, now))
      const topic = this.db.prepare('INSERT INTO topics(category_id, name, normalized_name, description, icon, created_at, updated_at) VALUES(?,?,?,?,?,?,?)')
      demoTopics.forEach((t) => topic.run(t[0], t[1], t[1].toLocaleLowerCase('ru-RU'), t[2], t[3], now, now))
      const insertMessage = this.db.prepare(`INSERT INTO messages(telegram_message_id,date,text,caption,normalized_content,urls_json,media_type,source_title,source_type,source_public_url,content_hash,analysis_state,duplicate_of,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      const insertAnalysis = this.db.prepare('INSERT INTO message_analysis(message_id,summary,content_type,classification_confidence,needs_review,freshness_check_needed,freshness_reason,analyzed_at) VALUES(?,?,?,?,?,?,?,?)')
      const insertFresh = this.db.prepare('INSERT INTO freshness_analysis(message_id,status,verdict,reason,confidence,checked_at,expires_at,citations_json) VALUES(?,?,?,?,?,?,?,?)')
      const insertTopic = this.db.prepare('INSERT INTO message_topics(message_id,topic_id,is_primary,confidence,assigned_by,user_overridden,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      const insertTag = this.db.prepare('INSERT OR IGNORE INTO tags(name,normalized_name,created_at) VALUES(?,?,?)')
      const tagId = this.db.prepare('SELECT id FROM tags WHERE normalized_name=?')
      const insertMessageTag = this.db.prepare('INSERT INTO message_tags(message_id,tag_id,assigned_by,confidence) VALUES(?,?,?,?)')
      const insertFts = this.db.prepare('INSERT INTO messages_fts(rowid,text,caption,source,summary,tags,notes) VALUES(?,?,?,?,?,?,?)')
      demoMessages.forEach((m, index) => {
        const normalized = normalizeContent(m.text)
        const sourceUrl = m.source === 'AI Learners' ? 'https://ai-learners.example/course' : null
        const result = insertMessage.run(5000 - index, new Date(Date.now() - index * 86400000).toISOString(), m.text, '', normalized, JSON.stringify(extractUrls(normalized)), m.media ?? 'text', m.source, m.source.includes('Приват') ? 'private' : 'channel', sourceUrl, contentHash(normalized || m.title), m.review ? 'review' : 'complete', m.duplicateOf ?? null, now, now)
        const id = Number(result.lastInsertRowid)
        insertAnalysis.run(id, m.title === 'Фото доски после воркшопа' ? 'Вложение отображается, но его содержимое ещё не анализировалось.' : `${m.title}. ${m.text.slice(0, 110)}`, m.media ?? 'article', m.review ? 0.58 : 0.9, m.review ? 1 : 0, m.status === 'evergreen' ? 0 : 1, m.reason, now)
        const citations = m.status === 'evergreen' || m.status === 'unchecked' ? [] : [{ title: `Официальный источник — ${m.source}`, url: sourceUrl ?? 'https://example.com/source', claim: m.reason }]
        insertFresh.run(id, m.status, m.verdict, m.reason, m.status === 'uncertain' ? 0.55 : 0.88, m.status === 'unchecked' ? null : now, m.status === 'unchecked' ? null : new Date(Date.now() + 60 * 86400000).toISOString(), JSON.stringify(citations))
        if (m.topic) insertTopic.run(id, m.topic, 1, m.review ? 0.58 : 0.9, 'ai', 0, now, now)
        for (const tag of m.tags) { insertTag.run(tag, tag.toLocaleLowerCase('ru-RU'), now); const found = tagId.get(tag.toLocaleLowerCase('ru-RU')) as { id: number }; insertMessageTag.run(id, found.id, 'ai', 0.82) }
        insertFts.run(id, m.text, '', m.source, m.title, m.tags.join(' '), '')
      })
      this.db.prepare("UPDATE sync_state SET last_known_message_id=5000,last_sync_at=?,full_sync_complete=1,sync_status='idle',checkpoint_json=? WHERE id=1").run(now, JSON.stringify({ demo: true }))
      this.db.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('demo_mode','true')").run()
    })
    tx()
  }

  getState(): AppState {
    const row = this.db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN m.analysis_state!='complete' THEN 1 ELSE 0 END) unprocessed, SUM(CASE WHEN f.status='outdated' THEN 1 ELSE 0 END) outdated, SUM(CASE WHEN a.needs_review=1 THEN 1 ELSE 0 END) review FROM messages m LEFT JOIN freshness_analysis f ON f.message_id=m.id LEFT JOIN message_analysis a ON a.message_id=m.id`).get() as any
    const topicCount = (this.db.prepare('SELECT COUNT(*) value FROM topics WHERE is_archived=0').get() as any).value
    const sync = this.db.prepare('SELECT last_sync_at FROM sync_state WHERE id=1').get() as any
    const demo = (this.db.prepare("SELECT value FROM app_settings WHERE key='demo_mode'").get() as any)?.value === 'true'
    const state = { dashboard: { total: row.total ?? 0, topics: topicCount, newCount: Math.min(12, row.total ?? 0), unprocessed: row.unprocessed ?? 0, outdated: row.outdated ?? 0, review: row.review ?? 0, lastSyncAt: sync?.last_sync_at ?? null, telegramConnected: demo, routerConnected: demo, demoMode: demo }, messages: this.search({ query: '', limit: 50, offset: 0 }), topics: this.getTopics() }
    return appStateSchema.parse(state)
  }

  search(input: { query?: string; status?: string; topicId?: number; limit?: number; offset?: number }): SavedMessage[] {
    const params: any[] = []
    const clauses: string[] = []
    let from = 'messages m'
    if (input.query?.trim()) { from += ' JOIN messages_fts x ON x.rowid=m.id'; clauses.push('messages_fts MATCH ?'); params.push(input.query.trim().replace(/["']/g, '')) }
    if (input.status) { clauses.push('f.status=?'); params.push(input.status) }
    if (input.topicId) { clauses.push('mt.topic_id=?'); params.push(input.topicId) }
    params.push(input.limit ?? 50, input.offset ?? 0)
    const rows = this.db.prepare(`SELECT m.*, a.summary,a.needs_review,f.status freshness_status,f.verdict,f.reason freshness_reason,f.confidence freshness_confidence,f.citations_json,t.id topic_id,t.name topic_name,c.name category_name,mt.user_overridden,COALESCE(n.note,'') user_note FROM ${from} LEFT JOIN message_analysis a ON a.message_id=m.id LEFT JOIN freshness_analysis f ON f.message_id=m.id LEFT JOIN message_topics mt ON mt.message_id=m.id AND mt.is_primary=1 LEFT JOIN topics t ON t.id=mt.topic_id LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN user_notes n ON n.message_id=m.id ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY m.date DESC LIMIT ? OFFSET ?`).all(...params) as any[]
    const tags = this.db.prepare('SELECT t.name FROM message_tags mt JOIN tags t ON t.id=mt.tag_id WHERE mt.message_id=?')
    return rows.map((r) => ({ id:r.id,telegramMessageId:r.telegram_message_id,date:r.date,editDate:r.edit_date,text:r.text,caption:r.caption,sourceTitle:r.source_title,sourceUsername:r.source_username,sourcePublicUrl:r.source_public_url,mediaType:r.media_type,contentHash:r.content_hash,summary:r.summary ?? '',topicId:r.topic_id,topicName:r.topic_name,categoryName:r.category_name,tags:(tags.all(r.id) as any[]).map((x)=>x.name),freshnessStatus:r.freshness_status ?? 'unchecked',freshnessVerdict:r.verdict ?? '',freshnessReason:r.freshness_reason ?? '',freshnessConfidence:r.freshness_confidence ?? 0,citations:JSON.parse(r.citations_json ?? '[]'),analysisState:r.analysis_state,userNote:r.user_note,isManual:Boolean(r.user_overridden) }))
  }

  getTopics(): AppState['topics'] {
    return this.db.prepare(`SELECT t.id,t.category_id categoryId,c.name categoryName,t.name,t.description,t.icon,COUNT(mt.message_id) messageCount,SUM(CASE WHEN m.date>=datetime('now','-7 day') THEN 1 ELSE 0 END) newCount,SUM(CASE WHEN f.status='outdated' THEN 1 ELSE 0 END) outdatedCount FROM topics t JOIN categories c ON c.id=t.category_id LEFT JOIN message_topics mt ON mt.topic_id=t.id LEFT JOIN messages m ON m.id=mt.message_id LEFT JOIN freshness_analysis f ON f.message_id=m.id WHERE t.is_archived=0 GROUP BY t.id ORDER BY c.sort_order,t.name`).all().map((r:any)=>({...r,messageCount:r.messageCount??0,newCount:r.newCount??0,outdatedCount:r.outdatedCount??0})) as AppState['topics']
  }

  changeTopic(messageId: number, topicId: number): void {
    const now = new Date().toISOString(); const previous = this.db.prepare('SELECT topic_id FROM message_topics WHERE message_id=? AND is_primary=1').get(messageId) as any
    const tx = this.db.transaction(() => { this.db.prepare('DELETE FROM message_topics WHERE message_id=? AND is_primary=1').run(messageId); this.db.prepare('INSERT INTO message_topics(message_id,topic_id,is_primary,confidence,assigned_by,user_overridden,created_at,updated_at) VALUES(?,?,1,1,\'user\',1,?,?)').run(messageId,topicId,now,now); this.db.prepare('INSERT INTO manual_overrides(message_id,field,previous_value_json,new_value_json,created_at) VALUES(?,?,?,?,?)').run(messageId,'primary_topic',JSON.stringify(previous?.topic_id??null),JSON.stringify(topicId),now) }); tx()
  }
  saveNote(messageId:number,note:string):void { this.db.prepare('INSERT INTO user_notes(message_id,note,updated_at) VALUES(?,?,?) ON CONFLICT(message_id) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at').run(messageId,note,new Date().toISOString()) }
  getPendingMessages(limit=50):Array<{id:number;content:string;source:string;date:string}>{return(this.db.prepare("SELECT id,normalized_content content,source_title source,date FROM messages WHERE analysis_state='pending' ORDER BY date LIMIT ?").all(limit) as any[])}
  getTaxonomy():{categories:Array<{id:number;name:string;description:string}>;topics:Array<{id:number;categoryId:number;name:string;description:string}>}{return{categories:this.db.prepare('SELECT id,name,description FROM categories WHERE is_archived=0').all() as any,topics:this.db.prepare('SELECT id,category_id categoryId,name,description FROM topics WHERE is_archived=0').all() as any}}
  applyClassification(messageId:number,result:z.infer<typeof classificationResponseSchema>):{needsReview:boolean;topicCreated:boolean}{
    const now=new Date().toISOString();let topicId=result.primary_topic.existing_id?Number(result.primary_topic.existing_id):0;let topicCreated=false
    if(topicId&&!this.db.prepare('SELECT 1 FROM topics WHERE id=?').get(topicId))topicId=0
    if(!topicId&&result.primary_topic.proposed_name){const normalized=normalizeTopicName(result.primary_topic.proposed_name);const existing=this.db.prepare('SELECT id FROM topics WHERE normalized_name=?').get(normalized) as any;if(existing)topicId=existing.id;else{let categoryId=result.category.existing_id?Number(result.category.existing_id):0;if(!categoryId||!this.db.prepare('SELECT 1 FROM categories WHERE id=?').get(categoryId)){const categoryName=result.category.proposed_name||'Разное';const categoryNorm=normalizeTopicName(categoryName);const found=this.db.prepare('SELECT id FROM categories WHERE normalized_name=?').get(categoryNorm) as any;if(found)categoryId=found.id;else categoryId=Number(this.db.prepare('INSERT INTO categories(name,normalized_name,description,icon,sort_order,created_at,updated_at) VALUES(?,?,?,?,99,?,?)').run(categoryName,categoryNorm,'Категория предложена RouterAI','folder',now,now).lastInsertRowid)}topicId=Number(this.db.prepare('INSERT INTO topics(category_id,name,normalized_name,description,icon,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(categoryId,result.primary_topic.proposed_name,normalized,result.primary_topic.proposed_description??'','sparkles',now,now).lastInsertRowid);topicCreated=true}}
    const tx=this.db.transaction(()=>{this.db.prepare(`INSERT INTO message_analysis(message_id,summary,content_type,keywords_json,language,classification_confidence,needs_review,freshness_check_needed,freshness_reason,suggested_search_query,model_id,prompt_version,raw_validated_json,analyzed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(message_id) DO UPDATE SET summary=excluded.summary,content_type=excluded.content_type,language=excluded.language,classification_confidence=excluded.classification_confidence,needs_review=excluded.needs_review,freshness_check_needed=excluded.freshness_check_needed,freshness_reason=excluded.freshness_reason,suggested_search_query=excluded.suggested_search_query,model_id=excluded.model_id,prompt_version=excluded.prompt_version,raw_validated_json=excluded.raw_validated_json,analyzed_at=excluded.analyzed_at`).run(messageId,result.summary,result.content_type,JSON.stringify(result.tags),result.language,result.primary_topic.confidence,result.needs_review?1:0,result.freshness_check_needed?1:0,result.freshness_reason,result.suggested_search_query,'routerai','1',JSON.stringify(result),now)
      const manual=this.db.prepare('SELECT 1 FROM message_topics WHERE message_id=? AND is_primary=1 AND user_overridden=1').get(messageId);if(!manual&&topicId){this.db.prepare('DELETE FROM message_topics WHERE message_id=? AND is_primary=1').run(messageId);this.db.prepare('INSERT INTO message_topics(message_id,topic_id,is_primary,confidence,assigned_by,user_overridden,created_at,updated_at) VALUES(?,?,1,?,\'ai\',0,?,?)').run(messageId,topicId,result.primary_topic.confidence,now,now)}
      for(const name of result.tags){const normalized=normalizeTopicName(name);this.db.prepare('INSERT OR IGNORE INTO tags(name,normalized_name,created_at) VALUES(?,?,?)').run(name,normalized,now);const tag=this.db.prepare('SELECT id FROM tags WHERE normalized_name=?').get(normalized) as any;this.db.prepare('INSERT OR REPLACE INTO message_tags(message_id,tag_id,assigned_by,confidence,user_overridden) VALUES(?,?,\'ai\',0.8,0)').run(messageId,tag.id)}
      this.db.prepare('UPDATE messages SET analysis_state=?,updated_at=? WHERE id=?').run(result.needs_review?'review':'complete',now,messageId)
    });tx();return{needsReview:result.needs_review,topicCreated}
  }
  applyFreshness(messageId:number,result:z.infer<typeof freshnessResponseSchema>):void{const checked=new Date(result.checked_at);const expires=new Date(checked.getTime()+result.recommended_recheck_days*86400000);this.db.prepare(`INSERT INTO freshness_analysis(message_id,status,verdict,reason,confidence,checked_at,expires_at,alternatives_json,citations_json,router_annotations_json,model_id,prompt_version) VALUES(?,?,?,?,?,?,?,?,?,'[]','routerai','1') ON CONFLICT(message_id) DO UPDATE SET status=excluded.status,verdict=excluded.verdict,reason=excluded.reason,confidence=excluded.confidence,checked_at=excluded.checked_at,expires_at=excluded.expires_at,alternatives_json=excluded.alternatives_json,citations_json=excluded.citations_json,model_id=excluded.model_id,prompt_version=excluded.prompt_version`).run(messageId,result.status,result.verdict,result.reason,result.confidence,result.checked_at,expires.toISOString(),JSON.stringify(result.alternatives),JSON.stringify(result.citations))}
  markAnalysisFailed(messageId:number,error:string):void{const now=new Date().toISOString();this.db.prepare("UPDATE messages SET analysis_state='review',updated_at=? WHERE id=?").run(now,messageId);this.db.prepare("INSERT INTO analysis_jobs(message_id,job_type,status,attempts,error_code,redacted_error_message,created_at,completed_at) VALUES(?,'classification','failed',1,'ROUTERAI_ERROR',?,?,?)").run(messageId,error.slice(0,500),now,now)}
  importMessage(message: ImportedMessage): 'added'|'updated'|'unchanged' {
    const normalized = normalizeContent(message.text,message.caption); const hash = contentHash(normalized || `${message.telegramMessageId}:${message.mediaType}`); const now = new Date().toISOString()
    const existing = this.db.prepare('SELECT id,content_hash FROM messages WHERE telegram_message_id=?').get(message.telegramMessageId) as {id:number;content_hash:string}|undefined
    if(existing?.content_hash===hash)return'unchanged'
    if(existing){ this.db.prepare('UPDATE messages SET date=?,edit_date=?,text=?,caption=?,normalized_content=?,urls_json=?,media_type=?,source_title=?,source_username=?,source_public_url=?,content_hash=?,raw_json=?,analysis_state=\'pending\',updated_at=? WHERE id=?').run(message.date,message.editDate,message.text,message.caption,normalized,JSON.stringify(extractUrls(normalized)),message.mediaType,message.sourceTitle,message.sourceUsername,message.sourcePublicUrl,hash,message.rawJson,now,existing.id); return'updated' }
    const result=this.db.prepare('INSERT INTO messages(telegram_message_id,date,edit_date,text,caption,normalized_content,urls_json,media_type,source_title,source_username,source_public_url,content_hash,raw_json,analysis_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,\'pending\',?,?)').run(message.telegramMessageId,message.date,message.editDate,message.text,message.caption,normalized,JSON.stringify(extractUrls(normalized)),message.mediaType,message.sourceTitle,message.sourceUsername,message.sourcePublicUrl,hash,message.rawJson,now,now)
    this.db.prepare('INSERT INTO messages_fts(rowid,text,caption,source,summary,tags,notes) VALUES(?,?,?,?,?,?,?)').run(Number(result.lastInsertRowid),message.text,message.caption,message.sourceTitle,'','','')
    return'added'
  }
  updateSyncCheckpoint(lastKnownMessageId:number,offset:number,status:string):void { this.db.prepare('UPDATE sync_state SET last_known_message_id=MAX(last_known_message_id,?),last_sync_at=?,current_offset=?,sync_status=?,checkpoint_json=? WHERE id=1').run(lastKnownMessageId,new Date().toISOString(),offset,status,JSON.stringify({offsetId:offset})) }
  getSyncCheckpoint():{lastKnownMessageId:number;currentOffset:number;fullSyncComplete:boolean}{const r=this.db.prepare('SELECT last_known_message_id lastKnownMessageId,current_offset currentOffset,full_sync_complete fullSyncComplete FROM sync_state WHERE id=1').get() as any;return{...r,fullSyncComplete:Boolean(r.fullSyncComplete)}}
  markFullSyncComplete():void{this.db.prepare("UPDATE sync_state SET full_sync_complete=1,sync_status='idle',current_offset=0,last_sync_at=datetime('now') WHERE id=1").run()}
  exportData():unknown { return { schemaVersion:1, exportedAt:new Date().toISOString(), categories:this.db.prepare('SELECT id,name,description,icon FROM categories').all(),topics:this.db.prepare('SELECT id,category_id,name,description,icon FROM topics').all(),messages:this.search({limit:100000,offset:0}) } }
  clearUserData():void { this.db.exec('DELETE FROM message_tags;DELETE FROM tags;DELETE FROM message_topics;DELETE FROM freshness_analysis;DELETE FROM message_analysis;DELETE FROM user_notes;DELETE FROM manual_overrides;DELETE FROM messages;DELETE FROM messages_fts;DELETE FROM topics;DELETE FROM categories;UPDATE sync_state SET last_known_message_id=0,last_sync_at=NULL,full_sync_complete=0,current_offset=0,sync_status=\'idle\',checkpoint_json=\'{}\';') }
  recoverJobs(): number { return this.db.prepare("UPDATE analysis_jobs SET status='pending',started_at=NULL WHERE status='running'").run().changes }
  close(): void { this.db.close() }
  backup(destination:string): void { this.db.backup(destination) }
}
