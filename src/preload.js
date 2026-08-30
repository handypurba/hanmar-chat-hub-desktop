const { contextBridge, ipcRenderer } = require('electron');

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
    getChannelOrder: (defaultOrder) => ipcRenderer.invoke('accounts:getChannelOrder', defaultOrder),
    setChannelOrder: (order) => ipcRenderer.invoke('accounts:setChannelOrder', order),
  },

  // Channel "Bisnis (dibagikan)" -- disimpan di server, kelihatan sama di
  // semua device akun ini. Beda dari `accounts` di atas (channel "Pribadi",
  // tetap lokal per device).
  sharedAccounts: {
    list: () => ipcRenderer.invoke('sharedAccounts:list'),
    add: (channel, label) => ipcRenderer.invoke('sharedAccounts:add', { channel, label }),
    rename: (id, label) => ipcRenderer.invoke('sharedAccounts:rename', { id, label }),
    remove: (channel, id) => ipcRenderer.invoke('sharedAccounts:remove', { channel, id }),
    reorder: (orderedIds) => ipcRenderer.invoke('sharedAccounts:reorder', orderedIds),
  },

  // WhatsApp & Telegram: keduanya embed web resmi (web.whatsapp.com /
  // web.telegram.org) lewat WebContentsView di proses main — renderer cuma
  // kendalikan tampil/sembunyi & laporkan posisi area kontennya.
  webembed: {
    show: (channel, accountId) => ipcRenderer.invoke('webembed:show', { channel, accountId }),
    hide: (channel, accountId) => ipcRenderer.invoke('webembed:hide', { channel, accountId }),
    hideActive: () => ipcRenderer.invoke('webembed:hide-active'),
    setBounds: (bounds) => ipcRenderer.invoke('webembed:set-bounds', bounds),
    openExternal: (channel) => ipcRenderer.invoke('webembed:open-external', channel),
  },

  // Badge unread di sidebar — dipanggil main process tiap judul halaman
  // channel berubah (lihat web-embed.js: 'page-title-updated').
  onUnreadChanged: (callback) => {
    ipcRenderer.on('unread-changed', (_event, payload) => callback(payload));
  },
});
