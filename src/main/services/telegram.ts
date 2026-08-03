import { Api, TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import bigInt from 'big-integer'
import type { AuthState } from '../../shared/contracts'
import type { EnrichedTelegramMessage } from './sync'

type Resolver = { resolve: (value: string) => void; reject: (error: Error) => void }
type Signal = { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }
const signal = (): Signal => { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const timeout = (milliseconds: number): Promise<never> => new Promise((_, reject) => setTimeout(() => reject(new Error('AUTH_TIMEOUT')), milliseconds))

export class TelegramService {
  private client: TelegramClient | null = null
  private phone = ''
  private codeResolver: Resolver | null = null
  private passwordResolver: Resolver | null = null
  private authPromise: Promise<void> | null = null
  private generation = 0
  private state: AuthState = { state: 'idle' }

  configure(apiId: number, apiHash: string, session = ''): void {
    this.cancel(); this.client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5, retryDelay: 1200, useWSS: true }); this.state = { state: 'idle' }
  }
  async connect(): Promise<void> { if (!this.client) throw new Error('Telegram API не настроен'); await this.client.connect() }
  async isAuthorized(): Promise<boolean> {
    if (!this.client) return false
    try { await this.client.connect(); const authorized = await this.client.checkAuthorization(); this.state = { state: authorized ? 'authorized' : 'idle' }; return authorized }
    catch { this.state = { state: 'error', message: 'Не удалось проверить Telegram-сессию.' }; return false }
  }
  getAuthState(): AuthState { return { ...this.state } }

  async sendCode(phone: string): Promise<AuthState> {
    if (!this.client) throw new Error('Сначала сохраните api_id и api_hash')
    this.cancel(); this.phone = phone; const current = ++this.generation; const requested = signal(); this.state = { state: 'requesting_code' }
    this.authPromise = this.client.start({
      phoneNumber: async () => this.phone,
      phoneCode: async () => {
        if (current !== this.generation) throw new Error('AUTH_CANCELLED')
        this.state = { state: 'code_sent', message: 'Код отправлен в Telegram.' }; requested.resolve()
        return new Promise<string>((resolve, reject) => { this.codeResolver = { resolve, reject } })
      },
      password: async () => {
        if (current !== this.generation) throw new Error('AUTH_CANCELLED')
        this.state = { state: 'password_required', message: 'Введите пароль двухэтапной проверки.' }
        return new Promise<string>((resolve, reject) => { this.passwordResolver = { resolve, reject } })
      },
      onError: (error) => {
        const mapped = this.mapError(error)
        this.state = mapped
        if (mapped.state === 'error' || mapped.state === 'expired' || mapped.state === 'additional_verification') requested.reject(new Error(mapped.message ?? 'AUTH_ERROR'))
      }
    }).then(() => { this.state = { state: 'authorized' } }).catch((error: Error) => {
      if (current === this.generation && !/AUTH_CANCELLED/.test(error.message)) this.state = this.mapError(error)
      throw error
    })
    this.authPromise.catch(() => undefined)
    try { await Promise.race([requested.promise, this.authPromise, timeout(30000)]); return this.getAuthState() }
    catch (error) { if (/AUTH_TIMEOUT/.test((error as Error).message)) this.cancel(); return /AUTH_TIMEOUT/.test((error as Error).message) ? { state: 'error', message: 'Telegram не ответил за 30 секунд. Повторите запрос.' } : this.getAuthState() }
  }

  async submitCode(code: string): Promise<AuthState> {
    if (!this.codeResolver || !this.authPromise) return { state: 'error', message: 'Сначала запросите код.' }
    this.codeResolver.resolve(code); this.codeResolver = null
    return this.waitForTransition(['authorized', 'password_required', 'code_sent', 'expired', 'additional_verification', 'error'], 30000)
  }
  async submitPassword(password: string): Promise<AuthState> {
    if (!this.passwordResolver || !this.authPromise) return { state: 'error', message: 'Пароль сейчас не запрошен.' }
    this.passwordResolver.resolve(password); this.passwordResolver = null
    return this.waitForTransition(['authorized', 'password_required', 'additional_verification', 'error'], 30000)
  }
  cancel(): void {
    this.generation += 1; const error = new Error('AUTH_CANCELLED'); this.codeResolver?.reject(error); this.passwordResolver?.reject(error)
    this.codeResolver = null; this.passwordResolver = null; this.authPromise = null; this.state = { state: 'cancelled' }
  }
  async destroy(): Promise<void> {
    this.cancel()
    const client = this.client
    this.client = null
    this.phone = ''
    if (client) { try { await client.disconnect() } catch { /* already disconnected */ } }
    this.state = { state: 'idle' }
  }
  session(): string { return this.client ? String((this.client.session as StringSession).save()) : '' }

  async fetchSavedPage(offsetId: number, limit = 100): Promise<EnrichedTelegramMessage[]> {
    if (!this.client) throw new Error('Telegram не настроен'); await this.client.connect()
    if (!await this.client.checkAuthorization()) { this.state = { state: 'idle', message: 'Telegram-сессия недействительна.' }; throw new Error('AUTH_KEY_UNREGISTERED') }
    const result = await this.client.invoke(new Api.messages.GetHistory({ peer: 'me', offsetId, offsetDate: 0, addOffset: 0, limit, maxId: 0, minId: 0, hash: bigInt.zero }))
    const entities = new Map<string, any>()
    for (const entity of [...(('chats' in result ? result.chats : []) ?? []), ...(('users' in result ? result.users : []) ?? [])]) entities.set(String(entity.id), entity)
    if (!('messages' in result)) return []
    return result.messages.filter((message): message is Api.Message => message instanceof Api.Message).map((message) => {
      const fwd = message.fwdFrom as any; const peer = fwd?.fromId ?? fwd?.savedFromPeer; const peerId = peer?.channelId ?? peer?.chatId ?? peer?.userId
      const entity = peerId != null ? entities.get(String(peerId)) : undefined
      const username = entity?.username ?? null; const title = entity?.title ?? ([entity?.firstName, entity?.lastName].filter(Boolean).join(' ') || null)
      const isChannel = Boolean(peer?.channelId); const isUser = Boolean(peer?.userId); const publicUrl = isChannel && username && fwd?.channelPost ? `https://t.me/${username}/${fwd.channelPost}` : null
      return Object.assign(message, { savedAtlasSource: fwd ? { peerId: peerId == null ? null : String(peerId), messageId: fwd.channelPost ?? fwd.savedFromMsgId ?? null, title: title ?? fwd.fromName ?? 'Приватный источник', username, type: isChannel ? (username ? 'public_channel' : 'private_channel') : isUser ? 'user' : fwd.fromName ? 'hidden_author' : 'private_forward', publicUrl, originalPostDate: fwd.date ? new Date(fwd.date * 1000).toISOString() : null, forwardingMetadata: { importedFromSavedMessages: true, hiddenAuthor: fwd.fromName ?? null } } : undefined })
    })
  }

  private async waitForTransition(accepted: AuthState['state'][], milliseconds: number): Promise<AuthState> {
    const started = Date.now()
    while (Date.now() - started < milliseconds) {
      if (accepted.includes(this.state.state) && this.state.state !== 'code_sent') return this.getAuthState()
      if (this.state.state === 'code_sent' && this.codeResolver) return this.getAuthState()
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return { state: 'error', message: 'Telegram не завершил проверку вовремя.' }
  }
  private mapError(error: Error): AuthState {
    const message = error.message.toUpperCase(); const wait = /FLOOD_WAIT_(\d+)/.exec(message)
    if (wait) return { state: 'error', message: `Telegram просит подождать ${wait[1]} сек.`, floodWaitSeconds: Number(wait[1]) }
    if (/PHONE_CODE_INVALID/.test(message)) return { state: 'code_sent', message: 'Неверный код. Попробуйте ещё раз.' }
    if (/PHONE_CODE_EXPIRED/.test(message)) return { state: 'expired', message: 'Срок действия кода истёк. Запросите новый.' }
    if (/PASSWORD_HASH_INVALID/.test(message)) return { state: 'password_required', message: 'Неверный пароль.' }
    if (/EMAIL_UNCONFIRMED|SIGNUP_REQUIRED|PHONE_NUMBER_UNOCCUPIED/.test(message)) return { state: 'additional_verification', message: 'Telegram требует дополнительную проверку, которая пока не поддерживается.' }
    if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|AUTH_KEY_INVALID/.test(message)) return { state: 'idle', message: 'Telegram-сессия недействительна. Войдите снова.' }
    if (/AUTH_CANCELLED/.test(message)) return { state: 'cancelled' }
    return { state: 'error', message: 'Ошибка подключения к Telegram.' }
  }
}
