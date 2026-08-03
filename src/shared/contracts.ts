import { z } from 'zod'

export const freshnessStatusSchema = z.enum(['current', 'outdated', 'superseded', 'unavailable', 'evergreen', 'uncertain', 'unchecked'])
export type FreshnessStatus = z.infer<typeof freshnessStatusSchema>

export const citationSchema = z.object({ title: z.string(), url: z.string().url(), claim: z.string() })
export const messageSchema = z.object({
  id: z.number(), telegramMessageId: z.number(), date: z.string(), editDate: z.string().nullable(),
  text: z.string(), caption: z.string(), sourceTitle: z.string(), sourceUsername: z.string().nullable(),
  sourcePublicUrl: z.string().nullable(), mediaType: z.string(), contentHash: z.string(),
  summary: z.string(), topicId: z.number().nullable(), topicName: z.string().nullable(), categoryName: z.string().nullable(),
  tags: z.array(z.string()), freshnessStatus: freshnessStatusSchema, freshnessVerdict: z.string(),
  freshnessReason: z.string(), freshnessConfidence: z.number(), citations: z.array(citationSchema),
  analysisState: z.string(), userNote: z.string(), isManual: z.boolean()
})
export type SavedMessage = z.infer<typeof messageSchema>

export const topicSchema = z.object({ id: z.number(), categoryId: z.number(), categoryName: z.string(), name: z.string(), description: z.string(), icon: z.string(), messageCount: z.number(), newCount: z.number(), outdatedCount: z.number() })
export type Topic = z.infer<typeof topicSchema>

export const dashboardSchema = z.object({
  total: z.number(), topics: z.number(), newCount: z.number(), unprocessed: z.number(), outdated: z.number(), review: z.number(),
  lastSyncAt: z.string().nullable(), telegramConnected: z.boolean(), routerConnected: z.boolean(), demoMode: z.boolean()
})
export type Dashboard = z.infer<typeof dashboardSchema>

export const appStateSchema = z.object({ dashboard: dashboardSchema, messages: z.array(messageSchema), topics: z.array(topicSchema) })
export type AppState = z.infer<typeof appStateSchema>

export const querySchema = z.object({ query: z.string().max(300).default(''), status: freshnessStatusSchema.optional(), topicId: z.number().int().positive().optional(), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0) })
export const credentialsSchema = z.object({ apiId: z.string().regex(/^\d{4,12}$/), apiHash: z.string().regex(/^[a-fA-F0-9]{32}$/), routerKey: z.string().min(12), classificationModel: z.string().min(1), freshnessModel: z.string().min(1) })
export const telegramCredentialsSchema = credentialsSchema.pick({ apiId: true, apiHash: true })
export const routerSettingsSchema = credentialsSchema.pick({ routerKey: true, classificationModel: true, freshnessModel: true })
export const phoneSchema = z.object({ phone: z.string().min(7).max(24) })
export const loginCodeSchema = z.object({ code: z.string().regex(/^\d{4,8}$/) })
export const passwordSchema = z.object({ password: z.string().min(1).max(512) })
export const authStateSchema = z.object({ state: z.enum(['idle','code_sent','password_required','authorized','cancelled','error']), message: z.string().optional(), floodWaitSeconds: z.number().optional() })
export const topicChangeSchema = z.object({ messageId: z.number().int().positive(), topicId: z.number().int().positive() })
export const noteSchema = z.object({ messageId: z.number().int().positive(), note: z.string().max(10000) })
export const syncResultSchema = z.object({ added: z.number(), updated: z.number(), analyzed: z.number(), skipped: z.number(), review: z.number(), topicsCreated: z.number(), freshnessChecks: z.number(), failed: z.number() })

export const classificationResponseSchema = z.object({
  message_id: z.string(), summary: z.string(), content_type: z.string(),
  category: z.object({ existing_id: z.string().nullable(), proposed_name: z.string().nullable(), confidence: z.number().min(0).max(1) }),
  primary_topic: z.object({ existing_id: z.string().nullable(), proposed_name: z.string().nullable(), proposed_description: z.string().nullable().default(null), confidence: z.number().min(0).max(1) }),
  tags: z.array(z.string()).max(3), language: z.string(), freshness_check_needed: z.boolean(), freshness_reason: z.string(), suggested_search_query: z.string().nullable().default(null), needs_review: z.boolean()
})

export const freshnessResponseSchema = z.object({
  status: freshnessStatusSchema.exclude(['unchecked']), verdict: z.string(), reason: z.string(), confidence: z.number().min(0).max(1), checked_at: z.string(), recommended_recheck_days: z.number().int().min(1).max(365),
  alternatives: z.array(z.object({ name: z.string(), why: z.string(), url: z.string().url(), limitations: z.string() })), citations: z.array(citationSchema)
})

export type SavedAtlasAPI = {
  getState(): Promise<AppState>; search(input: z.input<typeof querySchema>): Promise<SavedMessage[]>;
  sync(): Promise<z.infer<typeof syncResultSchema>>; changeTopic(input: z.input<typeof topicChangeSchema>): Promise<void>;
  saveNote(input: z.input<typeof noteSchema>): Promise<void>; seedDemo(): Promise<void>;
  saveCredentials(input: z.input<typeof credentialsSchema>): Promise<void>; credentialsStatus(): Promise<{ telegram: boolean; router: boolean }>;
  saveTelegramCredentials(input: z.input<typeof telegramCredentialsSchema>): Promise<void>; saveRouterSettings(input: z.input<typeof routerSettingsSchema>): Promise<void>;
  telegramSendCode(input: z.input<typeof phoneSchema>): Promise<z.infer<typeof authStateSchema>>; telegramSubmitCode(input: z.input<typeof loginCodeSchema>): Promise<z.infer<typeof authStateSchema>>;
  telegramSubmitPassword(input: z.input<typeof passwordSchema>): Promise<z.infer<typeof authStateSchema>>; telegramCancelAuth(): Promise<void>;
  testRouter(): Promise<{ ok: boolean; message: string }>; exportJson(): Promise<string | null>;
  openExternal(url: string): Promise<void>; resetData(): Promise<void>; deleteSecrets(kind:'telegram'|'router'|'all'):Promise<void>
}
