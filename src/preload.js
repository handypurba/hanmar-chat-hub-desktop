const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Jembatan aman antara proses main dan renderer. Renderer cuma boleh
// memanggil fungsi ini, tidak pernah pegang token atau akses Node langsung.
contextBridge.exposeInMainWorld('hanmar', {
  checkSession: () => ipcRenderer.invoke('session:check'),
  register: (data) => ipcRenderer.invoke('auth:register', data),
  login: (data) => ipcRenderer.invoke('auth:login', data),
  logout: () => ipcRenderer.invoke('auth:logout'),

  wa: {
    start: () => ipcRenderer.invoke('wa:start'),
    getChats: () => ipcRenderer.invoke('wa:get-chats'),
    getMessages: (chatId) => ipcRenderer.invoke('wa:get-messages', chatId),
    sendMessage: (chatId, text) => ipcRenderer.invoke('wa:send-message', { chatId, text }),
    logout: () => ipcRenderer.invoke('wa:logout'),
    onQr: (cb) => subscribe('wa:qr', cb),
    onStatus: (cb) => subscribe('wa:status', cb),
    onChats: (cb) => subscribe('wa:chats', cb),
    onMessage: (cb) => subscribe('wa:message', cb),
  },

  tg: {
    hasToken: () => ipcRenderer.invoke('tg:has-token'),
    start: (token) => ipcRenderer.invoke('tg:start', token),
    getChats: () => ipcRenderer.invoke('tg:get-chats'),
    getMessages: (chatId) => ipcRenderer.invoke('tg:get-messages', chatId),
    sendMessage: (chatId, text) => ipcRenderer.invoke('tg:send-message', { chatId, text }),
    disconnect: () => ipcRenderer.invoke('tg:disconnect'),
    onStatus: (cb) => subscribe('tg:status', cb),
    onChats: (cb) => subscribe('tg:chats', cb),
    onMessage: (cb) => subscribe('tg:message', cb),
  },
});
