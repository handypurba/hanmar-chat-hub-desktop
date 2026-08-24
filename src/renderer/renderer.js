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

// --- Util bersama chat list/thread (dipakai WhatsApp & Telegram) ---
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', "Jum'at", 'Sabtu'];

/** Waktu preview di daftar chat: jam kalau hari ini, "Kemarin", nama hari (< 7 hari), atau tanggal. */
function formatSmartTime(ts) {
  const date = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((startOfToday - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);

  if (diffDays <= 0) return formatTime(ts);
  if (diffDays === 1) return 'Kemarin';
  if (diffDays < 7) return DAY_NAMES[date.getDay()];
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

/** Inisial 1-2 huruf buat avatar placeholder kalau belum ada/tidak ada foto profil. */
function initialsOf(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  const initials = parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
  return initials.toUpperCase();
}

/**
 * Chat list + thread pesan generik — dipakai baik untuk panel WhatsApp
 * maupun Telegram. `pane` adalah root elemen hasil clone template akun
 * (lihat createAccountController), isinya dicari lewat atribut data-*.
 */
function createChatPane(pane, channelApi) {
  const els = {
    chatlist: pane.querySelector('[data-chatlist]'),
    chatlistEmpty: pane.querySelector('[data-chatlist-empty]'),
    search: pane.querySelector('[data-search]'),
    threadHeader: pane.querySelector('[data-thread-header]'),
    messages: pane.querySelector('[data-messages]'),
    sendForm: pane.querySelector('[data-send-form]'),
    messageInput: pane.querySelector('[data-message-input]'),
  };
  const filterChips = pane.querySelectorAll('.filter-chip');
  const defaultEmptyText = els.chatlistEmpty.textContent;

  let chats = [];
  let activeChatId = null;
  let activeFilter = 'all';
  let searchQuery = '';

  function visibleChats() {
    return chats.filter((chat) => {
      if (activeFilter === 'unread' && !chat.unreadCount) return false;
      if (activeFilter === 'group' && !chat.isGroup) return false;
      if (searchQuery && !(chat.name || chat.id).toLowerCase().includes(searchQuery)) return false;
      return true;
    });
  }

  function renderChatList() {
    els.chatlist.querySelectorAll('.wa-chat-item').forEach((el) => el.remove());
    const list = visibleChats();
    els.chatlistEmpty.classList.toggle('hidden', list.length > 0);
    els.chatlistEmpty.textContent = chats.length === 0 ? defaultEmptyText : 'Tidak ada chat yang cocok.';

    for (const chat of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wa-chat-item' + (chat.id === activeChatId ? ' active' : '');
      btn.innerHTML = `
        <span class="wa-chat-avatar" data-chat-id="${escapeHtml(chat.id)}">${escapeHtml(initialsOf(chat.name || chat.id))}</span>
        <span class="wa-chat-item-body">
          <span class="wa-chat-item-toprow">
            <span class="name">${escapeHtml(chat.name || chat.id)}</span>
            <span class="time">${chat.lastMessageAt ? formatSmartTime(chat.lastMessageAt) : ''}</span>
          </span>
          <span class="wa-chat-item-bottomrow">
            <span class="preview">${escapeHtml(chat.lastMessageText || '')}</span>
            ${chat.unreadCount ? `<span class="unread-badge">${chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span>` : ''}
          </span>
        </span>`;
      btn.addEventListener('click', () => selectChat(chat.id));
      els.chatlist.appendChild(btn);
      loadAvatarInto(btn.querySelector('.wa-chat-avatar'), chat.id);
    }
  }

  async function loadAvatarInto(avatarEl, chatId) {
    try {
      const dataUrl = await channelApi.getAvatar(chatId);
      if (!dataUrl) return;
      if (avatarEl.dataset.chatId !== chatId || !avatarEl.isConnected) return;
      const img = document.createElement('img');
      img.className = 'wa-chat-avatar';
      img.src = dataUrl;
      img.alt = '';
      avatarEl.replaceWith(img);
    } catch {
      // biarkan pakai inisial kalau gagal ambil foto
    }
  }

  function appendMessageBubble(msg) {
    const bubble = document.createElement('div');
    bubble.className = 'wa-bubble ' + (msg.fromMe ? 'out' : 'in');
    bubble.innerHTML = `${escapeHtml(msg.text)}<span class="time">${formatTime(msg.timestamp)}</span>`;
    els.messages.appendChild(bubble);
  }

  async function selectChat(chatId) {
    activeChatId = chatId;
    const chat = chats.find((c) => c.id === chatId);
    if (chat && chat.unreadCount) {
      chat.unreadCount = 0;
      channelApi.markRead(chatId);
    }
    renderChatList();
    els.threadHeader.textContent = chat ? (chat.name || chat.id) : chatId;
    els.sendForm.classList.remove('hidden');

    const messages = await channelApi.getMessages(chatId);
    els.messages.innerHTML = '';
    for (const msg of messages) appendMessageBubble(msg);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  els.search.addEventListener('input', () => {
    searchQuery = els.search.value.trim().toLowerCase();
    renderChatList();
  });

  filterChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      filterChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.dataset.filter;
      renderChatList();
    });
  });

  els.sendForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = els.messageInput.value;
    if (!text.trim() || !activeChatId) return;
    els.messageInput.value = '';
    try {
      await channelApi.sendMessage(activeChatId, text);
    } catch (err) {
      alert(err.message || 'Gagal mengirim pesan.');
    }
  });

  return {
    setChats(newChats) {
      chats = newChats;
      renderChatList();
    },
    handleNewMessage({ chatId, message }) {
      if (chatId === activeChatId) {
        appendMessageBubble(message);
        els.messages.scrollTop = els.messages.scrollHeight;
      }
    },
    reset() {
      chats = [];
      activeChatId = null;
      searchQuery = '';
      els.search.value = '';
      els.messages.innerHTML = '';
      els.threadHeader.textContent = 'Pilih chat di sebelah kiri';
      els.sendForm.classList.add('hidden');
      renderChatList();
    },
  };
}

