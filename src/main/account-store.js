const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');

/**
 * Daftar akun channel (WhatsApp/Telegram) milik user — mendukung lebih dari
 * satu akun per channel (mis. "WA Pribadi" + "WA Bisnis"), bisa
 * ditambah/dihapus/rename/diurutkan ulang dari sidebar.
 * Disimpan sebagai JSON di userData (bukan di backend — ini murni preferensi
 * lokal device ini, konsisten dengan sesi WA/token bot yang juga lokal).
 */

function storeFile(userId) {
  return path.join(app.getPath('userData'), 'accounts', `${userId}.json`);
}

function readAll(userId) {
  const file = storeFile(userId);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeAll(userId, data) {
  const file = storeFile(userId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function list(userId, channel) {
  const data = readAll(userId);
  return (data[channel] || []).slice().sort((a, b) => a.order - b.order);
}

function add(userId, channel, label) {
  const data = readAll(userId);
  const accounts = data[channel] || (data[channel] = []);
  const account = {
    id: crypto.randomUUID(),
    label: label || defaultLabel(channel, accounts.length),
    order: accounts.length,
  };
  accounts.push(account);
  writeAll(userId, data);
  return account;
}

function remove(userId, channel, accountId) {
  const data = readAll(userId);
  data[channel] = (data[channel] || []).filter((a) => a.id !== accountId);
  // rapikan urutan biar tidak bolong
  data[channel].forEach((a, i) => { a.order = i; });
  writeAll(userId, data);
}

function rename(userId, channel, accountId, label) {
  const data = readAll(userId);
  const account = (data[channel] || []).find((a) => a.id === accountId);
  if (account && label?.trim()) {
    account.label = label.trim();
    writeAll(userId, data);
  }
  return account;
}

function reorder(userId, channel, orderedIds) {
  const data = readAll(userId);
  const accounts = data[channel] || [];
  orderedIds.forEach((id, i) => {
    const account = accounts.find((a) => a.id === id);
    if (account) account.order = i;
  });
  writeAll(userId, data);
}

/**
 * Urutan channel di sidebar — defaultnya tetap WA->TG->Shopee->Tokopedia->
 * Messenger->Instagram, tapi pemilik boleh geser bebas (drag antar-channel
 * di sidebar). Disimpan di key `_channelOrder`, terpisah dari daftar akun
 * per channel supaya tidak tertukar dengan nama channel asli.
 */
function getChannelOrder(userId, defaultOrder) {
  const data = readAll(userId);
  return Array.isArray(data._channelOrder) && data._channelOrder.length
    ? data._channelOrder
    : defaultOrder;
}

function setChannelOrder(userId, order) {
  const data = readAll(userId);
  data._channelOrder = order;
  writeAll(userId, data);
}

const CHANNEL_BASE_LABEL = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  shopee: 'Shopee',
  tokopedia: 'Tokopedia/TikTok',
  messenger: 'Messenger',
  instagram: 'Instagram DM',
};

function defaultLabel(channel, index) {
  const base = CHANNEL_BASE_LABEL[channel] || channel;
  return index === 0 ? base : `${base} ${index + 1}`;
}

module.exports = { list, add, remove, rename, reorder, getChannelOrder, setChannelOrder };
