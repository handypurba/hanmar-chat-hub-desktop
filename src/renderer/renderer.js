const views = {
  loading: document.getElementById('view-loading'),
  offline: document.getElementById('view-offline'),
  auth: document.getElementById('view-auth'),
  locked: document.getElementById('view-locked'),
  main: document.getElementById('view-main'),
};

function showView(name) {
  Object.values(views).forEach((el) => el.classList.add('hidden'));
  views[name].classList.remove('hidden');
}

// --- Dialog rename custom (Electron tidak mendukung window.prompt() bawaan
// browser — cuma alert()/confirm() yang didukung, jadi rename akun pakai
// modal HTML sendiri ini, bukan prompt()). ---
const renameDialog = document.getElementById('rename-dialog');
const renameForm = document.getElementById('rename-form');
const renameInput = document.getElementById('rename-input');
let resolveRenameDialog = null;

async function showRenameDialog(currentValue) {
  // Penting: pane channel aktif (WA Web/Shopee/dst.) itu layer NATIVE
  // terpisah yang selalu nempel di atas HTML — kalau tidak disembunyikan
  // dulu, dialog ini ketutup total (kelihatan "tidak muncul" padahal
  // sebenarnya sudah tampil, cuma ketimpa). Ditampilkan lagi saat ditutup.
  await window.hanmar.webembed.hideActive();
  renameInput.value = currentValue || '';
  renameDialog.classList.remove('hidden');
  renameInput.focus();
  renameInput.select();
  return new Promise((resolve) => { resolveRenameDialog = resolve; });
}

function closeRenameDialog(result) {
  renameDialog.classList.add('hidden');
  if (activeAccountId) switchToAccount(activeAccountId);
  if (resolveRenameDialog) {
    resolveRenameDialog(result);
    resolveRenameDialog = null;
  }
}

renameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  closeRenameDialog(renameInput.value);
});
document.getElementById('rename-cancel').addEventListener('click', () => closeRenameDialog(null));
renameDialog.addEventListener('click', (e) => {
  if (e.target === renameDialog) closeRenameDialog(null);
});

const PLAN_LABEL = {
  trial: 'Trial',
  '1_month': 'Langganan 1 Bulan',
  '3_month': 'Langganan 3 Bulan',
  '6_month': 'Langganan 6 Bulan',
  '12_month': 'Langganan 12 Bulan',
};

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function renderMain({ user, subscription }) {
  document.getElementById('user-name').textContent = user.name;
  const badge = document.getElementById('status-badge');
  badge.textContent = `${PLAN_LABEL[subscription.plan] || subscription.plan} · aktif s/d ${formatDate(subscription.expires_at)}`;
  badge.className = 'badge' + (subscription.status === 'trial' ? ' trial' : '');
  showView('main');
  initAccounts();
}

function renderLocked(subscription) {
  const isTrial = subscription && subscription.plan === 'trial';
  document.getElementById('locked-message').textContent = subscription
    ? `${isTrial ? 'Trial 3 hari' : 'Langganan'} Anda sudah berakhir pada ${formatDate(subscription.expires_at)}.`
    : 'Akses Anda sedang terkunci.';
  showView('locked');
}

function renderOffline(message) {
  document.getElementById('offline-message').textContent =
    message || 'Tidak bisa menghubungi server. Cek koneksi internet Anda.';
  showView('offline');
}

async function refreshSession() {
  showView('loading');
  const result = await window.hanmar.checkSession();
  applySessionResult(result);
}

function applySessionResult(result) {
  if (result.status === 'active') {
    renderMain(result);
  } else if (result.status === 'locked') {
    renderLocked(result.subscription);
  } else if (result.status === 'offline') {
    renderOffline(result.error);
  } else {
    if (result.error) {
      document.getElementById('login-error').textContent = result.error;
    }
    showView('auth');
  }
}

// --- Tabs login/register ---
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const isLogin = btn.dataset.tab === 'login';
    document.getElementById('login-form').classList.toggle('hidden', !isLogin);
    document.getElementById('register-form').classList.toggle('hidden', isLogin);
  });
});

// --- Show/hide password ---
document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.setAttribute('aria-label', isHidden ? 'Sembunyikan password' : 'Tampilkan password');
    btn.classList.toggle('is-visible', isHidden);
    btn.querySelector('.icon-eye').classList.toggle('hidden', isHidden);
    btn.querySelector('.icon-eye-off').classList.toggle('hidden', !isHidden);
  });
});

