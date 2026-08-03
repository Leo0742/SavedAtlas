import { settingsSchema, type AppState, type JobProgress, type SavedAtlasAPI, type SavedMessage, type Settings, type SyncProgress } from '../../shared/contracts'

let settings: Settings = settingsSchema.parse({})
let setupComplete = true
let syncProgress: SyncProgress = { mode: null, state: 'idle', pages: 0, fetched: 0, added: 0, updated: 0, skipped: 0, latestKnownId: 0, checkpointOffset: 0, error: null }
const jobs: JobProgress = { state: 'idle', pending: 0, running: 0, completed: 8, failed: 0, total: 8 }
const titles = ['Курс по генеративному ИИ', 'Подборка инструментов', 'Статья: будущее AGI', 'Конспект книги', 'Новый релиз модели', 'Модели оценки LLM', 'Нейросети для дизайна', 'Промпт-инжиниринг 101']
let messages: SavedMessage[] = titles.map((title, index) => ({
  id: index + 1, telegramMessageId: 5000 - index, date: new Date(Date.now() - index * 86400000).toISOString(), editDate: null, originalPostDate: null,
  text: `${title}. Сохранённый материал с полезным описанием.`, caption: '', sourceTitle: index === 3 ? 'Личная заметка' : 'AI Learners', sourceUsername: index === 3 ? null : 'ai_learners', sourcePublicUrl: index === 3 ? null : `https://t.me/ai_learners/${100 + index}`,
  sourceType: index === 3 ? 'personal_note' : 'public_channel', mediaType: 'text', mediaMetadata: {}, contentHash: `demo-${index}`, summary: `${title}. Краткая сводка.`, topicId: index === 3 ? 2 : 1, topicName: index === 3 ? 'Книги и конспекты' : 'Курсы по ИИ', categoryName: 'Обучение', tags: ['ИИ', 'материал'],
  freshnessStatus: index === 4 ? 'superseded' : index === 6 ? 'outdated' : 'current', freshnessVerdict: 'Материал проверен.', freshnessReason: 'Есть подтверждённый источник.', freshnessConfidence: .9,
  citations: index === 0 ? [{ title: 'Официальная страница', url: 'https://example.com/course', claim: 'Материал доступен.', verified: true }] : [], alternatives: [], analysisState: 'complete', userNote: '', isManual: false
}))
const topics = [{ id: 1, categoryId: 1, categoryName: 'Обучение', name: 'Курсы по ИИ', description: 'Учебные программы', icon: 'book', messageCount: 7, newCount: 1, outdatedCount: 1 }, { id: 2, categoryId: 1, categoryName: 'Обучение', name: 'Книги и конспекты', description: 'Книги и заметки', icon: 'book', messageCount: 1, newCount: 0, outdatedCount: 0 }]
const state = (): AppState => ({ dashboard: { total: messages.length, topics: topics.length, newCount: 2, current: 6, unprocessed: 0, outdated: 1, unchecked: 0, review: 0, lastSyncAt: new Date().toISOString(), telegramConfigured: true, telegramAuthorized: true, routerConfigured: true, routerTested: true, demoMode: true }, setup: { complete: setupComplete, telegramAuthorized: true, routerConfigured: true }, messages: messages.slice(0, 50), topics })

export const mockApi: SavedAtlasAPI = {
  getState: async () => state(), getSetupState: async () => state().setup, completeSetup: async () => { setupComplete = true },
  searchMessages: async (input) => { const filtered = messages.filter((message) => (!input.query || `${message.text} ${message.summary} ${message.sourceTitle} ${message.topicName ?? ''}`.toLowerCase().includes(input.query.toLowerCase())) && (!input.status || message.freshnessStatus === input.status) && (!input.topicId || message.topicId === input.topicId) && (!input.withoutTopic || message.topicId == null) && (!input.analysisState || message.analysisState === input.analysisState) && (!input.mediaType || message.mediaType === input.mediaType)); const offset = input.offset ?? 0; const limit = input.limit ?? 50; return { items: filtered.slice(offset, offset + limit), total: filtered.length, nextOffset: offset + limit < filtered.length ? offset + limit : null } },
  syncFull: async () => { syncProgress = { ...syncProgress, mode: 'full', state: 'running' }; await new Promise((resolve) => setTimeout(resolve, 80)); syncProgress = { ...syncProgress, state: 'complete', pages: 1, fetched: messages.length, added: messages.length }; return { added: messages.length, updated: 0, skipped: 0, failed: 0 } },
  syncIncremental: async () => { syncProgress = { ...syncProgress, mode: 'incremental', state: 'complete', pages: 1, fetched: messages.length, skipped: messages.length }; return { added: 0, updated: 0, skipped: messages.length, failed: 0 } },
  syncPause: async () => { syncProgress.state = 'paused' }, syncResume: async () => { syncProgress.state = 'running' }, syncCancel: async () => { syncProgress.state = 'cancelled' }, getSyncProgress: async () => syncProgress,
  jobsPause: async () => undefined, jobsResume: async () => undefined, jobsCancel: async () => undefined, getJobProgress: async () => jobs,
  changeTopic: async ({ messageId, topicId }) => { messages = messages.map((message) => message.id === messageId ? { ...message, topicId, topicName: topics.find((topic) => topic.id === topicId)?.name ?? null, isManual: true } : message) },
  saveNote: async ({ messageId, note }) => { messages = messages.map((message) => message.id === messageId ? { ...message, userNote: note } : message) }, recheckFreshness: async () => undefined, hideMessage: async ({ messageId }) => { messages = messages.filter((message) => message.id !== messageId) },
  seedDemo: async () => { setupComplete = true }, saveCredentials: async () => undefined, saveTelegramCredentials: async () => undefined, saveRouterSettings: async () => undefined, credentialsStatus: async () => ({ telegram: true, router: true }),
  telegramSendCode: async () => ({ state: 'code_sent' }), telegramSubmitCode: async () => ({ state: 'authorized' }), telegramSubmitPassword: async () => ({ state: 'authorized' }), telegramCancelAuth: async () => undefined,
  testRouter: async () => ({ ok: true, message: 'Подключение работает.' }), getSettings: async () => settings, saveSettings: async (input) => { settings = settingsSchema.parse(input); return settings },
  exportJson: async () => null, openExternal: async () => undefined, resetData: async () => { messages = [] }, deleteSecrets: async () => undefined
}
