import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

type SecretPayload = { telegramApiId?: number; telegramApiHash?: string; telegramSession?: string; routerKey?: string; classificationModel?: string; freshnessModel?: string }

export class SecretStore {
  constructor(private readonly path: string) {}
  private read(): SecretPayload {
    if (!existsSync(this.path)) return {}
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Защищённое хранилище macOS недоступно')
    return JSON.parse(safeStorage.decryptString(readFileSync(this.path))) as SecretPayload
  }
  get(): SecretPayload { return this.read() }
  private write(value:SecretPayload):void{
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Защищённое хранилище macOS недоступно')
    mkdirSync(dirname(this.path), { recursive: true })
    const encrypted = safeStorage.encryptString(JSON.stringify(value))
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, encrypted, { mode: 0o600 })
    renameSync(temporary, this.path)
  }
  set(patch: Partial<SecretPayload>): void { this.write({ ...this.read(), ...patch }) }
  delete(keys?: (keyof SecretPayload)[]): void {
    if (!keys) { this.write({}); return }
    const value = this.read(); for (const key of keys) delete value[key]; this.write(value)
  }
  status(): { telegram: boolean; router: boolean } { const value = this.read(); return { telegram: Boolean(value.telegramApiId && value.telegramApiHash && value.telegramSession), router: Boolean(value.routerKey) } }
}

const redactionPatterns = [/sk-[A-Za-z0-9_-]{8,}/g, /Bearer\s+\S+/gi, /\b[a-f\d]{32}\b/gi, /\b\d{5,8}\b/g]
export function redactTechnicalDetails(value: unknown): string {
  return redactionPatterns.reduce((result, pattern) => result.replace(pattern, '[СКРЫТО]'), value instanceof Error ? `${value.name}: ${value.message}` : String(value))
}
