const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('icut', {
  // dialogs / fs
  openMediaDialog: () => ipcRenderer.invoke('dialog:open-media'),
  saveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts),
  openProjectDialog: () => ipcRenderer.invoke('dialog:open-project'),
  chooseFile: (opts) => ipcRenderer.invoke('dialog:choose-file', opts),
  pathForFile: (file) => webUtils.getPathForFile(file),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),
  writePng: (p, data) => ipcRenderer.invoke('fs:write-png', { path: p, data }),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  // media
  importMedia: (items) => ipcRenderer.invoke('media:import', items),
  refreshAssets: (o) => ipcRenderer.invoke('media:refresh-assets', o),
  onMediaUpdate: on('media:update'),
  // project
  saveProject: (path, data) => ipcRenderer.invoke('project:save', { path, data }),
  loadProject: (path) => ipcRenderer.invoke('project:load', path),
  syncProject: (p) => ipcRenderer.send('project:sync', p),
  setDirty: (d) => ipcRenderer.send('project:dirty', d),
  // export
  exportStart: (opts) => ipcRenderer.invoke('export:start', opts),
  exportFrame: (buf) => ipcRenderer.invoke('export:frame', buf),
  exportFinish: () => ipcRenderer.invoke('export:finish'),
  exportCancel: () => ipcRenderer.invoke('export:cancel'),
  exportWcStart: (o) => ipcRenderer.invoke('export:wc-start', o),
  exportWcChunk: (o) => ipcRenderer.invoke('export:wc-chunk', o),
  exportWcFinish: (o) => ipcRenderer.invoke('export:wc-finish', o),
  exportWcCancel: () => ipcRenderer.invoke('export:wc-cancel'),
  // claude
  agentSend: (payload) => ipcRenderer.invoke('agent:send', payload),
  agentInterrupt: () => ipcRenderer.invoke('agent:interrupt'),
  agentReset: () => ipcRenderer.invoke('agent:reset'),
  agentSetModel: (o) => ipcRenderer.invoke('agent:set-model', o),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  sessionTranscript: (id) => ipcRenderer.invoke('sessions:transcript', id),
  sessionContinue: (id) => ipcRenderer.invoke('sessions:continue', id),
  agentSetBypass: (on) => ipcRenderer.invoke('agent:set-bypass', on),
  agentSetProvider: (p) => ipcRenderer.invoke('agent:set-provider', p),
  providerStatus: (p) => ipcRenderer.invoke('providers:status', p),
  providerLogin: (p) => ipcRenderer.invoke('providers:login', p),
  providerCancelLogin: () => ipcRenderer.invoke('providers:cancel-login'),
  providerInstall: (p) => ipcRenderer.invoke('providers:install', p),
  engineTool: (name, args) => ipcRenderer.invoke('engine:tool', { name, args }),
  providerModels: (p) => ipcRenderer.invoke('providers:models', p),
  onExternalAgents: on('agents:external'),
  permissionReply: (r) => ipcRenderer.send('agent:permission-reply', r),
  onAgentEvent: on('agent:event'),
  onToolActivity: on('agent:tool-activity'),
  onRelayStatus: on('relay:status'),
  onToolInvoke: on('tool:invoke'),
  toolResult: (id, result) => ipcRenderer.send('tool:result', { id, result }),
  // settings / app
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  appInfo: () => ipcRenderer.invoke('app:info'),
  downloadWhisper: (name) => ipcRenderer.invoke('whisper:download', name),
  onWhisperProgress: on('whisper:progress'),
  onToast: on('app:toast'),
  onCompositionProgress: on('composition:progress'),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authLogin: (o) => ipcRenderer.invoke('auth:login', o || {}),
  authCancel: () => ipcRenderer.invoke('auth:cancel'),
  onAuthOutput: on('auth:output'),
  devtools: () => ipcRenderer.send('win:devtools'),
  reload: () => ipcRenderer.send('win:reload'),
});
