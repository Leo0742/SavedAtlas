import OpenAI from 'openai'
import { ZodError, type ZodType } from 'zod'
import { classificationResponseSchema, freshnessResponseSchema } from '../../shared/contracts'
import { redactSecrets, safeJsonRepair } from './content'

export type RouterAnnotation = { title: string; url: string; startIndex?: number; endIndex?: number }
type AttemptRecorder = (operation: string, attempt: number, outcome: string, errorCode?: string) => void

const classificationJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['message_id', 'summary', 'content_type', 'category', 'primary_topic', 'tags', 'language', 'freshness_check_needed', 'freshness_reason', 'suggested_search_query', 'needs_review'],
  properties: {
    message_id: { type: 'integer' }, summary: { type: 'string' }, content_type: { type: 'string' },
    category: { type: 'object', additionalProperties: false, required: ['existing_id', 'proposed_name', 'confidence'], properties: { existing_id: { type: ['integer', 'null'] }, proposed_name: { type: ['string', 'null'] }, confidence: { type: 'number', minimum: 0, maximum: 1 } } },
    primary_topic: { type: 'object', additionalProperties: false, required: ['existing_id', 'proposed_name', 'proposed_description', 'confidence'], properties: { existing_id: { type: ['integer', 'null'] }, proposed_name: { type: ['string', 'null'] }, proposed_description: { type: ['string', 'null'] }, confidence: { type: 'number', minimum: 0, maximum: 1 } } },
    tags: { type: 'array', maxItems: 3, items: { type: 'string' } }, language: { type: 'string' }, freshness_check_needed: { type: 'boolean' }, freshness_reason: { type: 'string' }, suggested_search_query: { type: ['string', 'null'] }, needs_review: { type: 'boolean' }
  }
} as const

const freshnessJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['status', 'verdict', 'reason', 'confidence', 'checked_at', 'recommended_recheck_days', 'alternatives', 'citations'],
  properties: {
    status: { type: 'string', enum: ['current', 'outdated', 'superseded', 'unavailable', 'evergreen', 'uncertain'] }, verdict: { type: 'string' }, reason: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, checked_at: { type: 'string' }, recommended_recheck_days: { type: 'integer', minimum: 1, maximum: 365 },
    alternatives: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'why', 'url', 'limitations', 'supporting_source_url'], properties: { name: { type: 'string' }, why: { type: 'string' }, url: { type: 'string' }, limitations: { type: 'string' }, supporting_source_url: { type: ['string', 'null'] } } } },
    citations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'url', 'claim'], properties: { title: { type: 'string' }, url: { type: 'string' }, claim: { type: 'string' } } } }
  }
} as const

export function parseRouterAnnotations(message: unknown): RouterAnnotation[] {
  const candidate = message as { annotations?: unknown[]; citations?: unknown[] }
  const values = [...(Array.isArray(candidate?.annotations) ? candidate.annotations : []), ...(Array.isArray(candidate?.citations) ? candidate.citations : [])]
  const result: RouterAnnotation[] = []
  for (const value of values) {
    const item = value as any; const citation = item?.url_citation ?? item?.urlCitation ?? item
    const url = citation?.url
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) continue
    result.push({ title: String(citation.title ?? url), url, startIndex: Number.isInteger(citation.start_index ?? citation.startIndex) ? Number(citation.start_index ?? citation.startIndex) : undefined, endIndex: Number.isInteger(citation.end_index ?? citation.endIndex) ? Number(citation.end_index ?? citation.endIndex) : undefined })
  }
  return [...new Map(result.map((item) => [item.url, item])).values()]
}

export class RouterAIService {
  private client: OpenAI | null = null
  private classificationModel = 'openai/gpt-4o-mini'
  private freshnessModel = 'openai/gpt-4o-mini'
  configure(key: string, classificationModel: string, freshnessModel: string): void { this.client = new OpenAI({ apiKey: key, baseURL: 'https://routerai.ru/api/v1' }); this.classificationModel = classificationModel; this.freshnessModel = freshnessModel }
  async test(): Promise<{ ok: boolean; message: string }> {
    if (!this.client) return { ok: false, message: 'Сначала сохраните ключ RouterAI.' }
    try { await this.client.models.list(); return { ok: true, message: 'Подключение к RouterAI работает.' } }
    catch { return { ok: false, message: 'RouterAI не ответил. Проверьте ключ и сеть.' } }
  }

