const os = require('os');

// Backend sudah live (24 Agustus 2026) di api.hanmar.biz.id — lihat PLANNING.md bagian 4.
const API_BASE_URL = process.env.HANMAR_API_URL || 'https://api.hanmar.biz.id/api';

async function apiRequest(path, { method = 'GET', body, token } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const error = new Error('Tidak bisa menghubungi server. Cek koneksi internet Anda.');
    error.code = 'network_error';
    throw error;
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // respons tanpa body (jarang terjadi di sini) — biarkan data null
  }

  if (!response.ok) {
    const firstFieldError = data && data.errors && Object.values(data.errors)[0]?.[0];
    const message = firstFieldError || (data && data.message) || `Request gagal (${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    error.code = (data && data.error) || null;
    error.data = data;
    throw error;
  }

  return data;
}

function register({ name, email, phone, password, deviceFingerprint }) {
  return apiRequest('/register', {
    method: 'POST',
    body: {
      name,
      email,
      phone,
      password,
      device_fingerprint: deviceFingerprint,
      device_name: os.hostname(),
    },
  });
}

function login({ email, password, deviceFingerprint }) {
  return apiRequest('/login', {
    method: 'POST',
    body: {
      email,
      password,
      device_fingerprint: deviceFingerprint,
      device_name: os.hostname(),
    },
  });
}

function logout({ token }) {
  return apiRequest('/logout', { method: 'POST', token });
}

function validateLicense({ token, deviceFingerprint }) {
  return apiRequest('/license/validate', {
    method: 'POST',
    token,
    body: { device_fingerprint: deviceFingerprint },
  });
}

// Dikirim tiap ~60 detik selagi app dibuka — dipakai dashboard admin buat
// status online/offline + halaman detail channel. device_fingerprint wajib
// disertakan supaya server tahu device MANA yang lapor (1 akun sekarang
// bisa lebih dari 1 device, lihat PLANNING.md soal paket 2 device).
function heartbeat({ token, deviceFingerprint, channels }) {
  return apiRequest('/heartbeat', {
    method: 'POST',
    token,
    body: { device_fingerprint: deviceFingerprint, channels },
  });
}

// --- Channel "Bisnis (dibagikan)" -- disimpan server, kelihatan sama di
// semua device akun ini (beda dari channel "Pribadi" yang tetap lokal,
// lihat main/account-store.js). Sesi login/cookie TIDAK ikut disinkron.
function listChannelAccounts({ token }) {
  return apiRequest('/channel-accounts', { token });
}

function addChannelAccount({ token, channel, label }) {
  return apiRequest('/channel-accounts', { method: 'POST', token, body: { channel, label } });
}

function renameChannelAccount({ token, id, label }) {
  return apiRequest(`/channel-accounts/${id}`, { method: 'PATCH', token, body: { label } });
}

function removeChannelAccount({ token, id }) {
  return apiRequest(`/channel-accounts/${id}`, { method: 'DELETE', token });
}

function reorderChannelAccounts({ token, orderedIds }) {
  return apiRequest('/channel-accounts/reorder', { method: 'POST', token, body: { ordered_ids: orderedIds } });
}

module.exports = {
  register,
  login,
  logout,
  validateLicense,
  heartbeat,
  listChannelAccounts,
  addChannelAccount,
  renameChannelAccount,
  removeChannelAccount,
  reorderChannelAccounts,
};
