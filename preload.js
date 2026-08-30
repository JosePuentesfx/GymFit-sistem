const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gymApi', {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close'),

  // Terminal controls
  toggleTerminal:    ()  => ipcRenderer.send('terminal:toggle'),
  terminalIsVisible: ()  => ipcRenderer.invoke('terminal:isVisible'),

  // DB
  getData: () => ipcRenderer.invoke('db:get'),

  // Auth
  login:          data => ipcRenderer.invoke('auth:login', data),
  logout:         ()   => ipcRenderer.invoke('session:logout'),
  changePassword: data => ipcRenderer.invoke('user:changePassword', data),

  // Users / Staff
  addUser:       data   => ipcRenderer.invoke('user:add', data),
  toggleUser:    userId => ipcRenderer.invoke('user:toggle', userId),
  resetPassword: data   => ipcRenderer.invoke('user:resetPassword', data),

  // Members
  addMember:    data => ipcRenderer.invoke('member:add', data),
  updateMember: data => ipcRenderer.invoke('member:update', data),
  deleteMember: id   => ipcRenderer.invoke('member:delete', id),

  // Payments
  addPayment:    data => ipcRenderer.invoke('payment:add', data),
  deletePayment: id   => ipcRenderer.invoke('payment:delete', id),

  // Access
  verifyAccess:  biometricId => ipcRenderer.invoke('access:verify', biometricId),
  clearAccessLog: ()          => ipcRenderer.invoke('access:clearLog'),

  // Plans & config
  updatePlans: plans  => ipcRenderer.invoke('plans:update', plans),
  updateGym:   config => ipcRenderer.invoke('gym:update', config),

  // Data / export
  exportCsv: type => ipcRenderer.invoke('data:exportCsv', { type }),
  backup:    ()   => ipcRenderer.invoke('data:backup'),
  restore:   ()   => ipcRenderer.invoke('data:restore'),
  getStats:  ()   => ipcRenderer.invoke('data:stats'),
});