// =====================================================================
// Sidebar multi-akun: tiap akun (WhatsApp/Telegram) dapat pane sendiri
// (di-clone dari <template>), bisa ditambah/dihapus/rename/drag-reorder.
// =====================================================================

const channelNavList = document.getElementById('channel-nav-list');
const channelContent = document.getElementById('channel-content');
const waTemplate = document.getElementById('wa-account-template');
const tgTemplate = document.getElementById('tg-account-template');

const accountControllers = new Map(); // accountId -> controller
let activeAccountId = null;
let draggedAccountId = null;

function setNavDotOnline(accountId, online) {
  accountControllers.get(accountId)?.navBtn?.querySelector('[data-dot]')?.classList.toggle('online', online);
}

function switchToAccount(accountId) {
  activeAccountId = accountId;
  accountControllers.forEach((c) => {
    c.pane.classList.toggle('hidden', c.accountId !== accountId);
    c.navBtn?.classList.toggle('active', c.accountId === accountId);
  });
}

function setupWhatsAppPane(controller, pane) {
  const els = {
    pairing: pane.querySelector('[data-pairing]'),
    connecting: pane.querySelector('[data-pairing-connecting]'),
    qr: pane.querySelector('[data-pairing-qr]'),
    reconnecting: pane.querySelector('[data-pairing-reconnecting]'),
    qrImg: pane.querySelector('[data-qr-img]'),
    connected: pane.querySelector('[data-connected]'),
  };

  function showPairing(mode) {
    els.connected.classList.add('hidden');
    els.pairing.classList.remove('hidden');
    els.connecting.classList.toggle('hidden', mode !== 'connecting');
    els.qr.classList.toggle('hidden', mode !== 'qr');
    els.reconnecting.classList.toggle('hidden', mode !== 'reconnecting');
    setNavDotOnline(controller.accountId, false);
  }

  function showConnected() {
    els.pairing.classList.add('hidden');
    els.connected.classList.remove('hidden');
    setNavDotOnline(controller.accountId, true);
  }

  controller.start = async () => {
    if (controller.started) return;
    controller.started = true;
    showPairing('connecting');
    try {
      await window.hanmar.wa.start(controller.accountId);
    } catch (err) {
      els.connecting.querySelector('p').textContent = err.message || 'Gagal menyambungkan WhatsApp.';
    }
  };

  controller.onQr = (dataUrl) => {
    els.qrImg.src = dataUrl;
    showPairing('qr');
  };

  controller.onStatus = ({ status }) => {
    if (status === 'connected') {
      window.hanmar.wa.getChats(controller.accountId).then((chats) => controller.chatPane.setChats(chats));
      showConnected();
    } else if (status === 'connecting') {
      showPairing('connecting');
    } else if (status === 'reconnecting') {
      showPairing('reconnecting');
    } else if (status === 'logged_out') {
      controller.chatPane.reset();
      controller.started = false;
      controller.start();
    }
  };
}

