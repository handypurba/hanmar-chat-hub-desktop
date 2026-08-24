const path = require('path');
const fs = require('fs');
const { app, safeStorage } = require('electron');
const TelegramBot = require('node-telegram-bot-api');

/**
 * Koneksi Telegram (Bot API resmi, mode polling) — mendukung banyak akun
 * (bot) sekaligus, masing-masing instance terpisah total.
 */

let sendEvent = () => {}; // (accountId, channel, payload)
const instances = new Map(); // accountId -> instance state

function setSendEvent(fn) {
  sendEvent = fn;
}

function tokenFile(userId, accountId) {
  return path.join(app.getPath('userData'), 'telegram-auth', String(userId), `${accountId}.dat`);
}

function saveToken(userId, accountId, token) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Penyimpanan aman tidak tersedia di sistem ini.');
  }
  const file = tokenFile(userId, accountId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, safeStorage.encryptString(token));
}

function loadToken(userId, accountId) {
  const file = tokenFile(userId, accountId);
  if (!fs.existsSync(file)) return null;
  try {
    return safeStorage.decryptString(fs.readFileSync(file));
  } catch {
    return null;
  }
}

function clearToken(userId, accountId) {
  const file = tokenFile(userId, accountId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function hasSavedToken(userId, accountId) {
  return !!loadToken(userId, accountId);
}

function getOrCreateInstance(accountId) {
  let inst = instances.get(accountId);
  if (!inst) {
    inst = { bot: null, chatsById: new Map(), messagesByChat: new Map(), avatarCache: new Map() };
    instances.set(accountId, inst);
  }
  return inst;
}

function getStatus(accountId) {
  return instances.get(accountId)?.bot ? 'connected' : 'disconnected';
}

function upsertChatMeta(inst, chatId, patch) {
  const existing = inst.chatsById.get(chatId) || { id: chatId, name: chatId, isGroup: false, unreadCount: 0 };
  const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  inst.chatsById.set(chatId, { ...existing, ...cleanPatch });
}

function getChatsList(accountId) {
  const inst = instances.get(accountId);
  if (!inst) return [];
  return Array.from(inst.chatsById.values()).sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
}

function getMessages(accountId, chatId) {
  return instances.get(accountId)?.messagesByChat.get(chatId) || [];
}

function markChatRead(accountId, chatId) {
  const inst = instances.get(accountId);
  const chat = inst?.chatsById.get(chatId);
  if (chat && chat.unreadCount) {
    upsertChatMeta(inst, chatId, { unreadCount: 0 });
    sendEvent(accountId, 'tg:chats', getChatsList(accountId));
  }
}

async function getAvatar(accountId, chatId) {
  const inst = instances.get(accountId);
  if (!inst) return null;
  if (inst.avatarCache.has(chatId)) return inst.avatarCache.get(chatId);
  if (!inst.bot) return null;

  try {
    const photos = await inst.bot.getUserProfilePhotos(chatId, { limit: 1 }).catch(() => null);
    const fileId = photos?.photos?.[0]?.[0]?.file_id;
    if (!fileId) {
      inst.avatarCache.set(chatId, null);
      return null;
    }
    const fileLink = await inst.bot.getFileLink(fileId);
    const res = await fetch(fileLink);
    if (!res.ok) throw new Error('fetch avatar gagal');
    const buffer = Buffer.from(await res.arrayBuffer());
    const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    inst.avatarCache.set(chatId, dataUrl);
    return dataUrl;
  } catch {
    inst.avatarCache.set(chatId, null);
    return null;
  }
}

function chatDisplayName(chat) {
  if (!chat) return 'Tidak dikenal';
  if (chat.title) return chat.title;
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ');
  return name || chat.username || String(chat.id);
}

function extractText(msg) {
  if (msg.text) return msg.text;
  if (msg.caption) return msg.caption;
  if (msg.photo) return '[gambar]';
  if (msg.video) return '[video]';
  if (msg.document) return `[dokumen] ${msg.document.file_name || ''}`.trim();
  if (msg.voice) return '[pesan suara]';
  if (msg.audio) return '[audio]';
  if (msg.sticker) return '[stiker]';
  if (msg.location) return '[lokasi dibagikan]';
  if (msg.contact) return '[kontak dibagikan]';
  return '[pesan tidak didukung]';
}

function handleMessage(accountId, inst, msg, fromMe = false) {
  if (!msg?.chat) return;
  const chatId = String(msg.chat.id);
  const msgId = String(msg.message_id);

  const list = inst.messagesByChat.get(chatId) || [];
  if (list.some((m) => m.id === msgId)) return; // dedupe

  const text = extractText(msg);
  const timestamp = (msg.date || Math.floor(Date.now() / 1000)) * 1000;
  const senderName = msg.from ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') : undefined;

  const entry = { id: msgId, fromMe, text, timestamp, senderName };
  list.push(entry);
  inst.messagesByChat.set(chatId, list);

  const chat = inst.chatsById.get(chatId);
  const unreadCount = !fromMe ? (chat?.unreadCount || 0) + 1 : chat?.unreadCount || 0;
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
  upsertChatMeta(inst, chatId, {
    name: chatDisplayName(msg.chat),
    lastMessageText: text,
    lastMessageAt: timestamp,
    unreadCount,
    isGroup,
  });
  sendEvent(accountId, 'tg:message', { chatId, message: entry });
  sendEvent(accountId, 'tg:chats', getChatsList(accountId));
}

async function stop(accountId) {
  const inst = instances.get(accountId);
  if (!inst?.bot) return;
  try {
    await inst.bot.stopPolling();
  } catch {
    // abaikan — bot mungkin sudah berhenti
  }
  inst.bot = null;
}

async function stopAll() {
  await Promise.all(Array.from(instances.keys()).map(stop));
}

/**
 * @param {string|null} token - kalau null, pakai token tersimpan (auto-resume)
 */
async function start(userId, accountId, token) {
  const useToken = token || loadToken(userId, accountId);
  if (!useToken) {
    return { status: 'need_token' };
  }

  const inst = getOrCreateInstance(accountId);
  if (inst.bot) {
    return { status: getStatus(accountId) };
  }
  inst.chatsById.clear();
  inst.messagesByChat.clear();
  inst.avatarCache.clear();

  const candidate = new TelegramBot(useToken, { polling: false });

  let me;
  try {
    me = await candidate.getMe();
  } catch {
    throw new Error('Token bot tidak valid atau tidak bisa dihubungi. Cek lagi token dari @BotFather.');
  }

  inst.bot = candidate;
  candidate.on('polling_error', (err) => {
    sendEvent(accountId, 'tg:status', { status: 'error', error: err.message });
  });
  candidate.on('message', (msg) => handleMessage(accountId, inst, msg, false));
  candidate.startPolling();

  saveToken(userId, accountId, useToken);
  sendEvent(accountId, 'tg:status', { status: 'connected', botUsername: me.username });
  return { status: 'connected', botUsername: me.username };
}

async function disconnect(userId, accountId) {
  await stop(accountId);
  clearToken(userId, accountId);
  const inst = instances.get(accountId);
  if (inst) {
    inst.chatsById.clear();
    inst.messagesByChat.clear();
  }
  sendEvent(accountId, 'tg:status', { status: 'disconnected' });
}

function removeInstance(accountId) {
  instances.delete(accountId);
}

async function sendMessage(accountId, chatId, text) {
  const inst = instances.get(accountId);
  if (!inst?.bot) {
    throw new Error('Bot Telegram belum terhubung.');
  }
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('Pesan tidak boleh kosong.');
  }
  const sent = await inst.bot.sendMessage(chatId, trimmed);
  handleMessage(accountId, inst, sent, true);
  return { status: 'sent' };
}

module.exports = {
  setSendEvent,
  start,
  stop,
  stopAll,
  removeInstance,
  disconnect,
  hasSavedToken,
  getStatus,
  getChatsList,
  getMessages,
  markChatRead,
  getAvatar,
  sendMessage,
};
