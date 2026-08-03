import { app, BrowserWindow, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { join } from 'node:path'
import log from 'electron-log/main'
import { SavedAtlasDatabase } from './database'
import { registerIpc } from './ipc'
import { RouterAIService } from './services/routerai'
import { SecretStore, redactTechnicalDetails } from './services/security'
import { SyncService } from './services/sync'
import { AnalysisService } from './services/analysis'
import { TelegramService } from './services/telegram'

let db:SavedAtlasDatabase|undefined
function createWindow():void{
  const window=new BrowserWindow({width:1512,height:982,minWidth:1120,minHeight:720,title:'SavedAtlas',titleBarStyle:'hiddenInset',backgroundColor:'#f8f9fb',show:false,webPreferences:{preload:join(__dirname,'../preload/index.mjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}})
  window.once('ready-to-show',()=>window.show());window.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))void shell.openExternal(url);return{action:'deny'}});window.webContents.on('will-navigate',(event,url)=>{const current=window.webContents.getURL();if(url!==current)event.preventDefault()})
  if(is.dev&&process.env['ELECTRON_RENDERER_URL'])void window.loadURL(process.env['ELECTRON_RENDERER_URL']);else void window.loadFile(join(__dirname,'../renderer/index.html'))
}
app.whenReady().then(()=>{
  electronApp.setAppUserModelId('app.savedatlas.desktop');app.on('browser-window-created',(_,window)=>optimizer.watchWindowShortcuts(window))
  log.initialize();log.transports.file.maxSize=2*1024*1024;log.transports.file.format='[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';const original=log.error;log.error=(...args:unknown[])=>original(...args.map(redactTechnicalDetails))
  const dataPath=app.getPath('userData');db=new SavedAtlasDatabase(join(dataPath,'savedatlas.sqlite'));db.recoverJobs();const secrets=new SecretStore(join(dataPath,'secrets.enc'));const telegram=new TelegramService();const router=new RouterAIService()
  try{const value=secrets.get();if(value.telegramApiId&&value.telegramApiHash)telegram.configure(value.telegramApiId,value.telegramApiHash,value.telegramSession??'');if(value.routerKey)router.configure(value.routerKey,value.classificationModel??'openai/gpt-4o-mini',value.freshnessModel??'openai/gpt-4o-mini')}catch(error){log.error(error)}
  registerIpc({db,secrets,telegram,router,sync:new SyncService(telegram,db,new AnalysisService(db,router))});createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})
}).catch((error)=>log.error(error))
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});app.on('before-quit',()=>db?.close())
