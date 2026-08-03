import { app, dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { authStateSchema, bulkTopicSchema, categoryCreateSchema, credentialsSchema, loginCodeSchema, messageIdSchema, noteSchema, passwordSchema, phoneSchema, proposalResolveSchema, querySchema, routerSettingsSchema, settingsSchema, tagsChangeSchema, telegramCredentialsSchema, topicArchiveSchema, topicChangeSchema, topicCreateSchema, topicMergeSchema, topicUpdateSchema } from '../shared/contracts'
import type { SavedAtlasDatabase } from './database'
import type { JobRunner } from './services/job-runner'
import type { RouterAIService } from './services/routerai'
import type { SecretStore } from './services/security'
import type { SyncService } from './services/sync'
import type { TelegramService } from './services/telegram'

type Services = { db: SavedAtlasDatabase; secrets: SecretStore; router: RouterAIService; telegram: TelegramService; sync: SyncService; jobs: JobRunner }
const urlSchema = z.string().url().refine((value) => ['https:', 'tg:'].includes(new URL(value).protocol), 'Недопустимая ссылка')
function handle<T>(channel: string, fn: (input: T) => unknown | Promise<unknown>): void { ipcMain.handle(channel, (_event, input: T) => fn(input)) }

export function registerIpc(s: Services): void {
  handle('state:get', () => s.db.getState()); handle('setup:get', () => s.db.getSetupState())
  handle('setup:complete', async () => { const state = s.db.getSetupState(); if (!state.telegramAuthorized || !state.routerConfigured) throw new Error('Сначала завершите авторизацию Telegram и настройте RouterAI.'); s.db.completeSetup() })
  handle('messages:search', (input) => s.db.searchMessages(querySchema.parse(input)))
  handle('demo:enter', () => { s.sync.cancel(); s.jobs.pause(); s.db.enterDemo() })
  handle('demo:reset', () => s.db.resetDemo())
  handle('demo:exit', () => { s.db.exitDemo(); if (s.db.getSettings().backgroundUpdates) void s.jobs.resume() })
  handle('message:topic', (input) => { const value = topicChangeSchema.parse(input); s.db.changeTopic(value.messageId, value.topicId) })
  handle('message:topic-remove', (input) => s.db.removeTopic(messageIdSchema.parse(input).messageId))
  handle('message:tags', (input) => { const value = tagsChangeSchema.parse(input); s.db.changeTags(value.messageId, value.tags) })
  handle('message:bulk-topic', (input) => { const value = bulkTopicSchema.parse(input); s.db.bulkMove(value.messageIds, value.topicId) })
  handle('message:note', (input) => { const value = noteSchema.parse(input); s.db.saveNote(value.messageId, value.note) })
  handle('message:hide', (input) => s.db.hideMessage(messageIdSchema.parse(input).messageId))
  handle('message:restore', (input) => s.db.restoreMessage(messageIdSchema.parse(input).messageId))
  handle('category:create', (input) => { const value = categoryCreateSchema.parse(input); return s.db.createCategory(value.name, value.description) })
  handle('topic:create', (input) => { const value = topicCreateSchema.parse(input); return s.db.createTopic(value.categoryId, value.name, value.description) })
  handle('topic:update', (input) => { const value = topicUpdateSchema.parse(input); s.db.updateTopic(value.topicId, value.categoryId, value.name, value.description) })
  handle('topic:merge', (input) => { const value = topicMergeSchema.parse(input); s.db.mergeTopics(value.sourceTopicId, value.targetTopicId) })
  handle('topic:archive', (input) => { const value = topicArchiveSchema.parse(input); s.db.archiveTopic(value.topicId, value.archived) })
  handle('proposal:list', () => s.db.getTopicProposals())
  handle('proposal:resolve', (input) => { const value = proposalResolveSchema.parse(input); s.db.resolveTopicProposal(value.proposalId, value.action, value.name, value.topicId) })
  handle('message:recheck', (input) => { s.db.scheduleFreshness(messageIdSchema.parse(input).messageId, null, true); void s.jobs.start() })
  handle('credentials:save', (input) => { const value = credentialsSchema.parse(input); s.secrets.set({ telegramApiId: Number(value.apiId), telegramApiHash: value.apiHash, routerKey: value.routerKey, classificationModel: value.classificationModel, freshnessModel: value.freshnessModel }); s.telegram.configure(Number(value.apiId), value.apiHash); s.router.configure(value.routerKey, value.classificationModel, value.freshnessModel); s.db.setConnectionState({ telegramConfigured: true, telegramAuthorized: false, routerConfigured: true, routerTested: false }) })
  handle('credentials:telegram', (input) => { const value = telegramCredentialsSchema.parse(input); s.secrets.set({ telegramApiId: Number(value.apiId), telegramApiHash: value.apiHash }); s.telegram.configure(Number(value.apiId), value.apiHash); s.db.setConnectionState({ telegramConfigured: true, telegramAuthorized: false }) })
  handle('credentials:router', (input) => { const value = routerSettingsSchema.parse(input); s.secrets.set(value); s.router.configure(value.routerKey, value.classificationModel, value.freshnessModel); s.db.setAnalysisModels(value.classificationModel, value.freshnessModel); s.db.setConnectionState({ routerConfigured: true, routerTested: false }) })
  handle('credentials:status', () => s.secrets.status())
  handle('telegram:send-code', async (input) => authStateSchema.parse(await s.telegram.sendCode(phoneSchema.parse(input).phone)))
  handle('telegram:submit-code', async (input) => { const result = authStateSchema.parse(await s.telegram.submitCode(loginCodeSchema.parse(input).code)); if (result.state === 'authorized') { s.secrets.set({ telegramSession: s.telegram.session() }); s.db.setConnectionState({ telegramAuthorized: true }) } return result })
  handle('telegram:submit-password', async (input) => { const result = authStateSchema.parse(await s.telegram.submitPassword(passwordSchema.parse(input).password)); if (result.state === 'authorized') { s.secrets.set({ telegramSession: s.telegram.session() }); s.db.setConnectionState({ telegramAuthorized: true }) } return result })
  handle('telegram:cancel', () => s.telegram.cancel())
  handle('router:test', async () => { const result = await s.router.test(); s.db.setConnectionState({ routerTested: result.ok }); return result })
  handle('sync:full', async () => { const result = await s.sync.runFull(); void s.jobs.start(); return result })
  handle('sync:incremental', async () => { const result = await s.sync.runIncremental(); void s.jobs.start(); return result })
  handle('sync:pause', () => s.sync.pause()); handle('sync:resume', () => s.sync.resume()); handle('sync:cancel', () => s.sync.cancel()); handle('sync:progress', () => s.sync.getProgress())
  handle('jobs:pause', () => s.jobs.pause()); handle('jobs:resume', () => s.jobs.resume()); handle('jobs:cancel', () => s.jobs.cancel()); handle('jobs:progress', () => s.jobs.getProgress())
  handle('settings:get', () => s.db.getSettings()); handle('settings:save', (input) => s.db.saveSettings(settingsSchema.parse(input)))
  handle('external:open', (input) => { const url = urlSchema.parse(input); return process.env['SAVEDATLAS_E2E'] === '1' ? Promise.resolve() : shell.openExternal(url) })
  handle('data:export', async () => { let filePath: string | null = null; if (process.env['SAVEDATLAS_E2E'] === '1') filePath = join(app.getPath('userData'), 'savedatlas-export.json'); else { const result = await dialog.showSaveDialog({ title: 'Экспорт SavedAtlas', defaultPath: 'savedatlas-export.json', filters: [{ name: 'JSON', extensions: ['json'] }] }); filePath = result.canceled ? null : result.filePath ?? null } if (!filePath) return null; await writeFile(filePath, JSON.stringify(s.db.exportData(), null, 2), { encoding: 'utf8', mode: 0o600 }); return filePath })
  handle('data:export-topic', async (input) => { const topicId = z.number().int().positive().parse(input); let filePath: string | null = null; if (process.env['SAVEDATLAS_E2E'] === '1') filePath = join(app.getPath('userData'), 'savedatlas-topic.md'); else { const result = await dialog.showSaveDialog({ title: 'Экспорт темы SavedAtlas', defaultPath: 'savedatlas-topic.md', filters: [{ name: 'Markdown', extensions: ['md'] }] }); filePath = result.canceled ? null : result.filePath ?? null } if (!filePath) return null; await writeFile(filePath, s.db.exportTopicMarkdown(topicId), { encoding: 'utf8', mode: 0o600 }); return filePath })
  handle('data:reset', () => s.db.clearUserData())
  handle('data:reveal', () => { if (process.env['SAVEDATLAS_E2E'] !== '1') shell.showItemInFolder(s.db.getDatabasePath()) })
  handle('prototype:reveal', () => { const path = s.db.getPrototypeBackupPath(); if (path && process.env['SAVEDATLAS_E2E'] !== '1') shell.showItemInFolder(path) })
  handle('prototype:ack', () => s.db.acknowledgePrototypeBackup())
  handle('prototype:delete', () => s.db.deletePrototypeBackup())
  handle('app:quit', () => app.quit())
  handle('credentials:delete', async (input) => { const kind = z.enum(['telegram', 'router', 'all']).parse(input); if (kind === 'telegram' || kind === 'all') { s.sync.cancel(); await s.telegram.destroy(); s.secrets.delete(['telegramApiId', 'telegramApiHash', 'telegramSession']); s.db.setConnectionState({ telegramConfigured: false, telegramAuthorized: false }) } if (kind === 'router' || kind === 'all') { s.jobs.pause(); s.router.clear(); s.secrets.delete(['routerKey', 'classificationModel', 'freshnessModel']); s.db.setConnectionState({ routerConfigured: false, routerTested: false }) } })
}
