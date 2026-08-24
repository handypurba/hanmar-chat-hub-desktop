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

  accounts: {
    list: (channel) => ipcRenderer.invoke('accounts:list', channel),
    add: (channel, label) => ipcRenderer.invoke('accounts:add', { channel, label }),
    remove: (channel, accountId) => ipcRenderer.invoke('accounts:remove', { channel, accountId }),
    rename: (channel, accountId, label) => ipcRenderer.invoke('accounts:rename', { channel, accountId, label }),
    reorder: (channel, orderedIds) => ipcRenderer.invoke('accounts:reorder', { channel, orderedIds }),
  },

  wa: {
    start: (accountId) => ipcRenderer.invoke('wa:start', accountId),
    getChats: (accountId) => ipcRenderer.invoke('wa:get-chats', accountId),
    getMessages: (accountId, chatId) => ipcRenderer.invoke('wa:get-messages', { accountId, chatId }),
    sendMessage: (accountId, chatId, text) => ipcRenderer.invoke('wa:send-message', { accountId, chatId, text }),
    markRead: (accountId, chatId) => ipcRenderer.invoke('wa:mark-read', { accountId, chatId }),
    getAvatar: (accountId, chatId) => ipcRenderer.invoke('wa:get-avatar', { accountId, chatId }),
    logout: (accountId) => ipcRenderer.invoke('wa:logout', accountId),
    onQr: (cb) => subscribe('wa:qr', cb),
    onStatus: (cb) => subscribe('wa:status', cb),
    onChats: (cb) => subscribe('wa:chats', cb),
    onMessage: (cb) => subscribe('wa:message', cb),
  },

  tg: {
    hasToken: (accountId) => ipcRenderer.invoke('tg:has-token', accountId),
    start: (accountId, token) => ipcRenderer.invoke('tg:start', { accountId, token }),
    getChats: (accountId) => ipcRenderer.invoke('tg:get-chats', accountId),
    getMessages: (accountId, chatId) => ipcRenderer.invoke('tg:get-messages', { accountId, chatId }),
    sendMessage: (accountId, chatId, text) => ipcRenderer.invoke('tg:send-message', { accountId, chatId, text }),
    markRead: (accountId, chatId) => ipcRenderer.invoke('tg:mark-read', { accountId, chatId }),
    getAvatar: (accountId, chatId) => ipcRenderer.invoke('tg:get-avatar', { accountId, chatId }),
    disconnect: (accountId) => ipcRenderer.invoke('tg:disconnect', accountId),
    onStatus: (cb) => subscribe('tg:status', cb),
    onChats: (cb) => subscribe('tg:chats', cb),
    onMessage: (cb) => subscribe('tg:message', cb),
  },
});
