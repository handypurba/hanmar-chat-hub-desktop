const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');

// Auto-update lewat electron-updater — cek versi terbaru ke
// https://hanmar.biz.id/download/latest.yml (lihat "publish" di package.json).
// Setiap build baru (npm run dist) menghasilkan latest.yml + installer baru
// yang WAJIB diupload bareng ke folder itu, supaya app yang sudah terpasang
// bisa mendeteksi & download update-nya sendiri.
function setupAutoUpdater(win) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    dialog
      .showMessageBox(win, {
        type: 'info',
        title: 'Update tersedia',
        message: `Versi baru Hanmar Chat Hub (${info.version}) sudah diunduh.`,
        detail: 'Restart sekarang untuk memasang, atau nanti saat app ditutup akan otomatis terpasang.',
        buttons: ['Restart Sekarang', 'Nanti'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on('error', (err) => {
    console.error('[auto-update] gagal cek/download update:', err);
  });

  // Delay dikit biar window utama sudah tampil duluan sebelum cek update.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[auto-update] checkForUpdates gagal:', err);
    });
  }, 3000);
}

module.exports = { setupAutoUpdater };
