const { WebContentsView, session, shell } = require('electron');

/**
 * WhatsApp & Telegram — embed halaman web RESMI (web.whatsapp.com,
 * web.telegram.org) lewat WebContentsView, bukan library unofficial
 * (Baileys/Bot API terpisah dari akun pribadi).
 *
 * Kenapa (24 Agustus 2026): produk ini dijual ke banyak pelanggan — risiko
 * akun mereka kena banned/dibatasi kalau pakai library yang meniru protokol
 * (Baileys) dianggap terlalu berat buat kepercayaan pelanggan. Embed web
 * resmi = sama seperti pelanggan buka WA Web/Telegram Web di browser biasa,
 * cuma ditampilkan di dalam app. Konsekuensinya: TIDAK ada akses programatik
 * ke data chat (tidak ada custom search/filter/unread bikinan sendiri) —
 * pelanggan pakai fitur pencarian/filter bawaan situs itu sendiri.
 *
 * Tiap akun dapat session partition sendiri (`persist:{channel}-{accountId}`)
 * — artinya tiap akun punya "profil browser" terpisah, tetap login
 * masing-masing walau app ditutup-buka lagi, tidak saling bentrok.
 *
 * Cuma SATU view yang boleh nempel ke window kapan pun (sidebar app cuma
 * nampilin 1 akun aktif) — makanya `attached` global, dilacak lintas channel.
 */

const CHANNELS = {
  whatsapp: {
    url: 'https://web.whatsapp.com',
    partitionPrefix: 'wa',
    allowedHost: /^https:\/\/(web\.whatsapp\.com|www\.whatsapp\.com)/,
  },
  telegram: {
    url: 'https://web.telegram.org/k/',
    partitionPrefix: 'tg',
    allowedHost: /^https:\/\/web\.telegram\.org/,
  },
};

let mainWindow = null;
let currentBounds = null;
let attached = null; // { channel, accountId } | null
const views = new Map(); // "channel:accountId" -> WebContentsView

function key(channel, accountId) {
  return `${channel}:${accountId}`;
}

function init(win) {
  mainWindow = win;
}

function setBounds(bounds) {
  currentBounds = bounds;
  if (attached) {
    views.get(key(attached.channel, attached.accountId))?.setBounds(bounds);
  }
}

function hardenView(view, config) {
  // Konsisten dengan hardening window utama: jangan biarkan halamannya
  // buka window baru di dalam app / navigasi ke luar domain resminya.
  view.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  view.webContents.on('will-navigate', (event, url) => {
    if (!config.allowedHost.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

function ensureView(channel, accountId) {
  const k = key(channel, accountId);
  let view = views.get(k);
  if (view) return view;

  const config = CHANNELS[channel];
  view = new WebContentsView({
    webPreferences: {
      partition: `persist:${config.partitionPrefix}-${accountId}`,
      contextIsolation: true,
      sandbox: true,
    },
  });
  hardenView(view, config);

  // Situs-situs ini sering menolak User-Agent yang mengandung "Electron/x.x.x"
  // (dianggap browser tidak didukung) — samarkan jadi Chrome desktop biasa.
  // Versi Chrome diambil dari Chromium bawaan Electron sendiri, jadi otomatis
  // ikut update tiap Electron di-upgrade.
  const chromeVersion = process.versions.chrome;
  view.webContents.setUserAgent(
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
  );

  view.webContents.loadURL(config.url);
  views.set(k, view);
  return view;
}

function show(channel, accountId) {
  if (attached && (attached.channel !== channel || attached.accountId !== accountId)) {
    const prevView = views.get(key(attached.channel, attached.accountId));
    if (prevView) mainWindow.contentView.removeChildView(prevView);
    attached = null;
  }

  const view = ensureView(channel, accountId);
  if (!attached) {
    mainWindow.contentView.addChildView(view);
    attached = { channel, accountId };
  }
  if (currentBounds) view.setBounds(currentBounds);
}

function hide(channel, accountId) {
  const view = views.get(key(channel, accountId));
  if (view && attached?.channel === channel && attached?.accountId === accountId) {
    mainWindow.contentView.removeChildView(view);
    attached = null;
  }
}

function hideActive() {
  if (attached) hide(attached.channel, attached.accountId);
}

async function remove(channel, accountId) {
  hide(channel, accountId);
  const k = key(channel, accountId);
  const view = views.get(k);
  if (!view) return;

  try {
    await session.fromPartition(`persist:${CHANNELS[channel].partitionPrefix}-${accountId}`).clearStorageData();
  } catch {
    // abaikan — bukan fatal kalau gagal bersihkan storage
  }
  view.webContents.close?.();
  views.delete(k);
}

async function removeAll() {
  await Promise.all(
    Array.from(views.keys()).map((k) => {
      const [channel, accountId] = k.split(':');
      return remove(channel, accountId);
    })
  );
}

module.exports = { init, setBounds, show, hide, hideActive, remove, removeAll };
