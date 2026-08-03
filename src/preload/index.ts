import { contextBridge, ipcRenderer } from 'electron'
import type { SavedAtlasAPI } from '../shared/contracts'

const api: SavedAtlasAPI = {
  getState: () => ipcRenderer.invoke('state:get'), getSetupState: () => ipcRenderer.invoke('setup:get'), completeSetup: () => ipcRenderer.invoke('setup:complete'),
  searchMessages: (input) => ipcRenderer.invoke('messages:search', input),
  syncFull: () => ipcRenderer.invoke('sync:full'), syncIncremental: () => ipcRenderer.invoke('sync:incremental'), syncPause: () => ipcRenderer.invoke('sync:pause'), syncResume: () => ipcRenderer.invoke('sync:resume'), syncCancel: () => ipcRenderer.invoke('sync:cancel'), getSyncProgress: () => ipcRenderer.invoke('sync:progress'),
  jobsPause: () => ipcRenderer.invoke('jobs:pause'), jobsResume: () => ipcRenderer.invoke('jobs:resume'), jobsCancel: () => ipcRenderer.invoke('jobs:cancel'), getJobProgress: () => ipcRenderer.invoke('jobs:progress'),
  changeTopic: (input) => ipcRenderer.invoke('message:topic', input), removeTopic: (input) => ipcRenderer.invoke('message:topic-remove', input), changeTags: (input) => ipcRenderer.invoke('message:tags', input), bulkMove: (input) => ipcRenderer.invoke('message:bulk-topic', input), saveNote: (input) => ipcRenderer.invoke('message:note', input), recheckFreshness: (input) => ipcRenderer.invoke('message:recheck', input), hideMessage: (input) => ipcRenderer.invoke('message:hide', input), restoreMessage: (input) => ipcRenderer.invoke('message:restore', input),
  createCategory: (input) => ipcRenderer.invoke('category:create', input), createTopic: (input) => ipcRenderer.invoke('topic:create', input), updateTopic: (input) => ipcRenderer.invoke('topic:update', input), mergeTopics: (input) => ipcRenderer.invoke('topic:merge', input), archiveTopic: (input) => ipcRenderer.invoke('topic:archive', input), getTopicProposals: () => ipcRenderer.invoke('proposal:list'), resolveTopicProposal: (input) => ipcRenderer.invoke('proposal:resolve', input),
  enterDemo: () => ipcRenderer.invoke('demo:enter'), resetDemo: () => ipcRenderer.invoke('demo:reset'), exitDemo: () => ipcRenderer.invoke('demo:exit'),
  saveCredentials: (input) => ipcRenderer.invoke('credentials:save', input), saveTelegramCredentials: (input) => ipcRenderer.invoke('credentials:telegram', input), saveRouterSettings: (input) => ipcRenderer.invoke('credentials:router', input), credentialsStatus: () => ipcRenderer.invoke('credentials:status'),
  telegramSendCode: (input) => ipcRenderer.invoke('telegram:send-code', input), telegramSubmitCode: (input) => ipcRenderer.invoke('telegram:submit-code', input), telegramSubmitPassword: (input) => ipcRenderer.invoke('telegram:submit-password', input), telegramCancelAuth: () => ipcRenderer.invoke('telegram:cancel'),
  testRouter: () => ipcRenderer.invoke('router:test'), getSettings: () => ipcRenderer.invoke('settings:get'), saveSettings: (input) => ipcRenderer.invoke('settings:save', input),
  exportJson: () => ipcRenderer.invoke('data:export'), exportTopicMarkdown: (topicId) => ipcRenderer.invoke('data:export-topic', topicId), openExternal: (url) => ipcRenderer.invoke('external:open', url), resetData: () => ipcRenderer.invoke('data:reset'),
  revealDatabase: () => ipcRenderer.invoke('data:reveal'), revealPrototypeBackup: () => ipcRenderer.invoke('prototype:reveal'), acknowledgePrototypeBackup: () => ipcRenderer.invoke('prototype:ack'), deletePrototypeBackup: () => ipcRenderer.invoke('prototype:delete'), quit: () => ipcRenderer.invoke('app:quit'), deleteSecrets: (kind) => ipcRenderer.invoke('credentials:delete', kind)
}
contextBridge.exposeInMainWorld('savedAtlas', api)
declare global { interface Window { savedAtlas: SavedAtlasAPI } }