function setupTelegramPane(controller, pane) {
  const els = {
    setup: pane.querySelector('[data-setup]'),
    connected: pane.querySelector('[data-connected]'),
    tokenForm: pane.querySelector('[data-token-form]'),
    tokenInput: pane.querySelector('[data-token-input]'),
    tokenError: pane.querySelector('[data-token-error]'),
  };

  function showSetup() {
    els.connected.classList.add('hidden');
    els.setup.classList.remove('hidden');
    setNavDotOnline(controller.accountId, false);
  }

  function showConnected() {
    els.setup.classList.add('hidden');
    els.connected.classList.remove('hidden');
    setNavDotOnline(controller.accountId, true);
  }

  controller.start = async () => {
    if (controller.started) return;
    const hasToken = await window.hanmar.tg.hasToken(controller.accountId);
    if (!hasToken) return; // biarkan form token kelihatan, tunggu input user
    controller.started = true;
    try {
      await window.hanmar.tg.start(controller.accountId);
    } catch (err) {
      els.tokenError.textContent = err.message || 'Gagal menyambungkan Telegram.';
      controller.started = false;
    }
  };

  els.tokenForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = els.tokenInput.value.trim();
    if (!token) return;
    els.tokenError.textContent = '';
    const btn = els.tokenForm.querySelector('button');
    btn.disabled = true;
    try {
      await window.hanmar.tg.start(controller.accountId, token);
      els.tokenInput.value = '';
      controller.started = true;
    } catch (err) {
      els.tokenError.textContent = err.message || 'Gagal menghubungkan bot.';
    } finally {
      btn.disabled = false;
    }
  });

  controller.onStatus = ({ status, error }) => {
    if (status === 'connected') {
      window.hanmar.tg.getChats(controller.accountId).then((chats) => controller.chatPane.setChats(chats));
      showConnected();
    } else if (status === 'disconnected') {
      controller.chatPane.reset();
      controller.started = false;
      showSetup();
    } else if (status === 'error') {
      els.tokenError.textContent = error || 'Terjadi kesalahan koneksi Telegram.';
      setNavDotOnline(controller.accountId, false);
    }
  };
}

