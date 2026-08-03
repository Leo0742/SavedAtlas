import { z } from 'zod'

export const freshnessStatusSchema = z.enum(['current', 'outdated', 'superseded', 'unavailable', 'evergreen', 'uncertain', 'unchecked'])
export type FreshnessStatus = z.infer<typeof freshnessStatusSchema>

export const citationSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  claim: z.string(),
  verified: z.boolean().default(false)
})
export const alternativeSchema = z.object({
  name: z.string(), why: z.string(), url: z.string().url(), limitations: z.string(),
  supportingSource: citationSchema.nullable().default(null)
})

export const messageSchema = z.object({
  id: z.number(), telegramMessageId: z.number(), date: z.string(), editDate: z.string().nullable(),
  originalPostDate: z.string().nullable(), text: z.string(), caption: z.string(), sourceTitle: z.string(),
  sourceUsername: z.string().nullable(), sourcePublicUrl: z.string().nullable(), sourceType: z.string(),
  mediaType: z.string(), mediaMetadata: z.record(z.unknown()), contentHash: z.string(), summary: z.string(),
  topicId: z.number().nullable(), topicName: z.string().nullable(), categoryName: z.string().nullable(),
  tags: z.array(z.string()), freshnessStatus: freshnessStatusSchema, freshnessVerdict: z.string(),
  freshnessReason: z.string(), freshnessConfidence: z.number(), citations: z.array(citationSchema),
  alternatives: z.array(alternativeSchema), analysisState: z.string(), userNote: z.string(), isManual: z.boolean()
  , hiddenAt: z.string().nullable()
})
export type SavedMessage = z.infer<typeof messageSchema>

export const topicSchema = z.object({ id: z.number(), categoryId: z.number(), categoryName: z.string(), name: z.string(), description: z.string(), icon: z.string(), messageCount: z.number(), newCount: z.number(), outdatedCount: z.number(), archived: z.boolean().default(false) })
export type Topic = z.infer<typeof topicSchema>
export const categorySchema = z.object({ id: z.number(), name: z.string(), description: z.string(), archived: z.boolean().default(false) })
export type Category = z.infer<typeof categorySchema>
export const topicProposalSchema = z.object({ id: z.number(), messageId: z.number(), proposedName: z.string(), proposedDescription: z.string(), categoryId: z.number().nullable(), confidence: z.number(), status: z.enum(['pending', 'accepted', 'rejected']), createdAt: z.string() })
export type TopicProposal = z.infer<typeof topicProposalSchema>

export const dashboardSchema = z.object({
  total: z.number(), topics: z.number(), newCount: z.number(), current: z.number(), unprocessed: z.number(),
  outdated: z.number(), unchecked: z.number(), review: z.number(), lastSyncAt: z.string().nullable(),
  telegramConfigured: z.boolean(), telegramAuthorized: z.boolean(), routerConfigured: z.boolean(),
  routerTested: z.boolean(), demoMode: z.boolean(), initialFullSyncComplete: z.boolean(), prototypeBackupAvailable: z.boolean(), prototypeBackupNotice: z.boolean()
})
export type Dashboard = z.infer<typeof dashboardSchema>

export const setupStateSchema = z.object({ complete: z.boolean(), configurationComplete: z.boolean(), telegramAuthorized: z.boolean(), routerConfigured: z.boolean(), initialFullSyncComplete: z.boolean(), demoMode: z.boolean() })
export type SetupState = z.infer<typeof setupStateSchema>
export const appStateSchema = z.object({ dashboard: dashboardSchema, setup: setupStateSchema, messages: z.array(messageSchema), topics: z.array(topicSchema) })
export type AppState = z.infer<typeof appStateSchema>

export const querySchema = z.object({
  query: z.string().max(300).default(''), status: freshnessStatusSchema.optional(),
  topicId: z.number().int().positive().optional(), withoutTopic: z.boolean().optional(),
  analysisState: z.enum(['pending', 'running', 'review', 'complete', 'failed']).optional(),
  source: z.string().max(200).optional(), mediaType: z.string().max(80).optional(), dateFrom: z.string().datetime().optional(), dateTo: z.string().datetime().optional(), includeHidden: z.boolean().optional(), hiddenOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0)
})
export type SearchQuery = z.input<typeof querySchema>
export const searchResultSchema = z.object({ items: z.array(messageSchema), total: z.number(), nextOffset: z.number().nullable() })
export type SearchResult = z.infer<typeof searchResultSchema>