  async classify(input: { id: number; content: string; source: string; date: string; categories: unknown[]; topics: unknown[] }, record: AttemptRecorder = () => undefined) {
    if (!this.client) throw new Error('RouterAI не настроен')
    const system = `Классифицируй сохранённое сообщение. Используй только numeric existing_id из переданного справочника. Новое имя предлагай только если нет семантически близкой темы. Не решай сам, создавать ли тему. Верни JSON строго по JSON Schema: ${JSON.stringify(classificationJsonSchema)}`
    return this.structuredRequest('classification', this.classificationModel, classificationResponseSchema, classificationJsonSchema, system, JSON.stringify({ ...input, content: redactSecrets(input.content) }), record)
  }

  async checkFreshness(input: { content: string; query: string; maxResults?: number }, record: AttemptRecorder = () => undefined) {
    if (!this.client) throw new Error('RouterAI не настроен')
    const system = `Проверь актуальность материала. Возраст сам по себе не означает устаревание. Не выдумывай источники и альтернативы. citations должны ссылаться на реально найденные URL. Верни JSON строго по JSON Schema: ${JSON.stringify(freshnessJsonSchema)}`
    return this.structuredRequest('freshness', this.freshnessModel, freshnessResponseSchema, freshnessJsonSchema, system, JSON.stringify({ material: redactSecrets(input.content), search_query: input.query }), record, [{ id: 'web', max_results: input.maxResults ?? 5, search_prompt: 'Предпочитай официальные сайты, документацию, репозитории и release notes.' }])
  }

  private async structuredRequest<T>(operation: string, model: string, schema: ZodType<T>, jsonSchema: unknown, system: string, user: string, record: AttemptRecorder, plugins?: unknown[]): Promise<{ value: T; annotations: RouterAnnotation[] }> {
    if (!this.client) throw new Error('RouterAI не настроен')
    let lastRaw = ''; let validation = ''
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const repair = attempt === 2 ? `\nИсправь предыдущий ответ. Ошибки валидации: ${validation.slice(0, 1200)}. Предыдущий JSON: ${lastRaw.slice(0, 5000)}` : attempt === 3 ? '\nЭто последняя попытка: верни только валидный объект без Markdown.' : ''
      try {
        const body: any = { model, temperature: 0, response_format: { type: 'json_schema', json_schema: { name: `savedatlas_${operation}`, strict: true, schema: jsonSchema } }, messages: [{ role: 'system', content: system + repair }, { role: 'user', content: user }] }
        if (plugins) body.plugins = plugins
        const completion = await this.client.chat.completions.create(body)
        const message = completion.choices[0]?.message as unknown
        lastRaw = (message as { content?: string })?.content ?? '{}'
        try { const value = schema.parse(JSON.parse(lastRaw)); record(operation, attempt, 'valid'); return { value, annotations: parseRouterAnnotations(message) } }
        catch {
          try { const value = schema.parse(safeJsonRepair(lastRaw)); record(operation, attempt, 'locally_repaired'); return { value, annotations: parseRouterAnnotations(message) } }
          catch (error) { validation = error instanceof ZodError ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') : 'invalid JSON'; record(operation, attempt, 'invalid', 'SCHEMA_VALIDATION') }
        }
      } catch (error) {
        const temporary = /429|5\d\d|timeout|network|rate/i.test(error instanceof Error ? error.message : '')
        record(operation, attempt, 'request_failed', temporary ? 'TEMPORARY' : 'REQUEST_ERROR')
        if (!temporary || attempt === 3) throw error
      }
    }
    throw new Error('ROUTERAI_MANUAL_REVIEW')
  }
}
