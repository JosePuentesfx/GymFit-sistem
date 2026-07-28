const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gymApi', {
  getData: () => ipcRenderer.invoke('db:get'), login: data => ipcRenderer.invoke('auth:login', data),
  addUser: data => ipcRenderer.invoke('user:add', data), addMember: data => ipcRenderer.invoke('member:add', data),
  addPayment: data => ipcRenderer.invoke('payment:add', data), verifyAccess: biometricId => ipcRenderer.invoke('access:verify', biometricId)
});
