import { Api } from 'telegram'
import type { SyncProgress } from '../../shared/contracts'
import type { ImportedMessage, SavedAtlasDatabase } from '../database'
import type { TelegramService } from './telegram'
import { redactTechnicalDetails } from './security'

type SourceInfo = { peerId: string | null; messageId: number | null; title: string; username: string | null; type: string; publicUrl: string | null; originalPostDate: string | null; forwardingMetadata: Record<string, unknown> }
export type EnrichedTelegramMessage = Api.Message & { savedAtlasSource?: SourceInfo }

const isoDate = (timestamp: number | undefined): string | null => timestamp ? new Date(timestamp * 1000).toISOString() : null
const bigintString = (value: unknown): string | null => value == null ? null : String(value)

function entityJson(message: Api.Message): unknown[] {
  return (message.entities ?? []).map((entity) => typeof (entity as { toJSON?: () => unknown }).toJSON === 'function' ? (entity as { toJSON: () => unknown }).toJSON() : { type: entity.className, offset: entity.offset, length: entity.length })
}

function mediaMetadata(message: Api.Message): Record<string, unknown> {
  const media = message.media as (Api.TypeMessageMedia & { document?: { mimeType?: string; size?: unknown; attributes?: Array<{ className?: string; fileName?: string; duration?: number; w?: number; h?: number }> } }) | undefined
  const document = media && 'document' in media ? media.document : undefined
  const attributes = document?.attributes ?? []
  const filename = attributes.find((item) => item.className === 'DocumentAttributeFilename')?.fileName
  const dimensions = attributes.find((item) => typeof item.w === 'number' && typeof item.h === 'number')
  const duration = attributes.find((item) => typeof item.duration === 'number')?.duration
  return { className: media?.className ?? null, mimeType: document?.mimeType ?? null, filename: filename ?? null, size: bigintString(document?.size), width: dimensions?.w ?? null, height: dimensions?.h ?? null, duration: duration ?? null }
}

function detectMedia(message: Api.Message): string {
  const name = message.media?.className?.toLowerCase() ?? ''
  if (name.includes('photo')) return 'photo'
  if (name.includes('poll')) return 'poll'
  if (name.includes('webpage')) return 'webpage'
  if (name.includes('document')) {
    const mime = String(mediaMetadata(message).mimeType ?? '')
    if (mime === 'application/pdf') return 'pdf'
    if (mime.startsWith('audio/')) return 'audio'
    if (mime.startsWith('video/')) return 'video'
    if (mime.startsWith('image/')) return 'image'
    return 'document'
  }
  return 'text'
}

export function extractTelegramMessage(message: EnrichedTelegramMessage): ImportedMessage {
  const fwd = message.fwdFrom as (Api.MessageFwdHeader & { fromName?: string; channelPost?: number; date?: number }) | undefined
  const source = message.savedAtlasSource
  const hiddenAuthor = fwd?.fromName
  const sourceType = source?.type ?? (hiddenAuthor ? 'hidden_author' : fwd ? 'private_forward' : 'personal_note')
  const sourceTitle = source?.title ?? hiddenAuthor ?? (fwd ? 'Приватный источник' : 'Личная заметка')
  const raw = { id: message.id, date: message.date, editDate: message.editDate, groupedId: bigintString(message.groupedId), peerId: message.peerId?.toJSON?.(), fwdFrom: fwd?.toJSON?.(), media: mediaMetadata(message) }
  return {
    telegramMessageId: message.id, date: isoDate(message.date) ?? new Date(0).toISOString(), editDate: isoDate(message.editDate),
    originalPostDate: source?.originalPostDate ?? isoDate(fwd?.date), text: message.media ? '' : (message.message ?? ''),
    caption: message.media ? (message.message ?? '') : '', entities: entityJson(message), mediaType: detectMedia(message),
    mediaMetadata: mediaMetadata(message), groupedId: bigintString(message.groupedId), sourcePeerId: source?.peerId ?? bigintString(fwd?.fromId && JSON.stringify(fwd.fromId.toJSON?.() ?? fwd.fromId)),
    sourceMessageId: source?.messageId ?? fwd?.channelPost ?? null, sourceTitle, sourceUsername: source?.username ?? null,
    sourceType, sourcePublicUrl: source?.publicUrl ?? null, forwardingMetadata: source?.forwardingMetadata ?? { hiddenAuthor: hiddenAuthor ?? null },
    rawJson: JSON.stringify(raw, (_key, value) => typeof value === 'bigint' ? value.toString() : value).slice(0, 32000)
  }
}

const initialProgress = (): SyncProgress => ({ mode: null, state: 'idle', pages: 0, fetched: 0, added: 0, updated: 0, skipped: 0, latestKnownId: 0, checkpointOffset: 0, error: null })