// --- Login ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  const submitBtn = form.querySelector('button');
  submitBtn.disabled = true;

  try {
    const data = Object.fromEntries(new FormData(form));
    const result = await window.hanmar.login(data);
    if (result.subscription.status === 'expired') {
      renderLocked(result.subscription);
    } else {
      renderMain(result);
    }
  } catch (err) {
    errorEl.textContent = err.message || 'Login gagal.';
  } finally {
    submitBtn.disabled = false;
  }
});

// --- Register ---
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('register-error');
  errorEl.textContent = '';
  const submitBtn = form.querySelector('button');
  submitBtn.disabled = true;

  try {
    const data = Object.fromEntries(new FormData(form));
    const result = await window.hanmar.register(data);
    renderMain(result);
  } catch (err) {
    errorEl.textContent = err.message || 'Pendaftaran gagal.';
  } finally {
    submitBtn.disabled = false;
  }
});

// --- Logout ---
async function doLogout() {
  await window.hanmar.logout();
  teardownAccounts();
  document.getElementById('login-form').reset();
  document.getElementById('register-form').reset();
  showView('auth');
}
document.getElementById('main-logout-btn').addEventListener('click', doLogout);
document.getElementById('locked-logout-btn').addEventListener('click', doLogout);

// --- Retry (offline) ---
document.getElementById('retry-btn').addEventListener('click', refreshSession);

// =====================================================================
// Sidebar multi-akun: tiap akun (WhatsApp/Telegram) dapat pane sendiri
// (di-clone dari <template>), bisa ditambah/dihapus/rename/drag-reorder.
// Isi pane-nya sendiri = WebContentsView (WA Web/Telegram Web asli) yang
// dikendalikan proses main — renderer cuma atur tampil/sembunyi & posisi.
// =====================================================================

const channelNavList = document.getElementById('channel-nav-list');
const channelContent = document.getElementById('channel-content');
const webEmbedTemplate = document.getElementById('web-embed-account-template');

const CHANNEL_LOADING_TEXT = {
  whatsapp: 'Memuat WhatsApp Web…',
  telegram: 'Memuat Telegram Web…',
  shopee: 'Memuat Shopee Seller Centre…',
  tokopedia: 'Memuat Tokopedia & TikTok Shop Seller Center…',
  messenger: 'Memuat Messenger…',
  instagram: 'Memuat Instagram Direct…',
};

const accountControllers = new Map(); // accountId -> controller
let activeAccountId = null;
let draggedAccountId = null;

function setNavDotOnline(accountId, online) {
  accountControllers.get(accountId)?.navBtn?.querySelector('[data-dot]')?.classList.toggle('online', online);
}

// --- Badge unread di sidebar (lihat main/web-embed.js: 'page-title-updated') ---
window.hanmar.onUnreadChanged(({ accountId, count }) => {
  const badge = accountControllers.get(accountId)?.navBtn?.querySelector('[data-badge]');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
});

function reportChannelContentBounds() {
  const rect = channelContent.getBoundingClientRect();
  return window.hanmar.webembed.setBounds({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });
}
new ResizeObserver(() => reportChannelContentBounds()).observe(channelContent);

async function switchToAccount(accountId) {
  const prevController = activeAccountId ? accountControllers.get(activeAccountId) : null;
  if (prevController && prevController.accountId !== accountId) {
    window.hanmar.webembed.hide(prevController.channel, prevController.accountId);
  }

  activeAccountId = accountId;
  accountControllers.forEach((c) => {
    c.pane.classList.toggle('hidden', c.accountId !== accountId);
    c.navBtn?.classList.toggle('active', c.accountId === accountId);
  });

  const controller = accountControllers.get(accountId);
  if (controller) {
    await reportChannelContentBounds();
    window.hanmar.webembed.show(controller.channel, controller.accountId);
    setNavDotOnline(controller.accountId, true);
  }
}

