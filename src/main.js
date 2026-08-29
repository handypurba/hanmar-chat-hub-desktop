const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./main/ipc');
const { setupAutoUpdater } = require('./main/updater');

// Cegah app dibuka 2x+ sekaligus (bisa bentrok: heartbeat kekirim dobel,
// WebContentsView WA Web/dst. ganda, dsb.) — instance kedua langsung ditutup,
// jendela yang sudah ada difokuskan lagi supaya pelanggan tidak bingung
// "kenapa tidak kebuka" (kelihatan seperti app-nya cuma pindah ke depan).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  return;
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Hardening: renderer tidak boleh navigasi ke luar app atau buka window baru
  // sendiri (defense-in-depth, meski app ini tidak memuat konten remote/HTML
  // dari luar). Link eksternal yang memang dibutuhkan dibuka di browser OS.
  win.webContents.setWindowOpenHandler(({ url }) => {
    console.error(`[main-window] setWindowOpenHandler url=${url} -> openExternal`);
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
    }
  });

  // Teruskan console renderer ke terminal pas development, biar error JS di
  // renderer kelihatan tanpa perlu buka DevTools manual.
  if (!app.isPackaged) {
    win.webContents.on('console-message', (event) => {
      console.log(`[renderer] ${event.message}`);
    });
  }

  return win;
}

app.whenReady().then(() => {
  const win = createMainWindow();
  registerIpcHandlers(win);

  // Auto-update cuma masuk akal buat app yang sudah di-install pelanggan
  // (production). Saat development (`npm start`) tidak ada installer/latest.yml
  // untuk dicek, jadi dilewati supaya tidak muncul error tiap kali buka.
  if (app.isPackaged) {
    setupAutoUpdater(win);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Hardening: tolak permintaan navigasi ke webview/frame baru dari proses
// mana pun di app ini (satu-satunya window yang sah adalah yang kita buat).
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
