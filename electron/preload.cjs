const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('teiki', {
  getList: () => ipcRenderer.invoke('teiki:get-list'),
  startLogin: () => ipcRenderer.invoke('teiki:start-login'),
  onLoginStatus: (cb) => ipcRenderer.on('teiki:login-status', (_e, data) => cb(data)),

  runPlan: (entries, dryRun) => ipcRenderer.invoke('teiki:run-plan', { entries, dryRun }),
  onRunProgress: (cb) => ipcRenderer.on('teiki:run-progress', (_e, data) => cb(data)),

  resetBrowser: () => ipcRenderer.invoke('teiki:reset-browser'),
  openChromeDownload: () => ipcRenderer.invoke('teiki:open-chrome-download'),
  openLogsFolder: () => ipcRenderer.invoke('teiki:open-logs-folder'),
  openOutFolder: () => ipcRenderer.invoke('teiki:open-out-folder'),

  onCloseRequested: (cb) => ipcRenderer.on('teiki:close-requested', () => cb()),
  forceQuit: () => ipcRenderer.invoke('teiki:force-quit'),
});
