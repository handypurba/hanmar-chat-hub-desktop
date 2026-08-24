const { ipcMain } = require('electron');
const session = require('./session');
const api = require('./api');
const whatsapp = require('./whatsapp');
const telegram = require('./telegram');
const accountStore = require('./account-store');

/**
 * Registrasi semua handler IPC yang dipanggil renderer (lewat preload.js).
 * Token disimpan di memory proses main + file terenkripsi, TIDAK pernah
 * dikirim ke renderer supaya tidak bisa dibaca dari DevTools/renderer JS.
 */
function registerIpcHandlers(mainWindow) {
  let currentToken = session.loadToken();
  let currentUser = null;

  // Event dari main (QR baru, status koneksi, chat/pesan masuk) selalu
  // dibungkus { accountId, data } supaya renderer tahu ini punya akun mana.
  const emit = (accountId, channel, payload) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, { accountId, data: payload });
    }
  };
  whatsapp.setSendEvent(emit);
  telegram.setSendEvent(emit);

  async function checkLicense() {
    if (!currentToken) {
      return { status: 'logged_out' };
    }

    const fingerprint = session.getDeviceFingerprint();

    try {
      const result = await api.validateLicense({ token: currentToken, deviceFingerprint: fingerprint });
      if (result.usable) {
        currentUser = result.user;
      }
      return {
        status: result.usable ? 'active' : 'locked',
        user: result.user,
        subscription: result.subscription,
      };
    } catch (err) {
      if (err.status === 401 || err.code === 'device_locked') {
        currentToken = null;
        session.clearToken();
        return {
          status: 'logged_out',
          error: err.code === 'device_locked' ? err.message : null,
        };
      }
      if (err.code === 'network_error') {
        return { status: 'offline', error: err.message };
      }
      return { status: 'logged_out', error: err.message };
    }
  }

  ipcMain.handle('session:check', () => checkLicense());

  ipcMain.handle('auth:register', async (_event, { name, email, password }) => {
    const fingerprint = session.getDeviceFingerprint();
    const result = await api.register({ name, email, password, deviceFingerprint: fingerprint });
    currentToken = result.token;
    currentUser = result.user;
    session.saveToken(currentToken);
    return { user: result.user, subscription: result.subscription };
  });

  ipcMain.handle('auth:login', async (_event, { email, password }) => {
    const fingerprint = session.getDeviceFingerprint();
    const result = await api.login({ email, password, deviceFingerprint: fingerprint });
    currentToken = result.token;
    currentUser = result.user;
    session.saveToken(currentToken);
    return { user: result.user, subscription: result.subscription };
  });

  ipcMain.handle('auth:logout', async () => {
    if (currentToken) {
      try {
        await api.logout({ token: currentToken });
      } catch {
        // biar tetap logout di sisi app walau request revoke ke server gagal
      }
    }
    await whatsapp.stopAll();
    await telegram.stopAll();
    currentToken = null;
    currentUser = null;
    session.clearToken();
    return { status: 'logged_out' };
  });

  function requireUser() {
    if (!currentUser) {
      throw new Error('Belum login.');
    }
    return currentUser;
  }

  // --- Akun channel (sidebar multi-akun) ---

  ipcMain.handle('accounts:list', (_event, channel) => accountStore.list(requireUser().id, channel));
  ipcMain.handle('accounts:add', (_event, { channel, label }) => accountStore.add(requireUser().id, channel, label));
  ipcMain.handle('accounts:rename', (_event, { channel, accountId, label }) =>
    accountStore.rename(requireUser().id, channel, accountId, label));
  ipcMain.handle('accounts:reorder', (_event, { channel, orderedIds }) =>
    accountStore.reorder(requireUser().id, channel, orderedIds));

  ipcMain.handle('accounts:remove', async (_event, { channel, accountId }) => {
    const userId = requireUser().id;
    if (channel === 'whatsapp') {
      await whatsapp.logoutWA(userId, accountId);
      whatsapp.removeInstance(accountId);
    } else if (channel === 'telegram') {
      await telegram.disconnect(userId, accountId);
      telegram.removeInstance(accountId);
    }
    accountStore.remove(userId, channel, accountId);
  });

  // --- WhatsApp ---

  ipcMain.handle('wa:start', (_event, accountId) => whatsapp.start(requireUser().id, accountId));
  ipcMain.handle('wa:get-chats', (_event, accountId) => whatsapp.getChatsList(accountId));
  ipcMain.handle('wa:get-messages', (_event, { accountId, chatId }) => whatsapp.getMessages(accountId, chatId));
  ipcMain.handle('wa:send-message', (_event, { accountId, chatId, text }) => whatsapp.sendMessage(accountId, chatId, text));
  ipcMain.handle('wa:mark-read', (_event, { accountId, chatId }) => whatsapp.markChatRead(accountId, chatId));
  ipcMain.handle('wa:get-avatar', (_event, { accountId, chatId }) => whatsapp.getAvatar(accountId, chatId));
  ipcMain.handle('wa:logout', (_event, accountId) => whatsapp.logoutWA(requireUser().id, accountId));

  // --- Telegram ---

  ipcMain.handle('tg:has-token', (_event, accountId) => telegram.hasSavedToken(requireUser().id, accountId));
  ipcMain.handle('tg:start', (_event, { accountId, token }) => telegram.start(requireUser().id, accountId, token || null));
  ipcMain.handle('tg:get-chats', (_event, accountId) => telegram.getChatsList(accountId));
  ipcMain.handle('tg:get-messages', (_event, { accountId, chatId }) => telegram.getMessages(accountId, chatId));
  ipcMain.handle('tg:send-message', (_event, { accountId, chatId, text }) => telegram.sendMessage(accountId, chatId, text));
  ipcMain.handle('tg:mark-read', (_event, { accountId, chatId }) => telegram.markChatRead(accountId, chatId));
  ipcMain.handle('tg:get-avatar', (_event, { accountId, chatId }) => telegram.getAvatar(accountId, chatId));
  ipcMain.handle('tg:disconnect', (_event, accountId) => telegram.disconnect(requireUser().id, accountId));
}

module.exports = { registerIpcHandlers };
