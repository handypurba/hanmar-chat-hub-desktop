const { ipcMain } = require('electron');
const session = require('./session');
const api = require('./api');
const webEmbed = require('./web-embed');
const accountStore = require('./account-store');

/**
 * Registrasi semua handler IPC yang dipanggil renderer (lewat preload.js).
 * Token disimpan di memory proses main + file terenkripsi, TIDAK pernah
 * dikirim ke renderer supaya tidak bisa dibaca dari DevTools/renderer JS.
 */
function registerIpcHandlers(mainWindow) {
  let currentToken = session.loadToken();
  let currentUser = null;

  webEmbed.init(mainWindow);

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

  ipcMain.handle('auth:register', async (_event, { name, email, phone, password }) => {
    const fingerprint = session.getDeviceFingerprint();
    const result = await api.register({ name, email, phone, password, deviceFingerprint: fingerprint });
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
    webEmbed.hideActive(); // sesi WA Web/Telegram Web tetap tersimpan, cuma disembunyikan pas di layar login
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
  ipcMain.handle('accounts:getChannelOrder', (_event, defaultOrder) =>
    accountStore.getChannelOrder(requireUser().id, defaultOrder));
  ipcMain.handle('accounts:setChannelOrder', (_event, order) =>
    accountStore.setChannelOrder(requireUser().id, order));

  ipcMain.handle('accounts:remove', async (_event, { channel, accountId }) => {
    const userId = requireUser().id;
    await webEmbed.remove(channel, accountId);
    accountStore.remove(userId, channel, accountId);
  });

  // --- Channel "Bisnis (dibagikan)" -- disimpan server (channel_accounts),
  // kelihatan sama di semua device akun ini. Beda dari accounts:* di atas
  // (channel "Pribadi", tetap lokal per device). requireUser() cuma
  // memastikan sudah login -- token yang otentikasi ke server.
  ipcMain.handle('sharedAccounts:list', () => {
    requireUser();
    return api.listChannelAccounts({ token: currentToken });
  });
  ipcMain.handle('sharedAccounts:add', (_event, { channel, label }) => {
    requireUser();
    return api.addChannelAccount({ token: currentToken, channel, label });
  });
  ipcMain.handle('sharedAccounts:rename', (_event, { id, label }) => {
    requireUser();
    return api.renameChannelAccount({ token: currentToken, id, label });
  });
  ipcMain.handle('sharedAccounts:remove', async (_event, { channel, id }) => {
    requireUser();
    await webEmbed.remove(channel, `shared-${id}`);
    return api.removeChannelAccount({ token: currentToken, id });
  });
  ipcMain.handle('sharedAccounts:reorder', (_event, orderedIds) => {
    requireUser();
    return api.reorderChannelAccounts({ token: currentToken, orderedIds });
  });

  // --- WhatsApp & Telegram (embed web resmi) ---

  ipcMain.handle('webembed:show', (_event, { channel, accountId }) => webEmbed.show(channel, accountId));
  ipcMain.handle('webembed:hide', (_event, { channel, accountId }) => webEmbed.hide(channel, accountId));
  ipcMain.handle('webembed:hide-active', () => webEmbed.hideActive());
  ipcMain.handle('webembed:set-bounds', (_event, bounds) => webEmbed.setBounds(bounds));
  ipcMain.handle('webembed:open-external', (_event, channel) => webEmbed.openExternal(channel));

  // --- Heartbeat: lapor "masih dipakai" + channel apa saja yang aktif ke
  // server tiap ~60 detik, dipakai dashboard admin buat status
  // online/offline & halaman detail per pelanggan (lihat PLANNING.md). Gagal
  // kirim TIDAK BOLEH ganggu app -- diamkan, coba lagi interval berikutnya.
  const HEARTBEAT_CHANNELS = ['whatsapp', 'telegram', 'shopee', 'tokopedia', 'messenger', 'instagram'];
  async function sendHeartbeat() {
    if (!currentToken || !currentUser) return;
    try {
      let sharedChannels = [];
      try {
        sharedChannels = (await api.listChannelAccounts({ token: currentToken })).map((a) => a.channel);
      } catch {
        // offline sesaat dsb. -- lanjut pakai channel lokal saja
      }
      const active = HEARTBEAT_CHANNELS.filter(
        (channel) =>
          accountStore.list(currentUser.id, channel).length > 0 || sharedChannels.includes(channel)
      );
      await api.heartbeat({
        token: currentToken,
        deviceFingerprint: session.getDeviceFingerprint(),
        channels: active,
      });
    } catch {
      // abaikan -- lihat komentar di atas
    }
  }
  setInterval(sendHeartbeat, 60_000);
  sendHeartbeat();
}

module.exports = { registerIpcHandlers };