function createAccountController(channel, account) {
  const fragment = webEmbedTemplate.content.cloneNode(true);
  const pane = fragment.querySelector('[data-pane]');
  pane.querySelector('[data-loading-text]').textContent = CHANNEL_LOADING_TEXT[channel] || 'Memuat…';
  channelContent.appendChild(fragment);

  return {
    channel,
    accountId: account.id,
    pane,
    navBtn: null,
    // Tidak ada langkah "start" terpisah — view-nya dibuat lazy oleh main
    // process begitu pertama kali di-show() (lihat switchToAccount).
    start: () => {},
  };
}

function renderNavButton(controller, account) {
  const btn = document.createElement('button');
  btn.className = 'channel-btn account-btn';
  btn.draggable = true;
  btn.dataset.accountId = controller.accountId;

  const dot = document.createElement('span');
  dot.className = 'channel-dot';
  dot.dataset.dot = '';

  const label = document.createElement('span');
  label.className = 'account-label';
  label.textContent = account.label;

  const badge = document.createElement('span');
  badge.className = 'unread-badge hidden';
  badge.dataset.badge = '';

  const actions = document.createElement('span');
  actions.className = 'account-actions';
  actions.innerHTML = `
    <span class="account-action" data-action="external" title="Buka di browser (kalau gagal login di sini)">⧉</span>
    <span class="account-action" data-action="rename" title="Ganti nama">✎</span>
    <span class="account-action" data-action="remove" title="Hapus akun">✕</span>`;

  btn.append(dot, label, badge, actions);

  btn.addEventListener('click', (e) => {
    if (e.target.closest('[data-action]')) return;
    switchToAccount(controller.accountId);
  });
  actions.querySelector('[data-action="external"]').addEventListener('click', (e) => {
    e.stopPropagation();
    window.hanmar.webembed.openExternal(controller.channel);
  });
  actions.querySelector('[data-action="rename"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    const newLabel = await showRenameDialog(account.label);
    if (newLabel && newLabel.trim()) {
      account.label = newLabel.trim();
      label.textContent = account.label;
      await window.hanmar.accounts.rename(controller.channel, controller.accountId, account.label);
    }
  });
  actions.querySelector('[data-action="remove"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Hapus akun "${account.label}"? Sesi/tautan yang tersimpan akan diputus.`)) return;
    await removeAccount(controller);
  });

  btn.addEventListener('dragstart', () => { draggedAccountId = controller.accountId; });
  btn.addEventListener('dragover', (e) => {
    const dragged = accountControllers.get(draggedAccountId);
    if (!dragged || dragged === controller) return;
    e.preventDefault();
    btn.classList.add('drag-over');
  });
  btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
  btn.addEventListener('drop', async (e) => {
    e.preventDefault();
    btn.classList.remove('drag-over');
    const dragged = accountControllers.get(draggedAccountId);
    draggedAccountId = null;
    if (!dragged || dragged === controller) return;

    if (dragged.channel === controller.channel) {
      // Geser akun DI DALAM channel yang sama (mis. 2 akun WhatsApp).
      await reorderAccounts(controller.channel, dragged.accountId, controller.accountId);
    } else {
      // Geser antar-channel berbeda -> pindahkan seluruh grup channel itu
      // supaya posisinya tepat sebelum grup channel yang jadi target drop.
      await reorderChannelGroups(dragged.channel, controller.channel);
    }
  });

  controller.navBtn = btn;
  return btn;
}

async function reorderAccounts(channel, draggedId, targetId) {
  const order = [...channelNavList.querySelectorAll('.account-btn')]
    .map((el) => el.dataset.accountId)
    .filter((id) => accountControllers.get(id)?.channel === channel);
  const from = order.indexOf(draggedId);
  const to = order.indexOf(targetId);
  if (from === -1 || to === -1) return;
  order.splice(from, 1);
  order.splice(to, 0, draggedId);
  await window.hanmar.accounts.reorder(channel, order);
  rebuildNavOrder();
}

const DEFAULT_CHANNEL_ORDER = ['whatsapp', 'telegram', 'shopee', 'tokopedia', 'messenger', 'instagram'];
// Urutan aktif channel di sidebar — defaultnya DEFAULT_CHANNEL_ORDER, tapi
// pemilik boleh geser bebas (drag antar-channel), lalu tersimpan permanen
// lewat accounts.setChannelOrder (lihat account-store.js di main process).
let channelOrder = DEFAULT_CHANNEL_ORDER;

