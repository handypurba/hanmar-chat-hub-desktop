const { ipcMain } = require('electron');
const session = require('./session');
const api = require('./api');

/**
 * Registrasi semua handler IPC yang dipanggil renderer (lewat preload.js).
 * Token disimpan di memory proses main + file terenkripsi, TIDAK pernah
 * dikirim ke renderer supaya tidak bisa dibaca dari DevTools/renderer JS.
 */
function registerIpcHandlers() {
  let currentToken = session.loadToken();

  async function checkLicense() {
    if (!currentToken) {
      return { status: 'logged_out' };
    }

    const fingerprint = session.getDeviceFingerprint();

    try {
      const result = await api.validateLicense({ token: currentToken, deviceFingerprint: fingerprint });
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
    session.saveToken(currentToken);
    return { user: result.user, subscription: result.subscription };
  });

  ipcMain.handle('auth:login', async (_event, { email, password }) => {
    const fingerprint = session.getDeviceFingerprint();
    const result = await api.login({ email, password, deviceFingerprint: fingerprint });
    currentToken = result.token;
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
    currentToken = null;
    session.clearToken();
    return { status: 'logged_out' };
  });
}

module.exports = { registerIpcHandlers };
