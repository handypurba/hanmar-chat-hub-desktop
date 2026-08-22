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
  document.getElementById('login-form').reset();
  document.getElementById('register-form').reset();
  showView('auth');
}
document.getElementById('main-logout-btn').addEventListener('click', doLogout);
document.getElementById('locked-logout-btn').addEventListener('click', doLogout);

// --- Retry (offline) ---
document.getElementById('retry-btn').addEventListener('click', refreshSession);

refreshSession();