function createAccountController(channel, account) {
  const template = channel === 'whatsapp' ? waTemplate : tgTemplate;
  const fragment = template.content.cloneNode(true);
  const pane = fragment.querySelector('[data-pane]');
  channelContent.appendChild(fragment);

  const rawApi = channel === 'whatsapp' ? window.hanmar.wa : window.hanmar.tg;
  const scopedApi = {
    getMessages: (chatId) => rawApi.getMessages(account.id, chatId),
    sendMessage: (chatId, text) => rawApi.sendMessage(account.id, chatId, text),
    markRead: (chatId) => rawApi.markRead(account.id, chatId),
    getAvatar: (chatId) => rawApi.getAvatar(account.id, chatId),
  };

  const controller = {
    channel,
    accountId: account.id,
    pane,
    chatPane: createChatPane(pane, scopedApi),
    navBtn: null,
    started: false,
  };

  if (channel === 'whatsapp') setupWhatsAppPane(controller, pane);
  else setupTelegramPane(controller, pane);

  return controller;
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

  const actions = document.createElement('span');
  actions.className = 'account-actions';
  actions.innerHTML = `
    <span class="account-action" data-action="rename" title="Ganti nama">✎</span>
    <span class="account-action" data-action="remove" title="Hapus akun">✕</span>`;

  btn.append(dot, label, actions);

  btn.addEventListener('click', (e) => {
    if (e.target.closest('[data-action]')) return;
    switchToAccount(controller.accountId);
  });
  actions.querySelector('[data-action="rename"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    const newLabel = prompt('Ganti nama akun:', account.label);
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
    if (!dragged || dragged.channel !== controller.channel || dragged === controller) return;
    e.preventDefault();
    btn.classList.add('drag-over');
  });
  btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
  btn.addEventListener('drop', async (e) => {
    e.preventDefault();
    btn.classList.remove('drag-over');
    const dragged = accountControllers.get(draggedAccountId);
    draggedAccountId = null;
    if (!dragged || dragged.channel !== controller.channel || dragged === controller) return;
    await reorderAccounts(controller.channel, dragged.accountId, controller.accountId);
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

function rebuildNavOrder() {
  const allIds = [...channelNavList.querySelectorAll('.account-btn')].map((el) => el.dataset.accountId);
  const waIds = allIds.filter((id) => accountControllers.get(id)?.channel === 'whatsapp');
  const tgIds = allIds.filter((id) => accountControllers.get(id)?.channel === 'telegram');
  // urutan render: cukup pindahkan node sesuai urutan baru dari account-store (dibaca ulang lewat DOM order saat ini)
  for (const id of [...waIds, ...tgIds]) {
    const btn = accountControllers.get(id)?.navBtn;
    if (btn) channelNavList.appendChild(btn);
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

async function initAccounts() {
  teardownAccounts();

  let waAccounts = await window.hanmar.accounts.list('whatsapp');
  if (waAccounts.length === 0) waAccounts = [await window.hanmar.accounts.add('whatsapp')];

  let tgAccounts = await window.hanmar.accounts.list('telegram');
  if (tgAccounts.length === 0) tgAccounts = [await window.hanmar.accounts.add('telegram')];

  for (const account of waAccounts) mountAccount('whatsapp', account);
  for (const account of tgAccounts) mountAccount('telegram', account);

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
    <button type="button" data-channel="telegram">+ Akun Telegram</button>`;
  document.body.appendChild(menu);

  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.left = `${rect.right + 8}px`;
  menu.style.top = `${rect.top}px`;

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

// --- Dispatcher event dari main process, di-subscribe sekali lalu diarahkan ke controller akun yang sesuai ---
window.hanmar.wa.onQr(({ accountId, data }) => accountControllers.get(accountId)?.onQr(data));
window.hanmar.wa.onStatus(({ accountId, data }) => accountControllers.get(accountId)?.onStatus(data));
window.hanmar.wa.onChats(({ accountId, data }) => accountControllers.get(accountId)?.chatPane.setChats(data));
window.hanmar.wa.onMessage(({ accountId, data }) => accountControllers.get(accountId)?.chatPane.handleNewMessage(data));

window.hanmar.tg.onStatus(({ accountId, data }) => accountControllers.get(accountId)?.onStatus(data));
window.hanmar.tg.onChats(({ accountId, data }) => accountControllers.get(accountId)?.chatPane.setChats(data));
window.hanmar.tg.onMessage(({ accountId, data }) => accountControllers.get(accountId)?.chatPane.handleNewMessage(data));

refreshSession();
