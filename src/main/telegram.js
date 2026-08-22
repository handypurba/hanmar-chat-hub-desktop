const path = require('path');
const fs = require('fs');
const { app, safeStorage } = require('electron');
const TelegramBot = require('node-telegram-bot-api');

/**
 * Koneksi Telegram (Bot API resmi, mode polling) — Fase 4.
 * Beda dari WhatsApp: kredensialnya cuma satu token bot yang dibuat
 * pelanggan sendiri lewat @BotFather, bukan hasil pairing QR.
 */

let bot = null;
let currentUserId = null;
let sendEvent = () => {};

const chatsById = new Map();
const messagesByChat = new Map();

function tokenFile(userId) {
  return path.join(app.getPath('userData'), 'telegram-auth', `${userId}.dat`);
}

function saveToken(userId, token) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Penyimpanan aman tidak tersedia di sistem ini.');
  }
  const file = tokenFile(userId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, safeStorage.encryptString(token));
}

function loadToken(userId) {
  const file = tokenFile(userId);
  if (!fs.existsSync(file)) return null;
  try {
    return safeStorage.decryptString(fs.readFileSync(file));
  } catch {
    return null;
  }
}

function clearToken(userId) {
  const file = tokenFile(userId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function hasSavedToken(userId) {
  return !!loadToken(userId);
}

function setSendEvent(fn) {
  sendEvent = fn;
}

function getStatus() {
  return bot ? 'connected' : 'disconnected';
}

function upsertChatMeta(chatId, patch) {
  const existing = chatsById.get(chatId) || { id: chatId, name: chatId };
  const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  chatsById.set(chatId, { ...existing, ...cleanPatch });
}

function getChatsList() {
  return Array.from(chatsById.values()).sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
}

function getMessages(chatId) {
  return messagesByChat.get(chatId) || [];
}

function chatDisplayName(chat) {
  if (!chat) return 'Tidak dikenal';
  if (chat.title) return chat.title; // grup/channel
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

function handleMessage(msg, fromMe = false) {
  if (!msg?.chat) return;
  const chatId = String(msg.chat.id);
  const msgId = String(msg.message_id);

  const list = messagesByChat.get(chatId) || [];
  if (list.some((m) => m.id === msgId)) return; // dedupe

  const text = extractText(msg);
  const timestamp = (msg.date || Math.floor(Date.now() / 1000)) * 1000;
  const senderName = msg.from ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') : undefined;

  const entry = { id: msgId, fromMe, text, timestamp, senderName };
  list.push(entry);
  messagesByChat.set(chatId, list);

  upsertChatMeta(chatId, { name: chatDisplayName(msg.chat), lastMessageText: text, lastMessageAt: timestamp });
  sendEvent('tg:message', { chatId, message: entry });
  sendEvent('tg:chats', getChatsList());
}

async function stop() {
  if (bot) {
    try {
      await bot.stopPolling();
    } catch {
      // abaikan — bot mungkin sudah berhenti
    }
  }
  bot = null;
}

/**
 * @param {number} userId
 * @param {string|null} token - kalau null, pakai token tersimpan (auto-resume)
 */
async function start(userId, token) {
  const useToken = token || loadToken(userId);
  if (!useToken) {
    return { status: 'need_token' };
  }
  if (bot && currentUserId === userId) {
    return { status: getStatus() };
  }

  await stop();
  currentUserId = userId;
  chatsById.clear();
  messagesByChat.clear();

  const candidate = new TelegramBot(useToken, { polling: false });

  let me;
  try {
    me = await candidate.getMe();
  } catch {
    throw new Error('Token bot tidak valid atau tidak bisa dihubungi. Cek lagi token dari @BotFather.');
  }

  bot = candidate;
  bot.on('polling_error', (err) => {
    sendEvent('tg:status', { status: 'error', error: err.message });
  });
  bot.on('message', (msg) => handleMessage(msg, false));
  bot.startPolling();

  saveToken(userId, useToken);
  sendEvent('tg:status', { status: 'connected', botUsername: me.username });
  return { status: 'connected', botUsername: me.username };
}

async function disconnect(userId) {
  await stop();
  clearToken(userId);
  chatsById.clear();
  messagesByChat.clear();
  currentUserId = null;
  sendEvent('tg:status', { status: 'disconnected' });
}

async function sendMessage(chatId, text) {
  if (!bot) {
    throw new Error('Bot Telegram belum terhubung.');
  }
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('Pesan tidak boleh kosong.');
  }
  const sent = await bot.sendMessage(chatId, trimmed);
  handleMessage(sent, true);
  return { status: 'sent' };
}

module.exports = {
  setSendEvent,
  start,
  stop,
  disconnect,
  hasSavedToken,
  getStatus,
  getChatsList,
  getMessages,
  sendMessage,
};
