const { app, WebContentsView, session, shell } = require('electron');

/**
 * WhatsApp, Telegram, Shopee, Tokopedia, Messenger & Instagram DM — embed
 * halaman web RESMI masing-masing lewat WebContentsView, bukan library
 * unofficial (Baileys) atau API resmi yang butuh App Review/whitelist.
 *
 * Kenapa (24 Agustus 2026): produk ini dijual ke banyak pelanggan — risiko
 * akun mereka kena banned/dibatasi kalau pakai library yang meniru protokol
 * (Baileys) dianggap terlalu berat buat kepercayaan pelanggan. Embed web
 * resmi = sama seperti pelanggan buka situs itu langsung di browser biasa,
 * cuma ditampilkan di dalam app. Konsekuensinya: TIDAK ada akses programatik
 * ke data chat (tidak ada custom search/filter/unread bikinan sendiri) —
 * pelanggan pakai fitur bawaan situs itu sendiri.
 *
 * Tiap akun dapat session partition sendiri (`persist:{channel}-{accountId}`)
 * — artinya tiap akun punya "profil browser" terpisah, tetap login
 * masing-masing walau app ditutup-buka lagi, tidak saling bentrok.
 *
 * Cuma SATU view yang boleh nempel ke window kapan pun (sidebar app cuma
 * nampilin 1 akun aktif) — makanya `attached` global, dilacak lintas channel.
 */

// Semua domain resmi Meta yang mungkin dilewati proses login/captcha/checkpoint
// (dipakai channel "meta" — Messenger & Instagram DM tergabung — yang
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
    // 25 Agustus 2026: awalnya langsung ke /chat, tapi itu bikin sempat
    // kelihatan halaman Tokopedia lama dulu sebelum dialihkan ke Seller
    // Center gabungan Tokopedia & TikTok Shop -- sekarang langsung ke
    // halaman utamanya (chat tetap 1 klik lewat ikon di sidebar kiri situs
    // itu sendiri).
    url: 'https://seller.tokopedia.com/',
    partitionPrefix: 'tokopedia',
    // Halaman ini masih tampilkan dashboard LAMA dulu dengan banner "sudah
    // dialihkan..." + tombol manual "Ke Seller Center" (URL tujuannya
    // spesifik per-akun/seller_id, tidak bisa ditulis langsung) — auto-klik
    // tombolnya begitu ketemu, supaya pelanggan tidak perlu klik manual tiap
    // buka channel ini.
    autoRedirectText: 'Ke Seller Center',
    // seller-id / seller-<region> = subdomain regional Seller Center gabungan
    // Tokopedia+TikTok Shop; accounts.tokopedia.com dibutuhkan buat alur login.
    allowedHost: /^https:\/\/(seller(-\w+)?\.tokopedia\.com|www\.tokopedia\.com|accounts\.tokopedia\.com)/,
  },
  // Messenger & Instagram DM (ditambahkan 24 Agustus 2026, DIGABUNG jadi 1
  // channel 25 Agustus 2026): embed Meta Business Suite — kotak masuk RESMI
  // Meta yang menggabungkan pesan Messenger + Instagram DM (+ WhatsApp)
  // dalam satu halaman. Sama seperti Shopee/Tokopedia, TIDAK perlu App
  // Review Meta / App ID sama sekali — itu cuma dibutuhkan kalau pakai
  // Graph API (rencana lama, sudah tidak dipakai). Awalnya sempat dibuat 2
  // entri channel terpisah (messenger & instagram) padahal keduanya menuju
  // halaman yang SAMA PERSIS — digabung jadi 1 ("meta") supaya pelanggan
  // tidak perlu login 2x ke akun yang sama untuk isi yang identik.
  meta: {
    url: 'https://business.facebook.com/latest/inbox/all',
    partitionPrefix: 'meta',
    allowedHost: META_ALLOWED_HOST,
    // Popup asli dibutuhkan di sini buat alur "Hubungkan akun Instagram"
    // (window OAuth kecil yang nutup sendiri setelah selesai) — lihat
    // guardNavigation di bawah.
    allowPopup: true,
  },
};

