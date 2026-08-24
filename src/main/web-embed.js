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

// Semua domain resmi Meta yang mungkin dilewati proses login/captcha/checkpoint
// (dipakai bareng oleh channel messenger & instagram, keduanya sama-sama
// masuk lewat business.facebook.com).
const META_ALLOWED_HOST = /^https:\/\/([\w-]+\.)?(facebook\.com|instagram\.com|fb\.com|meta\.com)/;

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
  // Shopee & Tokopedia (ditambahkan 24 Agustus 2026): embed Seller Centre
  // resmi mereka, bukan API resmi (yang butuh whitelist/approval Shopee) —
  // pelanggan login pakai akun toko mereka sendiri, sama pola dengan WA/TG.
  shopee: {
    url: 'https://seller.shopee.co.id/webchat/conversations',
    partitionPrefix: 'shopee',
    allowedHost: /^https:\/\/(seller\.shopee\.co\.id|shopee\.co\.id)/,
  },
  tokopedia: {
    url: 'https://seller.tokopedia.com/chat',
    partitionPrefix: 'tokopedia',
    // seller-id / seller-<region> = subdomain regional Seller Center gabungan
    // Tokopedia+TikTok Shop; accounts.tokopedia.com dibutuhkan buat alur login.
    allowedHost: /^https:\/\/(seller(-\w+)?\.tokopedia\.com|www\.tokopedia\.com|accounts\.tokopedia\.com)/,
  },
  // Messenger & Instagram DM (ditambahkan 24 Agustus 2026): embed Meta
  // Business Suite — kotak masuk RESMI Meta yang menggabungkan pesan
  // Messenger + Instagram DM (+ WhatsApp) dalam satu halaman. Sama seperti
  // Shopee/Tokopedia, TIDAK perlu App Review Meta / App ID sama sekali —
  // itu cuma dibutuhkan kalau pakai Graph API (rencana lama, sudah tidak
  // dipakai). Messenger & Instagram DM sengaja tetap 2 entri channel
  // terpisah di sidebar (biar sesuai ekspektasi produk), tapi dua-duanya
  // menuju halaman yang sama karena memang situ tempat pesannya digabung.
  messenger: {
    url: 'https://business.facebook.com/latest/inbox/all',
    partitionPrefix: 'messenger',
    // Login Meta suka lompat-lompat antar subdomain facebook.com & instagram.com
    // (termasuk buat captcha/verifikasi) — izinkan semuanya biar tidak
    // kelempar ke browser luar di tengah proses login.
    allowedHost: META_ALLOWED_HOST,
  },
  instagram: {
    url: 'https://business.facebook.com/latest/inbox/all',
    partitionPrefix: 'instagram',
    allowedHost: META_ALLOWED_HOST,
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

// Skema link non-http (mis. "bytedance://", "tel:", dsb.) biasanya buat buka
// app native di HP — tidak ada gunanya di desktop dan bikin Windows munculin
// dialog "tidak ada app terpasang" kalau dipaksa openExternal. Diamkan saja.
function isOpenableExternally(url) {
  return /^https?:\/\//.test(url);
}

function desktopChromeUserAgent() {
  // Situs-situs ini sering menolak User-Agent yang mengandung "Electron/x.x.x"
  // (dianggap browser tidak didukung) — samarkan jadi Chrome desktop biasa.
  // Versi Chrome diambil dari Chromium bawaan Electron sendiri, jadi otomatis
  // ikut update tiap Electron di-upgrade.
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
}

function guardNavigation(webContents, config) {
  webContents.setWindowOpenHandler(({ url }) => {
    // Popup yang masih di domain resmi yang sama (mis. "Hubungkan akun
    // Instagram" di Meta Business Suite) wajar & harus dibiarkan terbuka —
    // popup-nya otomatis mewarisi session/partition yang sama dari
    // pembukanya, jadi sesi login tetap nyambung. Selain itu, dilempar ke
    // browser luar (bukan dibiarkan Electron bikin window sembarangan).
    if (config.allowedHost.test(url)) {
      return { action: 'allow' };
    }
    if (isOpenableExternally(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (!config.allowedHost.test(url)) {
      event.preventDefault();
      if (isOpenableExternally(url)) shell.openExternal(url);
    }
  });
  // Popup yang diizinkan tadi ('action: allow') tidak otomatis dapat
  // hardening yang sama — pasang lagi User-Agent + guard navigasinya begitu
  // window popup-nya benar-benar terbentuk.
  webContents.on('did-create-window', (popupWindow) => {
    popupWindow.webContents.setUserAgent(desktopChromeUserAgent());
    guardNavigation(popupWindow.webContents, config);
  });
}

function hardenView(view, config) {
  guardNavigation(view.webContents, config);
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
  view.webContents.setUserAgent(desktopChromeUserAgent());
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

/**
 * Fallback: sebagian situs (terutama Tokopedia/TikTok Shop) sering gagal
 * login kalau di-embed — terdeteksi sebagai bot, atau (kalau mereka pakai
 * "Login with Google") memang diblokir Google di semua embedded browser
 * sejak 2021, bukan cuma di app ini. Tombol ini buka situs aslinya di
 * browser default OS, di luar app — login di situ tetap berhasil normal.
 */
function openExternal(channel) {
  const config = CHANNELS[channel];
  if (config) shell.openExternal(config.url);
}

module.exports = { init, setBounds, show, hide, hideActive, remove, removeAll, openExternal };
