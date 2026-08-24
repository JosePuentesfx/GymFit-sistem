const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('accessApi', {
  // Access validation
  verifyAccess: biometricId => ipcRenderer.invoke('access:verify', biometricId),
  getData:      ()          => ipcRenderer.invoke('db:get'),

  // Window controls for terminal
  minimize:         () => ipcRenderer.send('terminal:minimize'),
  close:            () => ipcRenderer.send('terminal:close'),
  toggleFullscreen: () => ipcRenderer.send('terminal:fullscreen'),

  // Listen for live updates pushed from main window
  onDbUpdate: cb => ipcRenderer.on('db:updated', () => cb()),
});
