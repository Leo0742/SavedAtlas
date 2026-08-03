import { createHash } from 'node:crypto'

const urlPattern = /https?:\/\/[^\s<>(){}"']+/giu
const secretPatterns = [
  /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
  /\b([a-f\d]{32})\b/gi,
  /\b(Bearer\s+[A-Za-z0-9._~-]{10,})\b/gi,
  /\b(password|пароль|token|токен|api[_ -]?key)\s*[:=]\s*\S+/gi
]

export function normalizeContent(text: string, caption = ''): string {
  return `${text}\n${caption}`.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/^ +/gm, '').replace(/\n{3,}/g, '\n\n').trim()
}

export function extractUrls(value: string): string[] {
  return [...new Set((value.match(urlPattern) ?? []).map((url) => url.replace(/[.,;:!?]+$/, '')))]
}

export function contentHash(value: string): string {
  return createHash('sha256').update(value.normalize('NFC')).digest('hex')
}

export function redactSecrets(value: string): string {
  return secretPatterns.reduce((result, pattern) => result.replace(pattern, '[СКРЫТО]'), value)
}

export function normalizeTopicName(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/(?:искусственному|искусственного|искусственный)\s+интеллекту?/giu, 'ии').replace(/\bai\b/giu, 'ии').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function shouldCheckFreshness(value: string): boolean {
  const candidates = /\b(курс|набор|регистрац|сервис|приложени|библиотек|фреймворк|модел[ьи]|релиз|верси|мероприяти|ваканси|скидк|цен[аы]|закон|расписани|продукт|доступен|закрыл|обновлен|https?:\/\/)/iu
  const evergreen = /^(заметка|идея|цитата|доказательство|теорема|личное):/iu
  return !evergreen.test(value.trim()) && candidates.test(value)
}

export function isFreshnessCacheValid(cache:{checkedAt:string|null;expiresAt:string|null;contentHash:string;modelId:string;promptVersion:string},expected:{contentHash:string;modelId:string;promptVersion:string},now=new Date()):boolean{
  return Boolean(cache.checkedAt&&cache.expiresAt&&new Date(cache.expiresAt)>now&&cache.contentHash===expected.contentHash&&cache.modelId===expected.modelId&&cache.promptVersion===expected.promptVersion)
}

export function safeJsonRepair(value: string): unknown {
  const fenced = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('JSON object not found')
  return JSON.parse(fenced.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1'))
}
