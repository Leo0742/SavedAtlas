import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { Api } from 'telegram'
import bigInt from 'big-integer'

type AuthResolver = { resolve: (value: string) => void; reject: (error: Error) => void }
export type TelegramAuthState = { state: 'idle'|'code_sent'|'password_required'|'authorized'|'cancelled'|'error'; message?: string; floodWaitSeconds?: number }

export class TelegramService {
  private client: TelegramClient | null = null
  private phone = ''
  private codeResolver: AuthResolver | null = null
  private passwordResolver: AuthResolver | null = null
  private authPromise: Promise<void> | null = null
  configure(apiId: number, apiHash: string, session = ''): void { this.client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5, retryDelay: 1200, useWSS: true }) }
  async connect(): Promise<void> { if (!this.client) throw new Error('Telegram API не настроен'); await this.client.connect() }
  async isAuthorized(): Promise<boolean> { if (!this.client) return false; await this.client.connect(); return this.client.checkAuthorization() }
  async sendCode(phone: string): Promise<TelegramAuthState> {
    if (!this.client) throw new Error('Сначала сохраните api_id и api_hash'); this.phone = phone
    this.authPromise = this.client.start({ phoneNumber: async () => this.phone, phoneCode: async () => new Promise<string>((resolve,reject)=>{this.codeResolver={resolve,reject}}), password: async () => new Promise<string>((resolve,reject)=>{this.passwordResolver={resolve,reject}}), onError: (error) => { if (!/SESSION_PASSWORD_NEEDED/i.test(error.message)) console.warn('Telegram authorization error:', error.constructor.name) } }).then(()=>undefined)
    await new Promise((resolve)=>setTimeout(resolve,800))
    return { state: this.codeResolver ? 'code_sent' : 'error', message: this.codeResolver ? 'Код отправлен в Telegram.' : 'Не удалось запросить код.' }
  }
  async submitCode(code: string): Promise<TelegramAuthState> {
    if (!this.codeResolver || !this.authPromise) return { state:'error',message:'Сначала запросите код.' }
    this.codeResolver.resolve(code); this.codeResolver=null
    const outcome = await Promise.race([this.authPromise.then(()=> 'authorized' as const).catch((e:Error)=>({error:e})), new Promise<'pending'>((r)=>setTimeout(()=>r('pending'),1000))])
    if (outcome==='authorized') return {state:'authorized'}
    if (outcome==='pending' && this.passwordResolver) return {state:'password_required',message:'Введите пароль двухэтапной проверки.'}
    if (outcome==='pending') return {state:'code_sent',message:'Telegram ожидает подтверждение.'}
    return this.mapError(outcome.error)
  }
  async submitPassword(password:string):Promise<TelegramAuthState>{ if(!this.passwordResolver||!this.authPromise)return{state:'error',message:'Пароль сейчас не запрошен.'};this.passwordResolver.resolve(password);this.passwordResolver=null;try{await this.authPromise;return{state:'authorized'}}catch(e){return this.mapError(e as Error)} }
  cancel():void { this.codeResolver?.reject(new Error('AUTH_CANCELLED')); this.passwordResolver?.reject(new Error('AUTH_CANCELLED')); this.codeResolver=null;this.passwordResolver=null;this.authPromise=null }
  session():string { if (!this.client) return ''; return (this.client.session as StringSession).save() as unknown as string }
  async fetchSavedPage(offsetId: number, limit = 100): Promise<Api.Message[]> {
    if (!this.client) throw new Error('Telegram не настроен'); await this.client.connect()
    const result = await this.client.invoke(new Api.messages.GetHistory({ peer:'me', offsetId, offsetDate:0, addOffset:0, limit, maxId:0, minId:0, hash:bigInt.zero }))
    return 'messages' in result ? result.messages.filter((message):message is Api.Message => message instanceof Api.Message) : []
  }
  private mapError(error:Error):TelegramAuthState { const wait=/FLOOD_WAIT_(\d+)/.exec(error.message); if(wait)return{state:'error',message:`Telegram просит подождать ${wait[1]} сек.`,floodWaitSeconds:Number(wait[1])}; if(/PHONE_CODE_INVALID/.test(error.message))return{state:'code_sent',message:'Неверный код. Попробуйте ещё раз.'};if(/PHONE_CODE_EXPIRED/.test(error.message))return{state:'error',message:'Срок действия кода истёк. Запросите новый.'};if(/PASSWORD_HASH_INVALID/.test(error.message))return{state:'password_required',message:'Неверный пароль.'};return{state:'error',message:'Ошибка подключения к Telegram.'} }
}