async function reorderChannelGroups(draggedChannel, targetChannel) {
  const order = channelOrder.slice();
  const from = order.indexOf(draggedChannel);
  const to = order.indexOf(targetChannel);
  if (from === -1 || to === -1) return;
  order.splice(from, 1);
  order.splice(to, 0, draggedChannel);
  channelOrder = order;
  await window.hanmar.accounts.setChannelOrder(order);
  rebuildNavOrder();
}

function rebuildNavOrder() {
  const allIds = [...channelNavList.querySelectorAll('.account-btn')].map((el) => el.dataset.accountId);
  // urutan render: kelompokkan per channel (sesuai channelOrder saat ini,
  // bisa digeser bebas), di dalam tiap kelompok pakai urutan drag-drop
  // terbaru dari DOM saat ini.
  for (const channel of channelOrder) {
    for (const id of allIds.filter((accId) => accountControllers.get(accId)?.channel === channel)) {
      const btn = accountControllers.get(id)?.navBtn;
      if (btn) channelNavList.appendChild(btn);
    }
  }
}

function mountAccount(channel, account) {
  const controller = createAccountController(channel, account);
  accountControllers.set(account.id, controller);
  const btn = renderNavButton(controller, account);
  channelNavList.appendChild(btn);
  return controller;
}

async function removeAccount(controller) {
  await window.hanmar.accounts.remove(controller.channel, controller.accountId);
  controller.pane.remove();
  controller.navBtn.remove();
  accountControllers.delete(controller.accountId);

  if (activeAccountId === controller.accountId) {
    const next = [...accountControllers.values()][0];
    if (next) switchToAccount(next.accountId);
    else activeAccountId = null;
  }
}

function teardownAccounts() {
  channelNavList.innerHTML = '';
  channelContent.innerHTML = '';
  accountControllers.clear();
  activeAccountId = null;
}

// WA & Telegram selalu ada minimal 1 akun default (channel utama, langsung
// kelihatan begitu login). Shopee/Tokopedia opsional — cuma muncul kalau
// pelanggan tambah sendiri lewat tombol "+".
const CHANNELS_WITH_DEFAULT_ACCOUNT = ['whatsapp', 'telegram'];

async function initAccounts() {
  teardownAccounts();

  channelOrder = await window.hanmar.accounts.getChannelOrder(DEFAULT_CHANNEL_ORDER);

  for (const channel of channelOrder) {
    let accounts = await window.hanmar.accounts.list(channel);
    if (accounts.length === 0 && CHANNELS_WITH_DEFAULT_ACCOUNT.includes(channel)) {
      accounts = [await window.hanmar.accounts.add(channel)];
    }
    for (const account of accounts) mountAccount(channel, account);
  }

  const first = [...accountControllers.values()][0];
  if (first) switchToAccount(first.accountId);

  for (const controller of accountControllers.values()) {
    controller.start();
  }
}

// --- Tombol tambah akun ---
document.getElementById('channel-add-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.querySelector('.add-account-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'add-account-menu';
  menu.innerHTML = `
    <button type="button" data-channel="whatsapp">+ Akun WhatsApp</button>
    <button type="button" data-channel="telegram">+ Akun Telegram</button>
    <button type="button" data-channel="shopee">+ Akun Shopee</button>
    <button type="button" data-channel="tokopedia">+ Akun Tokopedia & TikTok Shop</button>
    <button type="button" data-channel="messenger">+ Akun Messenger</button>
    <button type="button" data-channel="instagram">+ Akun Instagram DM</button>`;
  document.body.appendChild(menu);

  // Penting: WebContentsView (WA Web/Telegram Web/dst.) digambar di LAPISAN
  // NATIVE di atas seluruh halaman kita, di luar urutan DOM — jadi popup ini
  // WAJIB muncul di area sidebar (yang tidak ketutupan native view), bukan
  // ke kanan tombol (itu sudah masuk area channel-content yang ketutupan).
  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;

  menu.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', async () => {
      const channel = b.dataset.channel;
      menu.remove();
      const account = await window.hanmar.accounts.add(channel);
      const controller = mountAccount(channel, account);
      switchToAccount(account.id);
      controller.start();
    });
  });

  setTimeout(() => {
    const closeOnOutside = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('click', closeOnOutside);
      }
    };
    document.addEventListener('click', closeOnOutside);
  }, 0);
});

refreshSession();
