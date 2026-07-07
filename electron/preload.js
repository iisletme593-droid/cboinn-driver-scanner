// Secure bridge between the sandboxed renderer and the main process.
// The renderer never touches Node/child_process directly — only this API.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('engine', {
  // Run an engine operation; resolves when status.json reports done (or fails).
  //   mode: 'Inventory' | 'Scan' | 'SysInfo' | 'SoftwareScan'
  //       | 'Install' | 'SoftwareInstall' | 'BackupDrivers'
  //   opts: { updateIds?, wingetIds?, backupDir?, createRestorePoint? }
  run: (mode, opts) => ipcRenderer.invoke('engine:run', mode, opts),

  // Read a JSON file from the state dir on demand (e.g. cached results).
  read: (file) => ipcRenderer.invoke('engine:read', file),

  // Cancel the active operation.
  cancel: () => ipcRenderer.invoke('engine:cancel'),

  // Absolute path of the state directory.
  stateDir: () => ipcRenderer.invoke('engine:stateDir'),

  // Subscribe to live progress. Returns an unsubscribe function.
  onProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('engine:progress', handler);
    return () => ipcRenderer.removeListener('engine:progress', handler);
  },

  // Subscribe to background (scheduled) scan completions. Returns unsubscribe.
  onBackgroundResult: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('engine:background', handler);
    return () => ipcRenderer.removeListener('engine:background', handler);
  },

  // Read the worker log tail (text).
  readLog: () => ipcRenderer.invoke('engine:readLog'),
});

contextBridge.exposeInMainWorld('app', {
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  isElevated: () => ipcRenderer.invoke('app:isElevated'),
  relaunchAsAdmin: () => ipcRenderer.invoke('app:relaunchAsAdmin'),
  downloadAndInstall: () => ipcRenderer.invoke('app:downloadAndInstall'),
  aiDiagnose: (summary) => ipcRenderer.invoke('app:aiDiagnose', summary),
  saveReport: (html) => ipcRenderer.invoke('app:saveReport', html),
  notify: (title, body) => ipcRenderer.invoke('app:notify', title, body),
  historyRead: () => ipcRenderer.invoke('app:historyRead'),
  historyAppend: (entry) => ipcRenderer.invoke('app:historyAppend', entry),
  scheduleStatus: () => ipcRenderer.invoke('app:scheduleStatus'),
  scheduleCreate: (intervalHours) => ipcRenderer.invoke('app:scheduleCreate', intervalHours),
  scheduleRemove: () => ipcRenderer.invoke('app:scheduleRemove'),
});

contextBridge.exposeInMainWorld('sys', {
  openExternal: (url) => ipcRenderer.invoke('sys:openExternal', url),
  openPath: (p) => ipcRenderer.invoke('sys:openPath', p),
  pickFile: (filters) => ipcRenderer.invoke('sys:pickFile', filters),
});

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (s) => ipcRenderer.invoke('settings:set', s),
  export: () => ipcRenderer.invoke('settings:export'),
  import: () => ipcRenderer.invoke('settings:import'),
});