export const credentialsSchema = z.object({ apiId: z.string().regex(/^\d{4,12}$/), apiHash: z.string().regex(/^[a-fA-F0-9]{32}$/), routerKey: z.string().min(12), classificationModel: z.string().min(1), freshnessModel: z.string().min(1) })
export const telegramCredentialsSchema = credentialsSchema.pick({ apiId: true, apiHash: true })
export const routerSettingsSchema = credentialsSchema.pick({ routerKey: true, classificationModel: true, freshnessModel: true })
export const phoneSchema = z.object({ phone: z.string().min(7).max(24) })
export const loginCodeSchema = z.object({ code: z.string().regex(/^\d{4,8}$/) })
export const passwordSchema = z.object({ password: z.string().min(1).max(512) })
export const authStateSchema = z.object({ state: z.enum(['idle', 'requesting_code', 'code_sent', 'password_required', 'authorized', 'cancelled', 'expired', 'additional_verification', 'error']), message: z.string().optional(), floodWaitSeconds: z.number().optional() })
export type AuthState = z.infer<typeof authStateSchema>

export const topicChangeSchema = z.object({ messageId: z.number().int().positive(), topicId: z.number().int().positive() })
export const topicCreateSchema = z.object({ categoryId: z.number().int().positive(), name: z.string().trim().min(1).max(120), description: z.string().max(1000).default('') })
export const categoryCreateSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(1000).default('') })
export const topicUpdateSchema = topicCreateSchema.extend({ topicId: z.number().int().positive() })
export const topicMergeSchema = z.object({ sourceTopicId: z.number().int().positive(), targetTopicId: z.number().int().positive() }).refine((value) => value.sourceTopicId !== value.targetTopicId)
export const topicArchiveSchema = z.object({ topicId: z.number().int().positive(), archived: z.boolean() })
export const tagsChangeSchema = z.object({ messageId: z.number().int().positive(), tags: z.array(z.string().trim().min(1).max(60)).max(20) })
export const bulkTopicSchema = z.object({ messageIds: z.array(z.number().int().positive()).min(1).max(1000), topicId: z.number().int().positive().nullable() })
export const proposalResolveSchema = z.object({ proposalId: z.number().int().positive(), action: z.enum(['accept', 'reject', 'existing']), name: z.string().trim().min(1).max(120).optional(), topicId: z.number().int().positive().optional() })
export const noteSchema = z.object({ messageId: z.number().int().positive(), note: z.string().max(10000) })
export const messageIdSchema = z.object({ messageId: z.number().int().positive() })

export const syncProgressSchema = z.object({
  mode: z.enum(['full', 'incremental']).nullable(), state: z.enum(['idle', 'running', 'paused', 'cancelled', 'failed', 'complete']),
  pages: z.number(), fetched: z.number(), added: z.number(), updated: z.number(), skipped: z.number(),
  latestKnownId: z.number(), checkpointOffset: z.number(), error: z.string().nullable()
})
export type SyncProgress = z.infer<typeof syncProgressSchema>
export const syncResultSchema = syncProgressSchema.pick({ added: true, updated: true, skipped: true }).extend({ failed: z.number() })

export const jobProgressSchema = z.object({ state: z.enum(['idle', 'running', 'paused', 'cancelled']), pending: z.number(), running: z.number(), completed: z.number(), failed: z.number(), total: z.number() })
export type JobProgress = z.infer<typeof jobProgressSchema>

const nullableId = z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]).nullable()
export const classificationResponseSchema = z.object({
  message_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]), summary: z.string().min(1), content_type: z.string().min(1),
  category: z.object({ existing_id: nullableId, proposed_name: z.string().nullable(), confidence: z.number().min(0).max(1) }),
  primary_topic: z.object({ existing_id: nullableId, proposed_name: z.string().nullable(), proposed_description: z.string().nullable().default(null), confidence: z.number().min(0).max(1) }),
  tags: z.array(z.string().min(1)).max(3), language: z.string(), freshness_check_needed: z.boolean(), freshness_reason: z.string(),
  suggested_search_query: z.string().nullable().default(null), needs_review: z.boolean()
})

