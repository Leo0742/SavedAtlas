import { Api } from 'telegram'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { AuthState } from '../../shared/contracts'
import type { EnrichedTelegramMessage } from './sync'

export class E2ESecretStore {
  private value: Record<string, unknown>
  constructor(private readonly filePath: string) {
    try { this.value = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown> } catch { this.value = {} }
  }
  private persist(): void { writeFileSync(this.filePath, JSON.stringify(this.value), { encoding: 'utf8', mode: 0o600 }) }
  get(): any { return { ...this.value } }
  set(patch: Record<string, unknown>): void { this.value = { ...this.value, ...patch }; this.persist() }
  delete(keys?: string[]): void { if (!keys) this.value = {}; else for (const key of keys) delete this.value[key]; this.persist() }
  status(): { telegram: boolean; router: boolean } { return { telegram: Boolean(this.value.telegramSession), router: Boolean(this.value.routerKey) } }
}

const makeMessage = (id: number): EnrichedTelegramMessage => new Api.Message({ id, peerId: new Api.PeerUser({ userId: BigInt(1) as any }), date: 1_700_000_000 + id, message: id === 251 ? 'Искомая запись за пределами первых пятидесяти' : `Mock Saved Message ${id}`, out: false, mentioned: false, mediaUnread: false, silent: false, post: false, fromScheduled: false, legacy: false, editHide: false, pinned: false, noforwards: false } as any) as EnrichedTelegramMessage

export class E2ETelegramService {
  private authorized = false
  private readonly messages = Array.from({ length: 260 }, (_, index) => makeMessage(260 - index))
  constructor(private readonly failureMarker: string | null = null) {}
  configure(_apiId?: number, _apiHash?: string, session = ''): void { this.authorized = Boolean(session) }
  async isAuthorized(): Promise<boolean> { return this.authorized }
  async sendCode(): Promise<AuthState> { return { state: 'code_sent', message: 'Mock code sent.' } }
  async submitCode(code?: string): Promise<AuthState> { if (code === '22222') return { state: 'password_required' }; this.authorized = true; return { state: 'authorized' } }
  async submitPassword(): Promise<AuthState> { this.authorized = true; return { state: 'authorized' } }
  cancel(): void {}
  async destroy(): Promise<void> { this.authorized = false }
  session(): string { return 'mock-session' }
  async fetchSavedPage(offset: number, limit: number): Promise<EnrichedTelegramMessage[]> {
    await new Promise((resolve) => setTimeout(resolve, 80))
    if (this.failureMarker && offset > 0 && !existsSync(this.failureMarker)) { writeFileSync(this.failureMarker, 'failed-once', { mode: 0o600 }); throw new Error('E2E_SIMULATED_NETWORK_FAILURE') }
    const start = offset === 0 ? 0 : this.messages.findIndex((message) => message.id < offset)
    return start < 0 ? [] : this.messages.slice(start, start + limit)
  }
}

export class E2ERouterService {
  configure(): void {}
  clear(): void {}
  async test(): Promise<{ ok: boolean; message: string }> { return { ok: true, message: 'Mock RouterAI connected.' } }
  async classify(input: { id: number }) {
    if (input.id === 3) throw new Error('E2E_PERMANENT_CLASSIFICATION_FAILURE')
    const proposal = input.id === 1
    const freshness = input.id === 2
    return { value: { message_id: input.id, summary: `Mock summary ${input.id}`, content_type: 'note', category: { existing_id: null, proposed_name: proposal ? 'E2E Category' : null, confidence: .95 }, primary_topic: { existing_id: null, proposed_name: proposal ? 'E2E Proposed Topic' : null, proposed_description: proposal ? 'Packaged proposal fixture' : null, confidence: .95 }, tags: ['mock'], language: 'ru', freshness_check_needed: freshness, freshness_reason: freshness ? 'Time-dependent E2E fixture' : '', suggested_search_query: freshness ? 'SavedAtlas current release' : null, needs_review: proposal }, annotations: [], usage: { inputTokens: 10, outputTokens: 5, cost: 0 } }
  }
  async checkFreshness() { return { value: { status: 'current', verdict: 'E2E material is current.', reason: 'Verified by packaged fixture.', confidence: .94, checked_at: new Date().toISOString(), recommended_recheck_days: 30, alternatives: [{ name: 'E2E Alternative', why: 'Newer option', url: 'https://example.com/alternative', limitations: 'Fixture only', supporting_source_url: 'https://example.com/source' }], citations: [{ title: 'E2E Source', url: 'https://example.com/source', claim: 'Current release' }] }, annotations: [{ title: 'E2E Source', url: 'https://example.com/source' }], usage: { inputTokens: 8, outputTokens: 4, cost: 0 } } }
}
