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
  document.getElementById('login-form').reset();
  document.getElementById('register-form').reset();
  showView('auth');
}
document.getElementById('main-logout-btn').addEventListener('click', doLogout);
document.getElementById('locked-logout-btn').addEventListener('click', doLogout);

// --- Retry (offline) ---
document.getElementById('retry-btn').addEventListener('click', refreshSession);

// --- WhatsApp (Fase 3) ---
const waEls = {
  pairing: document.getElementById('wa-pairing'),
  pairingConnecting: document.getElementById('wa-pairing-connecting'),
  pairingQr: document.getElementById('wa-pairing-qr'),
  pairingReconnecting: document.getElementById('wa-pairing-reconnecting'),
  qrImg: document.getElementById('wa-qr-img'),
  connected: document.getElementById('wa-connected'),
  chatlist: document.getElementById('wa-chatlist'),
  chatlistEmpty: document.getElementById('wa-chatlist-empty'),
  threadHeader: document.getElementById('wa-thread-header'),
  messages: document.getElementById('wa-messages'),
  sendForm: document.getElementById('wa-send-form'),
  messageInput: document.getElementById('wa-message-input'),
};

let waStarted = false;
let waChats = [];
let waActiveChatId = null;

function waShowPairing(mode) {
  waEls.connected.classList.add('hidden');
  waEls.pairing.classList.remove('hidden');
  waEls.pairingConnecting.classList.toggle('hidden', mode !== 'connecting');
  waEls.pairingQr.classList.toggle('hidden', mode !== 'qr');
  waEls.pairingReconnecting.classList.toggle('hidden', mode !== 'reconnecting');
}

function waShowConnected() {
  waEls.pairing.classList.add('hidden');
  waEls.connected.classList.remove('hidden');
}

function waFormatTime(ts) {
  return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function renderChatList() {
  waEls.chatlist.querySelectorAll('.wa-chat-item').forEach((el) => el.remove());
  waEls.chatlistEmpty.classList.toggle('hidden', waChats.length > 0);

  for (const chat of waChats) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wa-chat-item' + (chat.id === waActiveChatId ? ' active' : '');
    btn.innerHTML = `<span class="name">${escapeHtml(chat.name || chat.id)}</span><br><span class="preview">${escapeHtml(chat.lastMessageText || '')}</span>`;
    btn.addEventListener('click', () => selectChat(chat.id));
    waEls.chatlist.appendChild(btn);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

async function selectChat(chatId) {
  waActiveChatId = chatId;
  renderChatList();
  const chat = waChats.find((c) => c.id === chatId);
  waEls.threadHeader.textContent = chat ? (chat.name || chat.id) : chatId;
  waEls.sendForm.classList.remove('hidden');

  const messages = await window.hanmar.wa.getMessages(chatId);
  waEls.messages.innerHTML = '';
  for (const msg of messages) {
    appendMessageBubble(msg);
  }
  waEls.messages.scrollTop = waEls.messages.scrollHeight;
}

function appendMessageBubble(msg) {
  const bubble = document.createElement('div');
  bubble.className = 'wa-bubble ' + (msg.fromMe ? 'out' : 'in');
  bubble.innerHTML = `${escapeHtml(msg.text)}<span class="time">${waFormatTime(msg.timestamp)}</span>`;
  waEls.messages.appendChild(bubble);
}

async function startWhatsApp() {
  if (waStarted) return;
  waStarted = true;
  waShowPairing('connecting');
  try {
    await window.hanmar.wa.start();
  } catch (err) {
    waEls.pairingConnecting.querySelector('p').textContent = err.message || 'Gagal menyambungkan WhatsApp.';
  }
}

window.hanmar.wa.onQr((dataUrl) => {
  waEls.qrImg.src = dataUrl;
  waShowPairing('qr');
});

window.hanmar.wa.onStatus(async ({ status }) => {
  if (status === 'connected') {
    waChats = await window.hanmar.wa.getChats();
    renderChatList();
    waShowConnected();
  } else if (status === 'connecting') {
    waShowPairing('connecting');
  } else if (status === 'reconnecting') {
    waShowPairing('reconnecting');
  } else if (status === 'logged_out') {
    waChats = [];
    waActiveChatId = null;
    waStarted = false;
    waShowPairing('connecting');
  }
});

window.hanmar.wa.onChats((chats) => {
  waChats = chats;
  renderChatList();
});

window.hanmar.wa.onMessage(({ chatId, message }) => {
  if (chatId === waActiveChatId) {
    appendMessageBubble(message);
    waEls.messages.scrollTop = waEls.messages.scrollHeight;
  }
});

waEls.sendForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = waEls.messageInput.value;
  if (!text.trim() || !waActiveChatId) return;
  waEls.messageInput.value = '';
  try {
    await window.hanmar.wa.sendMessage(waActiveChatId, text);
  } catch (err) {
    alert(err.message || 'Gagal mengirim pesan.');
  }
});

refreshSession();