export const freshnessResponseSchema = z.object({
  status: freshnessStatusSchema.exclude(['unchecked']), verdict: z.string(), reason: z.string(), confidence: z.number().min(0).max(1),
  checked_at: z.string().datetime(), recommended_recheck_days: z.number().int().min(1).max(365),
  alternatives: z.array(z.object({ name: z.string(), why: z.string(), url: z.string().url(), limitations: z.string(), supporting_source_url: z.string().url().nullable().default(null) })),
  citations: z.array(z.object({ title: z.string(), url: z.string().url(), claim: z.string() }))
})

export const settingsSchema = z.object({
  syncOverlap: z.number().int().min(1).max(1000).default(150), jobConcurrency: z.number().int().min(1).max(8).default(2),
  automaticTopics: z.boolean().default(false), topicConfidenceThreshold: z.number().min(0.5).max(1).default(0.85),
  webSearch: z.boolean().default(true), freshnessMaxResults: z.number().int().min(1).max(10).default(5),
  analyzeText: z.boolean().default(true), analyzeMedia: z.boolean().default(false), backgroundUpdates: z.boolean().default(true),
  theme: z.enum(['system', 'light', 'dark']).default('system'), density: z.enum(['comfortable', 'compact']).default('comfortable')
})
export type Settings = z.infer<typeof settingsSchema>

export type SavedAtlasAPI = {
  getState(): Promise<AppState>; getSetupState(): Promise<SetupState>; completeSetup(): Promise<void>;
  searchMessages(input: SearchQuery): Promise<SearchResult>;
  syncFull(): Promise<z.infer<typeof syncResultSchema>>; syncIncremental(): Promise<z.infer<typeof syncResultSchema>>;
  syncPause(): Promise<void>; syncResume(): Promise<void>; syncCancel(): Promise<void>; getSyncProgress(): Promise<SyncProgress>;
  jobsPause(): Promise<void>; jobsResume(): Promise<void>; jobsCancel(): Promise<void>; getJobProgress(): Promise<JobProgress>;
  changeTopic(input: z.input<typeof topicChangeSchema>): Promise<void>; removeTopic(input: z.input<typeof messageIdSchema>): Promise<void>; changeTags(input: z.input<typeof tagsChangeSchema>): Promise<void>; bulkMove(input: z.input<typeof bulkTopicSchema>): Promise<void>; saveNote(input: z.input<typeof noteSchema>): Promise<void>;
  recheckFreshness(input: z.input<typeof messageIdSchema>): Promise<void>; hideMessage(input: z.input<typeof messageIdSchema>): Promise<void>; restoreMessage(input: z.input<typeof messageIdSchema>): Promise<void>;
  createCategory(input: z.input<typeof categoryCreateSchema>): Promise<number>; createTopic(input: z.input<typeof topicCreateSchema>): Promise<number>; updateTopic(input: z.input<typeof topicUpdateSchema>): Promise<void>; mergeTopics(input: z.input<typeof topicMergeSchema>): Promise<void>; archiveTopic(input: z.input<typeof topicArchiveSchema>): Promise<void>; getTopicProposals(): Promise<TopicProposal[]>; resolveTopicProposal(input: z.input<typeof proposalResolveSchema>): Promise<void>;
  enterDemo(): Promise<void>; resetDemo(): Promise<void>; exitDemo(): Promise<void>; saveCredentials(input: z.input<typeof credentialsSchema>): Promise<void>;
  credentialsStatus(): Promise<{ telegram: boolean; router: boolean }>;
  saveTelegramCredentials(input: z.input<typeof telegramCredentialsSchema>): Promise<void>; saveRouterSettings(input: z.input<typeof routerSettingsSchema>): Promise<void>;
  telegramSendCode(input: z.input<typeof phoneSchema>): Promise<AuthState>; telegramSubmitCode(input: z.input<typeof loginCodeSchema>): Promise<AuthState>;
  telegramSubmitPassword(input: z.input<typeof passwordSchema>): Promise<AuthState>; telegramCancelAuth(): Promise<void>;
  testRouter(): Promise<{ ok: boolean; message: string }>; getSettings(): Promise<Settings>; saveSettings(input: Settings): Promise<Settings>;
  exportJson(): Promise<string | null>; exportTopicMarkdown(topicId: number): Promise<string | null>; openExternal(url: string): Promise<void>; resetData(): Promise<void>;
  revealDatabase(): Promise<void>; revealPrototypeBackup(): Promise<void>; acknowledgePrototypeBackup(): Promise<void>; deletePrototypeBackup(): Promise<void>; quit(): Promise<void>;
  deleteSecrets(kind: 'telegram' | 'router' | 'all'): Promise<void>
}