export class SyncService {
  private cancelled = false
  private paused = false
  private progress: SyncProgress = initialProgress()
  private active: Promise<{ added: number; updated: number; skipped: number; failed: number }> | null = null
  constructor(
    private readonly telegram: Pick<TelegramService, 'fetchSavedPage'>,
    private readonly db: SavedAtlasDatabase,
    private readonly options: { sleep?: (milliseconds: number) => Promise<void>; onProgress?: (progress: SyncProgress) => void } = {}
  ) {}

  getProgress(): SyncProgress { return { ...this.progress } }
  pause(): void { this.paused = true; if (this.progress.state === 'running') this.update({ state: 'paused' }) }
  resume(): void { this.paused = false; if (this.progress.state === 'paused') this.update({ state: 'running' }) }
  cancel(): void { this.cancelled = true; this.paused = false }
  runFull(): Promise<{ added: number; updated: number; skipped: number; failed: number }> { return this.start('full') }
  runIncremental(): Promise<{ added: number; updated: number; skipped: number; failed: number }> { return this.start('incremental') }
  run(full = false): Promise<{ added: number; updated: number; skipped: number; failed: number }> { return this.start(full ? 'full' : 'incremental') }

  private start(mode: 'full' | 'incremental'): Promise<{ added: number; updated: number; skipped: number; failed: number }> {
    if (this.active) return this.active
    this.active = this.runMode(mode).finally(() => { this.active = null })
    return this.active
  }

  private async runMode(mode: 'full' | 'incremental'): Promise<{ added: number; updated: number; skipped: number; failed: number }> {
    this.cancelled = false; this.paused = false
    const checkpoint = this.db.getSyncCheckpoint(); const baseline = checkpoint.lastKnownMessageId
    let offset = mode === 'full' && !checkpoint.fullSyncComplete ? checkpoint.currentOffset : 0
    const overlapTarget = this.db.getSettings().syncOverlap
    let overlapSeen = 0; let failed = 0; let newest = baseline; let repeatedPages = 0; let previousFingerprint = ''
    this.progress = { ...initialProgress(), mode, state: 'running', latestKnownId: baseline, checkpointOffset: offset }
    this.emit()
    while (!this.cancelled) {
      await this.waitWhilePaused()
      if (this.cancelled) break
      let page: EnrichedTelegramMessage[]
      try { page = await this.telegram.fetchSavedPage(offset, 100) as EnrichedTelegramMessage[] }
      catch (error) {
        const wait = Number(/FLOOD_WAIT_(\d+)/.exec(error instanceof Error ? error.message : '')?.[1] ?? 0)
        if (wait > 0) { await this.interruptibleSleep(wait * 1000); continue }
        failed += 1; this.update({ state: 'failed', error: redactTechnicalDetails(error) }); break
      }
      if (!page.length) break
      const ids = page.map((item) => item.id); const fingerprint = ids.join(',')
      if (fingerprint === previousFingerprint) repeatedPages += 1; else repeatedPages = 0
      previousFingerprint = fingerprint
      const unique = [...new Map(page.map((item) => [item.id, item])).values()]
      for (const message of unique) {
        newest = Math.max(newest, message.id)
        const imported = this.db.importMessage(extractTelegramMessage(message))
        if (imported === 'added') this.progress.added += 1
        else if (imported === 'updated') this.progress.updated += 1
        else this.progress.skipped += 1
        if (mode === 'incremental' && message.id <= baseline) overlapSeen += 1
      }
      this.progress.pages += 1; this.progress.fetched += unique.length
      const oldest = Math.min(...ids)
      offset = oldest
      this.progress.latestKnownId = newest; this.progress.checkpointOffset = offset
      this.db.updateSyncCheckpoint(newest, offset, 'running', mode, { baseline, overlapSeen })
      this.emit()
      if (page.length < 100) break
      if (mode === 'incremental' && overlapSeen >= overlapTarget) break
      if (repeatedPages >= 2) { failed += 1; this.update({ state: 'failed', error: 'Telegram вернул повторяющуюся страницу.' }); break }
    }
    if (this.cancelled) { this.db.updateSyncCheckpoint(newest, offset, 'cancelled', mode, { baseline, overlapSeen }); this.update({ state: 'cancelled' }) }
    else if (!failed) { this.db.markSyncComplete(mode, newest); this.update({ state: 'complete', checkpointOffset: 0 }) }
    return { added: this.progress.added, updated: this.progress.updated, skipped: this.progress.skipped, failed }
  }

  private update(patch: Partial<SyncProgress>): void { this.progress = { ...this.progress, ...patch }; this.emit() }
  private emit(): void { this.options.onProgress?.(this.getProgress()) }
  private async waitWhilePaused(): Promise<void> { while (this.paused && !this.cancelled) await this.interruptibleSleep(50) }
  private async interruptibleSleep(milliseconds: number): Promise<void> {
    const sleep = this.options.sleep ?? ((duration: number) => new Promise<void>((resolve) => setTimeout(resolve, duration)))
    let remaining = milliseconds
    while (remaining > 0 && !this.cancelled) { const slice = Math.min(remaining, 1000); await sleep(slice); remaining -= slice }
  }
}
