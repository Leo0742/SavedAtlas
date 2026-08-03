import { dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { authStateSchema, credentialsSchema, loginCodeSchema, noteSchema, passwordSchema, phoneSchema, querySchema, routerSettingsSchema, telegramCredentialsSchema, topicChangeSchema } from '../shared/contracts'
import type { SavedAtlasDatabase } from './database'
import type { RouterAIService } from './services/routerai'
import type { SecretStore } from './services/security'
import type { SyncService } from './services/sync'
import type { TelegramService } from './services/telegram'

type Services={db:SavedAtlasDatabase;secrets:SecretStore;router:RouterAIService;telegram:TelegramService;sync:SyncService}
const urlSchema=z.string().url().refine((value)=>['https:','tg:'].includes(new URL(value).protocol),'Недопустимая ссылка')
function handle<T>(channel:string,fn:(input:T)=>unknown|Promise<unknown>):void{ipcMain.handle(channel,(_event,input:T)=>fn(input))}
export function registerIpc(s:Services):void{
  handle('state:get',()=>s.db.getState());handle('messages:search',(input)=>s.db.search(querySchema.parse(input)));handle('demo:seed',()=>s.db.seedDemo())
  handle('message:topic',(input)=>{const v=topicChangeSchema.parse(input);s.db.changeTopic(v.messageId,v.topicId)});handle('message:note',(input)=>{const v=noteSchema.parse(input);s.db.saveNote(v.messageId,v.note)})
  handle('credentials:save',(input)=>{const v=credentialsSchema.parse(input);s.secrets.set({telegramApiId:Number(v.apiId),telegramApiHash:v.apiHash,routerKey:v.routerKey,classificationModel:v.classificationModel,freshnessModel:v.freshnessModel});s.telegram.configure(Number(v.apiId),v.apiHash);s.router.configure(v.routerKey,v.classificationModel,v.freshnessModel)})
  handle('credentials:telegram',(input)=>{const v=telegramCredentialsSchema.parse(input);s.secrets.set({telegramApiId:Number(v.apiId),telegramApiHash:v.apiHash});s.telegram.configure(Number(v.apiId),v.apiHash)})
  handle('credentials:router',(input)=>{const v=routerSettingsSchema.parse(input);s.secrets.set(v);s.router.configure(v.routerKey,v.classificationModel,v.freshnessModel)})
  handle('credentials:status',()=>s.secrets.status());handle('telegram:send-code',async(input)=>authStateSchema.parse(await s.telegram.sendCode(phoneSchema.parse(input).phone)))
  handle('telegram:submit-code',async(input)=>{const result=authStateSchema.parse(await s.telegram.submitCode(loginCodeSchema.parse(input).code));if(result.state==='authorized')s.secrets.set({telegramSession:s.telegram.session()});return result})
  handle('telegram:submit-password',async(input)=>{const result=authStateSchema.parse(await s.telegram.submitPassword(passwordSchema.parse(input).password));if(result.state==='authorized')s.secrets.set({telegramSession:s.telegram.session()});return result})
  handle('telegram:cancel',()=>s.telegram.cancel());handle('router:test',()=>s.router.test());handle('sync:run',()=>s.sync.run(false))
  handle('external:open',(input)=>shell.openExternal(urlSchema.parse(input)))
  handle('data:export',async()=>{const result=await dialog.showSaveDialog({title:'Экспорт SavedAtlas',defaultPath:'savedatlas-export.json',filters:[{name:'JSON',extensions:['json']}]});if(result.canceled||!result.filePath)return null;await writeFile(result.filePath,JSON.stringify(s.db.exportData(),null,2),{encoding:'utf8',mode:0o600});return result.filePath})
  handle('data:reset',()=>s.db.clearUserData())
  handle('credentials:delete',(input)=>{const kind=z.enum(['telegram','router','all']).parse(input);if(kind==='telegram')s.secrets.delete(['telegramApiId','telegramApiHash','telegramSession']);else if(kind==='router')s.secrets.delete(['routerKey','classificationModel','freshnessModel']);else s.secrets.delete()})
}
