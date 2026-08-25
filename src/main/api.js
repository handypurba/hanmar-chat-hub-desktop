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

module.exports = { register, login, logout, validateLicense };
