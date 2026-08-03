import { afterEach,describe,expect,it } from 'vitest'
import { mkdtempSync,rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SavedAtlasDatabase } from '../src/main/database'

const dirs:string[]=[]
function makeDb(){const dir=mkdtempSync(join(tmpdir(),'savedatlas-test-'));dirs.push(dir);return new SavedAtlasDatabase(join(dir,'test.sqlite'))}
afterEach(()=>{while(dirs.length)rmSync(dirs.pop()!,{recursive:true,force:true})})

describe('SQLite data layer',()=>{
  it('runs migrations and seeds at least 20 realistic demo messages',()=>{const db=makeDb();db.seedDemo();const state=db.getState();expect(state.dashboard.total).toBeGreaterThanOrEqual(20);expect(state.topics.some(t=>t.name==='Курсы по ИИ')).toBe(true);db.close()})
  it('searches messages with FTS5',()=>{const db=makeDb();db.seedDemo();expect(db.search({query:'Pydantic',limit:10,offset:0})[0].text).toContain('Pydantic');db.close()})
  it('detects incremental unchanged and edited messages by hash',()=>{const db=makeDb();const base={telegramMessageId:99,date:new Date().toISOString(),editDate:null,text:'Первая версия',caption:'',mediaType:'text',sourceTitle:'Test',sourceUsername:null,sourcePublicUrl:null,rawJson:'{}'};expect(db.importMessage(base)).toBe('added');expect(db.importMessage(base)).toBe('unchanged');expect(db.importMessage({...base,text:'Новая версия'})).toBe('updated');db.close()})
  it('keeps manual topic when an edited message is imported for reanalysis',()=>{const db=makeDb();db.seedDemo();const message=db.getState().messages[0];db.changeTopic(message.id,2);db.importMessage({telegramMessageId:message.telegramMessageId,date:message.date,editDate:new Date().toISOString(),text:`${message.text} обновлено`,caption:'',mediaType:'text',sourceTitle:message.sourceTitle,sourceUsername:null,sourcePublicUrl:null,rawJson:'{}'});expect(db.search({limit:5,offset:0}).find(m=>m.id===message.id)?.topicId).toBe(2);expect(db.search({limit:5,offset:0}).find(m=>m.id===message.id)?.isManual).toBe(true);db.close()})
  it('recovers running jobs on startup safely',()=>{const db=makeDb();expect(db.recoverJobs()).toBe(0);db.close()})
  it('exports no credential-shaped fields',()=>{const db=makeDb();db.seedDemo();const text=JSON.stringify(db.exportData());expect(text).not.toMatch(/api_hash|routerKey|telegramSession|authorization/i);db.close()})
})
