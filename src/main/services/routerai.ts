import OpenAI from 'openai'
import { classificationResponseSchema, freshnessResponseSchema } from '../../shared/contracts'
import { redactSecrets, safeJsonRepair } from './content'

export class RouterAIService {
  private client: OpenAI | null = null
  private classificationModel = 'openai/gpt-4o-mini'
  private freshnessModel = 'openai/gpt-4o-mini'
  configure(key: string, classificationModel: string, freshnessModel: string): void {
    this.client = new OpenAI({ apiKey: key, baseURL: 'https://routerai.ru/api/v1' })
    this.classificationModel = classificationModel; this.freshnessModel = freshnessModel
  }
  async test(): Promise<{ ok: boolean; message: string }> {
    if (!this.client) return { ok: false, message: 'Сначала сохраните ключ RouterAI.' }
    try { await this.client.models.list(); return { ok: true, message: 'Подключение к RouterAI работает.' } }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message.replace(/sk-[A-Za-z0-9_-]+/g, '[СКРЫТО]') : 'Не удалось подключиться.' } }
  }
  async classify(input: { id: number; content: string; source: string; date: string; categories: unknown[]; topics: unknown[] }) {
    if (!this.client) throw new Error('RouterAI не настроен')
    const completion = await this.client.chat.completions.create({ model: this.classificationModel, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Классифицируй сохранённое сообщение. Переиспользуй существующие темы, не создавай дубликаты. Верни только JSON по заданной схеме.' }, { role: 'user', content: JSON.stringify({ ...input, content: redactSecrets(input.content) }) }] })
    const raw = completion.choices[0]?.message.content ?? '{}'
    return classificationResponseSchema.parse(safeJsonRepair(raw))
  }
  async checkFreshness(input: { content: string; query: string; maxResults?: number }) {
    if (!this.client) throw new Error('RouterAI не настроен')
    const body: any = { model: this.freshnessModel, temperature: 0, response_format: { type: 'json_object' }, plugins: [{ id: 'web', max_results: input.maxResults ?? 5, search_prompt: 'Ищи актуальные надёжные сведения. Предпочитай официальные сайты, документацию, репозитории и release notes.' }], messages: [{ role: 'system', content: 'Проверь актуальность материала. Возраст сообщения сам по себе не означает устаревание. Не выдумывай закрытия, альтернативы и источники. Верни строгий JSON.' }, { role: 'user', content: JSON.stringify({ material: redactSecrets(input.content), search_query: input.query }) }] }
    const completion = await this.client.chat.completions.create(body)
    return freshnessResponseSchema.parse(safeJsonRepair(completion.choices[0]?.message.content ?? '{}'))
  }
}