let mainWindow = null;
let currentBounds = null;
let attached = null; // { channel, accountId } | null
const views = new Map(); // "channel:accountId" -> WebContentsView

// Session -> config, supaya popup APA PUN yang muncul dari session ini
// (termasuk popup-dari-popup, berlapis berapa pun) otomatis ke-guard juga —
// popup mewarisi session dari pembukanya, jadi cukup dicocokkan lewat ini,
// tidak perlu pasang handler manual berlapis-lapis yang rawan kelewat.
const sessionConfig = new Map();

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
  webContents.setUserAgent(desktopChromeUserAgent());
  webContents.setWindowOpenHandler(({ url }) => {
    if (config.allowedHost.test(url)) {
      // Sebagian besar situs (mis. "Obrolan Toko" Tokopedia/TikTok Shop)
      // buka bagian penting mereka lewat window.open() — kalau dibiarkan
      // ('allow'), Electron bikin jendela OS terpisah lengkap dengan menu
      // bar (kelihatan aneh, bukan "1 aplikasi 1 jendela" yang diharapkan
      // pelanggan). Defaultnya kita cegah itu dan load URL-nya di pane yang
      // sama saja (sesi tetap sama, cuma tidak jadi jendela baru).
      if (!config.allowPopup) {
        webContents.loadURL(url);
        return { action: 'deny' };
      }
      // Channel tertentu (mis. Meta — alur "Hubungkan akun Instagram")
      // memang butuh popup asli (window OAuth kecil yang nutup sendiri),
      // jadi tetap dibiarkan buka sebagai jendela terpisah.
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
}

// Satu pemantau global buat SEMUA webContents baru di app ini (window utama,
// tiap WebContentsView channel, dan semua popup-nya) — dicocokkan lewat
// session, bukan lewat siapa yang membuatnya. Ini yang membuat popup
// berlapis (popup dari popup) tetap ke-guard dengan benar.
app.on('web-contents-created', (_event, contents) => {
  const config = sessionConfig.get(contents.session);
  if (config) guardNavigation(contents, config);
});

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

function ensureView(channel, accountId) {
  const k = key(channel, accountId);
  let view = views.get(k);
  if (view) return view;

  const config = CHANNELS[channel];
  const ses = session.fromPartition(`persist:${config.partitionPrefix}-${accountId}`);
  // Daftarkan DULU sebelum WebContentsView dibuat, supaya event
  // 'web-contents-created' langsung mengenali session ini begitu terpicu.
  sessionConfig.set(ses, config);

  view = new WebContentsView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      sandbox: true,
    },
  });
  view.webContents.loadURL(config.url);

  if (config.autoRedirectText) {
    // Jalan tiap kali webContents ini selesai load (termasuk setelah
    // ter-redirect ke halaman tujuan) — idempoten, cuma klik kalau tombol
    // dengan teks itu memang masih ada di layar. Dicoba berkali-kali (bukan
    // sekali pas did-finish-load) karena situs SPA sering baru render
    // tombolnya belakangan, sesudah event "load" awal selesai.
    view.webContents.on('did-finish-load', () => {
      view.webContents
        .executeJavaScript(
          `(() => {
            const target = ${JSON.stringify(config.autoRedirectText)}.toLowerCase();
            let tries = 0;
            const attempt = () => {
              tries += 1;
              const clickable = Array.from(document.querySelectorAll('a,button,[role="button"]'));
              const el = clickable.find((e) => e.innerText && e.innerText.trim().toLowerCase().includes(target));
              if (el) { el.click(); return; }
              if (tries < 20) setTimeout(attempt, 500);
            };
            attempt();
          })();`
        )
        .catch(() => {
          // abaikan — bukan fatal kalau script gagal jalan (mis. halaman belum siap)
        });
    });
  }

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

  const ses = session.fromPartition(`persist:${CHANNELS[channel].partitionPrefix}-${accountId}`);
  sessionConfig.delete(ses);
  try {
    await ses.clearStorageData();
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
