const { ipcMain } = require('electron');
const session = require('./session');
const api = require('./api');
const whatsapp = require('./whatsapp');

/**
 * Registrasi semua handler IPC yang dipanggil renderer (lewat preload.js).
 * Token disimpan di memory proses main + file terenkripsi, TIDAK pernah
 * dikirim ke renderer supaya tidak bisa dibaca dari DevTools/renderer JS.
 */
function registerIpcHandlers(mainWindow) {
  let currentToken = session.loadToken();
  let currentUser = null;

  whatsapp.setSendEvent((channel, payload) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  });

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
    await whatsapp.stop();
    currentToken = null;
    currentUser = null;
    session.clearToken();
    return { status: 'logged_out' };
  });

  // --- WhatsApp (Fase 3) ---

  ipcMain.handle('wa:start', () => {
    if (!currentUser) {
      throw new Error('Belum login.');
    }
    return whatsapp.start(currentUser.id);
  });

  ipcMain.handle('wa:get-chats', () => whatsapp.getChatsList());
  ipcMain.handle('wa:get-messages', (_event, chatId) => whatsapp.getMessages(chatId));
  ipcMain.handle('wa:send-message', (_event, { chatId, text }) => whatsapp.sendMessage(chatId, text));
  ipcMain.handle('wa:logout', () => whatsapp.logoutWA());
}

module.exports = { registerIpcHandlers };
