import { app, BrowserWindow, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { join } from 'node:path'
import log from 'electron-log/main'
import { SavedAtlasDatabase } from './database'
import { registerIpc } from './ipc'
import { RouterAIService } from './services/routerai'
import { SecretStore, redactTechnicalDetails } from './services/security'
import { SyncService } from './services/sync'
import { TelegramService } from './services/telegram'
import { JobRunner } from './services/job-runner'
import { E2ERouterService, E2ESecretStore, E2ETelegramService } from './services/e2e-mocks'

let db:SavedAtlasDatabase|undefined
function createWindow():void{
  const window=new BrowserWindow({width:1512,height:982,minWidth:1120,minHeight:720,title:'SavedAtlas',titleBarStyle:'hiddenInset',backgroundColor:'#f8f9fb',show:false,webPreferences:{preload:join(__dirname,'../preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}})
  window.once('ready-to-show',()=>window.show());window.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))void shell.openExternal(url);return{action:'deny'}});window.webContents.on('will-navigate',(event,url)=>{const current=window.webContents.getURL();if(url!==current)event.preventDefault()})
  if(is.dev&&process.env['ELECTRON_RENDERER_URL'])void window.loadURL(process.env['ELECTRON_RENDERER_URL']);else void window.loadFile(join(__dirname,'../renderer/index.html'))
}
app.whenReady().then(async()=>{
  electronApp.setAppUserModelId('app.savedatlas.desktop');app.on('browser-window-created',(_,window)=>optimizer.watchWindowShortcuts(window))
  log.initialize();log.transports.file.maxSize=2*1024*1024;log.transports.file.format='[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';const original=log.error;log.error=(...args:unknown[])=>original(...args.map(redactTechnicalDetails))
  const e2eMode=process.env['SAVEDATLAS_E2E']==='1';if(e2eMode&&process.env['SAVEDATLAS_E2E_DATA_DIR'])app.setPath('userData',process.env['SAVEDATLAS_E2E_DATA_DIR']);const dataPath=app.getPath('userData');db=new SavedAtlasDatabase(join(dataPath,'savedatlas.sqlite'));db.recoverJobs();const secrets=e2eMode?new E2ESecretStore():new SecretStore(join(dataPath,'secrets.enc'));const telegram=e2eMode?new E2ETelegramService():new TelegramService();const router=e2eMode?new E2ERouterService():new RouterAIService()
  try{const value=secrets.get();if(value.telegramApiId&&value.telegramApiHash){telegram.configure(value.telegramApiId,value.telegramApiHash,value.telegramSession??'');db.setConnectionState({telegramConfigured:true,telegramAuthorized:await telegram.isAuthorized()})}else db.setConnectionState({telegramConfigured:false,telegramAuthorized:false});if(value.routerKey){const classificationModel=value.classificationModel??'openai/gpt-4o-mini';const freshnessModel=value.freshnessModel??'openai/gpt-4o-mini';router.configure(value.routerKey,classificationModel,freshnessModel);db.setAnalysisModels(classificationModel,freshnessModel);db.setConnectionState({routerConfigured:true})}else db.setConnectionState({routerConfigured:false,routerTested:false})}catch(error){log.error(error)}
  const jobs=new JobRunner(db,router as RouterAIService);const sync=new SyncService(telegram as TelegramService,db);registerIpc({db,secrets:secrets as SecretStore,telegram:telegram as TelegramService,router:router as RouterAIService,sync,jobs});void jobs.start();if(db.getSettings().backgroundUpdates&&db.getSetupState().complete)void sync.runIncremental().then(()=>jobs.start());createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})
}).catch((error)=>log.error(error))
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});app.on('before-quit',()=>db?.close())
