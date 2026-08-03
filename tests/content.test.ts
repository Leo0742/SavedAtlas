import { describe,expect,it } from 'vitest'
import { contentHash,extractUrls,isFreshnessCacheValid,normalizeContent,normalizeTopicName,redactSecrets,safeJsonRepair,shouldCheckFreshness } from '../src/main/services/content'
import { classificationResponseSchema,freshnessResponseSchema,querySchema } from '../src/shared/contracts'

describe('local content preparation',()=>{
  it('normalizes content without changing meaning',()=>expect(normalizeContent('  Привет   мир\r\n\r\n\r\n',' подпись ')).toBe('Привет мир\n\nподпись'))
  it('extracts and deduplicates URLs',()=>expect(extractUrls('https://a.test/x. и https://a.test/x')).toEqual(['https://a.test/x']))
  it('creates stable content hashes',()=>expect(contentHash('текст')).toBe(contentHash('текст')))
  it('masks likely secrets only in outbound text',()=>{const original='token: secretvalue sk-exampleSecret123';const redacted=redactSecrets(original);expect(redacted).not.toContain('exampleSecret123');expect(original).toContain('exampleSecret123')})
  it('normalizes duplicate AI topic names',()=>expect(normalizeTopicName('Курсы по искусственному интеллекту')).toBe('курсы по ии'))
  it('detects time-dependent content and leaves personal notes evergreen',()=>{expect(shouldCheckFreshness('Новый курс, регистрация до мая https://example.com')).toBe(true);expect(shouldCheckFreshness('Личное: идея для рассказа')).toBe(false)})
  it('repairs fenced/trailing-comma JSON once',()=>expect(safeJsonRepair('```json\n{"ok":true,}\n```')).toEqual({ok:true}))
})

describe('AI and IPC boundaries',()=>{
  it('validates classification JSON',()=>expect(classificationResponseSchema.parse({message_id:'1',summary:'Курс',content_type:'course',category:{existing_id:'1',proposed_name:null,confidence:.9},primary_topic:{existing_id:null,proposed_name:'Курсы по ИИ',proposed_description:'Обучение',confidence:.9},tags:['ИИ'],language:'ru',freshness_check_needed:true,freshness_reason:'Есть даты',suggested_search_query:'курс 2026',needs_review:false}).primary_topic.proposed_name).toBe('Курсы по ИИ'))
  it('rejects invalid confidence',()=>expect(()=>classificationResponseSchema.parse({category:{confidence:4}})).toThrow())
  it('parses freshness citations and annotations-shaped sources',()=>expect(freshnessResponseSchema.parse({status:'current',verdict:'Работает',reason:'Официальный сайт',confidence:.9,checked_at:new Date().toISOString(),recommended_recheck_days:60,alternatives:[],citations:[{title:'Документация',url:'https://example.com/docs',claim:'Поддерживается'}]}).citations).toHaveLength(1))
  it('rejects unsafe query limits at IPC boundary',()=>expect(()=>querySchema.parse({query:'x',limit:10000,offset:0})).toThrow())
})

it('invalidates freshness cache by expiry, hash, model, or prompt',()=>{const expected={contentHash:'a',modelId:'m',promptVersion:'1'};expect(isFreshnessCacheValid({checkedAt:'2026-01-01',expiresAt:'2030-01-01',...expected},expected,new Date('2026-02-01'))).toBe(true);expect(isFreshnessCacheValid({checkedAt:'2026-01-01',expiresAt:'2026-01-02',...expected},expected,new Date('2026-02-01'))).toBe(false)})
