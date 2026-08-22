const { contextBridge, ipcRenderer } = require('electron');

// Jembatan aman antara proses main dan renderer. Renderer cuma boleh
// memanggil fungsi ini, tidak pernah pegang token atau akses Node langsung.
contextBridge.exposeInMainWorld('hanmar', {
  checkSession: () => ipcRenderer.invoke('session:check'),
  register: (data) => ipcRenderer.invoke('auth:register', data),
  login: (data) => ipcRenderer.invoke('auth:login', data),
  logout: () => ipcRenderer.invoke('auth:logout'),
});
