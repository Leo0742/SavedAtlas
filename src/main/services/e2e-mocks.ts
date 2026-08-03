import { Api } from 'telegram'
import type { AuthState } from '../../shared/contracts'
import type { EnrichedTelegramMessage } from './sync'

export class E2ESecretStore {
  private value: Record<string, unknown> = {}
  get(): any { return { ...this.value } }
  set(patch: Record<string, unknown>): void { this.value = { ...this.value, ...patch } }
  delete(keys?: string[]): void { if (!keys) this.value = {}; else for (const key of keys) delete this.value[key] }
  status(): { telegram: boolean; router: boolean } { return { telegram: Boolean(this.value.telegramSession), router: Boolean(this.value.routerKey) } }
}

const makeMessage = (id: number): EnrichedTelegramMessage => new Api.Message({ id, peerId: new Api.PeerUser({ userId: BigInt(1) as any }), date: 1_700_000_000 + id, message: id === 251 ? 'Искомая запись за пределами первых пятидесяти' : `Mock Saved Message ${id}`, out: false, mentioned: false, mediaUnread: false, silent: false, post: false, fromScheduled: false, legacy: false, editHide: false, pinned: false, noforwards: false } as any) as EnrichedTelegramMessage

export class E2ETelegramService {
  private authorized = false
  private readonly messages = Array.from({ length: 260 }, (_, index) => makeMessage(260 - index))
  configure(): void { this.authorized = false }
  async isAuthorized(): Promise<boolean> { return this.authorized }
  async sendCode(): Promise<AuthState> { return { state: 'code_sent', message: 'Mock code sent.' } }
  async submitCode(): Promise<AuthState> { this.authorized = true; return { state: 'authorized' } }
  async submitPassword(): Promise<AuthState> { this.authorized = true; return { state: 'authorized' } }
  cancel(): void {}
  session(): string { return 'mock-session' }
  async fetchSavedPage(offset: number, limit: number): Promise<EnrichedTelegramMessage[]> { const start = offset === 0 ? 0 : this.messages.findIndex((message) => message.id < offset); return start < 0 ? [] : this.messages.slice(start, start + limit) }
}

export class E2ERouterService {
  configure(): void {}
  async test(): Promise<{ ok: boolean; message: string }> { return { ok: true, message: 'Mock RouterAI connected.' } }
  async classify(input: { id: number }) { return { value: { message_id: input.id, summary: `Mock summary ${input.id}`, content_type: 'note', category: { existing_id: null, proposed_name: null, confidence: .95 }, primary_topic: { existing_id: null, proposed_name: null, proposed_description: null, confidence: .95 }, tags: ['mock'], language: 'ru', freshness_check_needed: false, freshness_reason: '', suggested_search_query: null, needs_review: false }, annotations: [] } }
  async checkFreshness() { throw new Error('Freshness is not requested by the packaged fixture.') }
}
