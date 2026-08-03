import { contextBridge, ipcRenderer } from 'electron'
import type { SavedAtlasAPI } from '../shared/contracts'

const api:SavedAtlasAPI={
  getState:()=>ipcRenderer.invoke('state:get'),search:(input)=>ipcRenderer.invoke('messages:search',input),sync:()=>ipcRenderer.invoke('sync:run'),
  changeTopic:(input)=>ipcRenderer.invoke('message:topic',input),saveNote:(input)=>ipcRenderer.invoke('message:note',input),seedDemo:()=>ipcRenderer.invoke('demo:seed'),
  saveCredentials:(input)=>ipcRenderer.invoke('credentials:save',input),saveTelegramCredentials:(input)=>ipcRenderer.invoke('credentials:telegram',input),saveRouterSettings:(input)=>ipcRenderer.invoke('credentials:router',input),credentialsStatus:()=>ipcRenderer.invoke('credentials:status'),
  telegramSendCode:(input)=>ipcRenderer.invoke('telegram:send-code',input),telegramSubmitCode:(input)=>ipcRenderer.invoke('telegram:submit-code',input),telegramSubmitPassword:(input)=>ipcRenderer.invoke('telegram:submit-password',input),telegramCancelAuth:()=>ipcRenderer.invoke('telegram:cancel'),
  testRouter:()=>ipcRenderer.invoke('router:test'),exportJson:()=>ipcRenderer.invoke('data:export'),openExternal:(url)=>ipcRenderer.invoke('external:open',url),resetData:()=>ipcRenderer.invoke('data:reset'),deleteSecrets:(kind)=>ipcRenderer.invoke('credentials:delete',kind)
}
contextBridge.exposeInMainWorld('savedAtlas',api)

declare global { interface Window { savedAtlas: SavedAtlasAPI } }
