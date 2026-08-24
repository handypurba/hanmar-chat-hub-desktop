const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./main/ipc');

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
