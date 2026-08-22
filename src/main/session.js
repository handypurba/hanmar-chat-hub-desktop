const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { machineIdSync } = require('node-machine-id');

const SESSION_FILE = () => path.join(app.getPath('userData'), 'session.dat');

/**
 * Fingerprint device = hash(machine ID + MAC address interface utama).
 * Machine ID saja sudah cukup stabil, MAC ditambah sesuai keputusan di
 * PLANNING.md supaya lebih sulit dipalsukan dengan clone VM/disk image.
 * Kalau tidak ada NIC dengan MAC valid (jarang), fallback ke machine ID saja.
 */
function getDeviceFingerprint() {
  const machineId = machineIdSync(true);
  const mac = getPrimaryMacAddress();
  const raw = mac ? `${machineId}:${mac}` : machineId;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function getPrimaryMacAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return iface.mac;
      }
    }
  }
  return null;
}

/**
 * Token disimpan terenkripsi pakai Electron safeStorage (DPAPI di Windows) —
 * dienkripsi ke keychain user OS, bukan disimpan sebagai plaintext di disk.
 */
function saveToken(token) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Penyimpanan aman tidak tersedia di sistem ini.');
  }
  const encrypted = safeStorage.encryptString(token);
  fs.writeFileSync(SESSION_FILE(), encrypted);
}

function loadToken() {
  const file = SESSION_FILE();
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const encrypted = fs.readFileSync(file);
    return safeStorage.decryptString(encrypted);
  } catch {
    return null;
  }
}

function clearToken() {
  const file = SESSION_FILE();
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

module.exports = { getDeviceFingerprint, saveToken, loadToken, clearToken };
