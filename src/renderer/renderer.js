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
  startWhatsApp();
  startTelegram();
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
  waStarted = false;
  tgStarted = false;
  waChatPane.reset();
  tgChatPane.reset();
  document.getElementById('login-form').reset();
  document.getElementById('register-form').reset();
  showView('auth');
}
document.getElementById('main-logout-btn').addEventListener('click', doLogout);
document.getElementById('locked-logout-btn').addEventListener('click', doLogout);

// --- Retry (offline) ---
document.getElementById('retry-btn').addEventListener('click', refreshSession);

// --- Channel switcher (nav kiri di layar utama) ---
document.querySelectorAll('.channel-btn[data-channel]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.channel-btn[data-channel]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.channel-pane').forEach((p) => p.classList.add('hidden'));
    document.getElementById(`channel-${btn.dataset.channel}`).classList.remove('hidden');
  });
});

// --- Util bersama chat list/thread (dipakai WhatsApp & Telegram) ---
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Chat list + thread pesan generik — dipakai baik untuk panel WhatsApp
 * maupun Telegram (elemen DOM-nya sama-sama pakai class `.wa-*`, cuma beda
 * id prefix per channel).
 */
function createChatPane(idPrefix, channelApi) {
  const els = {
    connected: document.getElementById(`${idPrefix}-connected`),
    chatlist: document.getElementById(`${idPrefix}-chatlist`),
    chatlistEmpty: document.getElementById(`${idPrefix}-chatlist-empty`),
    threadHeader: document.getElementById(`${idPrefix}-thread-header`),
    messages: document.getElementById(`${idPrefix}-messages`),
    sendForm: document.getElementById(`${idPrefix}-send-form`),
    messageInput: document.getElementById(`${idPrefix}-message-input`),
  };

  let chats = [];
  let activeChatId = null;

  function renderChatList() {
    els.chatlist.querySelectorAll('.wa-chat-item').forEach((el) => el.remove());
    els.chatlistEmpty.classList.toggle('hidden', chats.length > 0);

    for (const chat of chats) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wa-chat-item' + (chat.id === activeChatId ? ' active' : '');
      btn.innerHTML = `<span class="name">${escapeHtml(chat.name || chat.id)}</span><br><span class="preview">${escapeHtml(chat.lastMessageText || '')}</span>`;
      btn.addEventListener('click', () => selectChat(chat.id));
      els.chatlist.appendChild(btn);
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
    renderChatList();
    const chat = chats.find((c) => c.id === chatId);
    els.threadHeader.textContent = chat ? (chat.name || chat.id) : chatId;
    els.sendForm.classList.remove('hidden');

    const messages = await channelApi.getMessages(chatId);
    els.messages.innerHTML = '';
    for (const msg of messages) appendMessageBubble(msg);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

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

  channelApi.onChats((newChats) => {
    chats = newChats;
    renderChatList();
  });

  channelApi.onMessage(({ chatId, message }) => {
    if (chatId === activeChatId) {
      appendMessageBubble(message);
      els.messages.scrollTop = els.messages.scrollHeight;
    }
  });

  return {
    setChats(newChats) {
      chats = newChats;
      renderChatList();
    },
    reset() {
      chats = [];
      activeChatId = null;
      els.messages.innerHTML = '';
      els.threadHeader.textContent = 'Pilih chat di sebelah kiri';
      els.sendForm.classList.add('hidden');
      renderChatList();
    },
  };
}

// --- WhatsApp (Fase 3) ---
const waChatPane = createChatPane('wa', window.hanmar.wa);
const waPairingEls = {
  pairing: document.getElementById('wa-pairing'),
  connecting: document.getElementById('wa-pairing-connecting'),
  qr: document.getElementById('wa-pairing-qr'),
  reconnecting: document.getElementById('wa-pairing-reconnecting'),
  qrImg: document.getElementById('wa-qr-img'),
  connected: document.getElementById('wa-connected'),
};
let waStarted = false;

function waShowPairing(mode) {
  waPairingEls.connected.classList.add('hidden');
  waPairingEls.pairing.classList.remove('hidden');
  waPairingEls.connecting.classList.toggle('hidden', mode !== 'connecting');
  waPairingEls.qr.classList.toggle('hidden', mode !== 'qr');
  waPairingEls.reconnecting.classList.toggle('hidden', mode !== 'reconnecting');
  document.getElementById('wa-dot').classList.remove('online');
}

function waShowConnected() {
  waPairingEls.pairing.classList.add('hidden');
  waPairingEls.connected.classList.remove('hidden');
  document.getElementById('wa-dot').classList.add('online');
}

async function startWhatsApp() {
  if (waStarted) return;
  waStarted = true;
  waShowPairing('connecting');
  try {
    await window.hanmar.wa.start();
  } catch (err) {
    waPairingEls.connecting.querySelector('p').textContent = err.message || 'Gagal menyambungkan WhatsApp.';
  }
}

window.hanmar.wa.onQr((dataUrl) => {
  waPairingEls.qrImg.src = dataUrl;
  waShowPairing('qr');
});

window.hanmar.wa.onStatus(async ({ status }) => {
  if (status === 'connected') {
    waChatPane.setChats(await window.hanmar.wa.getChats());
    waShowConnected();
  } else if (status === 'connecting') {
    waShowPairing('connecting');
  } else if (status === 'reconnecting') {
    waShowPairing('reconnecting');
  } else if (status === 'logged_out') {
    waChatPane.reset();
    waStarted = false;
    waShowPairing('connecting');
  }
});

// --- Telegram (Fase 4) ---
const tgChatPane = createChatPane('tg', window.hanmar.tg);
const tgEls = {
  setup: document.getElementById('tg-setup'),
  connected: document.getElementById('tg-connected'),
  tokenForm: document.getElementById('tg-token-form'),
  tokenInput: document.getElementById('tg-token-input'),
  tokenError: document.getElementById('tg-token-error'),
};
let tgStarted = false;

function tgShowSetup() {
  tgEls.connected.classList.add('hidden');
  tgEls.setup.classList.remove('hidden');
  document.getElementById('tg-dot').classList.remove('online');
}

function tgShowConnected() {
  tgEls.setup.classList.add('hidden');
  tgEls.connected.classList.remove('hidden');
  document.getElementById('tg-dot').classList.add('online');
}

async function startTelegram() {
  if (tgStarted) return;
  tgStarted = true;
  const hasToken = await window.hanmar.tg.hasToken();
  if (!hasToken) return; // biarkan form token kelihatan, tunggu input user

  try {
    await window.hanmar.tg.start();
  } catch (err) {
    tgEls.tokenError.textContent = err.message || 'Gagal menyambungkan Telegram.';
    tgStarted = false;
  }
}

tgEls.tokenForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = tgEls.tokenInput.value.trim();
  if (!token) return;
  tgEls.tokenError.textContent = '';
  const btn = tgEls.tokenForm.querySelector('button');
  btn.disabled = true;
  try {
    await window.hanmar.tg.start(token);
    tgEls.tokenInput.value = '';
    tgStarted = true;
  } catch (err) {
    tgEls.tokenError.textContent = err.message || 'Gagal menghubungkan bot.';
  } finally {
    btn.disabled = false;
  }
});

window.hanmar.tg.onStatus(async ({ status, error }) => {
  if (status === 'connected') {
    tgChatPane.setChats(await window.hanmar.tg.getChats());
    tgShowConnected();
  } else if (status === 'disconnected') {
    tgChatPane.reset();
    tgStarted = false;
    tgShowSetup();
  } else if (status === 'error') {
    tgEls.tokenError.textContent = error || 'Terjadi kesalahan koneksi Telegram.';
  }
});

refreshSession();
