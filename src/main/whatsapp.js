const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { app } = require('electron');

/**
 * Koneksi WhatsApp (Baileys, unofficial) — Fase 3.
 * Satu koneksi aktif per proses, di-scope ke userId Hanmar Chat Hub yang
 * sedang login (device-lock sudah menjamin 1 device = 1 user pada satu waktu).
 *
 * Baileys adalah ESM-only, sedangkan sisa app ini CommonJS — makanya modul
 * di-import secara dinamis (bukan require) di dalam start().
 */

let sock = null;
let currentUserId = null;
let sendEvent = () => {};
let reconnectTimer = null;

// State chat & pesan cuma di-memory (bukan disimpan ke disk) — riwayat pesan
// lama dari sebelum app dibuka TIDAK ikut termuat, ini keterbatasan Fase 3.
const chatsById = new Map();
const messagesByChat = new Map();

function authDir(userId) {
  return path.join(app.getPath('userData'), 'wa-auth', String(userId));
}

function setSendEvent(fn) {
  sendEvent = fn;
}

function getStatus() {
  if (sock && sock.user) return 'connected';
  if (sock) return 'connecting';
  return 'disconnected';
}

function formatJid(jid) {
  return jid.split('@')[0];
}

function upsertChatMeta(chatId, patch) {
  if (!chatId || chatId === 'status@broadcast') return;
  const existing = chatsById.get(chatId) || { id: chatId, name: formatJid(chatId) };
  const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  chatsById.set(chatId, { ...existing, ...cleanPatch });
}

function getChatsList() {
  return Array.from(chatsById.values()).sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
}

function getMessages(chatId) {
  return messagesByChat.get(chatId) || [];
}

function extractMessageText(message) {
  if (!message) return '[pesan tidak didukung]';
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage) return message.imageMessage.caption || '[gambar]';
  if (message.videoMessage) return message.videoMessage.caption || '[video]';
  if (message.documentMessage) return `[dokumen] ${message.documentMessage.fileName || ''}`.trim();
  if (message.audioMessage) return message.audioMessage.ptt ? '[pesan suara]' : '[audio]';
  if (message.stickerMessage) return '[stiker]';
  if (message.contactMessage) return '[kontak dibagikan]';
  if (message.locationMessage) return '[lokasi dibagikan]';
  return '[media]';
}

function handleIncomingMessage(waMsg) {
  const chatId = waMsg.key?.remoteJid;
  if (!chatId || chatId === 'status@broadcast') return;

  const msgId = waMsg.key.id;
  const list = messagesByChat.get(chatId) || [];
  if (msgId && list.some((m) => m.id === msgId)) return; // dedupe (sendMessage echo)

  const text = extractMessageText(waMsg.message);
  const timestamp = (Number(waMsg.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000;

  const entry = {
    id: msgId,
    fromMe: !!waMsg.key.fromMe,
    text,
    timestamp,
    senderName: waMsg.pushName || undefined,
  };

  list.push(entry);
  messagesByChat.set(chatId, list);

  upsertChatMeta(chatId, { lastMessageText: text, lastMessageAt: timestamp });
  sendEvent('wa:message', { chatId, message: entry });
  sendEvent('wa:chats', getChatsList());
}

async function stop() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (sock) {
    try {
      sock.end(undefined);
    } catch {
      // abaikan — socket mungkin sudah tertutup
    }
  }
  sock = null;
}

async function start(userId) {
  if (sock && currentUserId === userId) {
    return { status: getStatus() };
  }
  await stop();
  currentUserId = userId;
  chatsById.clear();
  messagesByChat.clear();

  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } =
    await import('@whiskeysockets/baileys');

  const dir = authDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(dir);

  // Versi protokol WA Web bawaan Baileys gampang basi (WhatsApp sering update
  // di sisi server) — kalau dipaksa pakai versi lama, WA langsung nutup
  // koneksi sebelum sempat kasih QR. Ambil versi terbaru tiap connect.
  let waVersion;
  try {
    ({ version: waVersion } = await fetchLatestBaileysVersion());
  } catch {
    waVersion = undefined; // gagal cek versi terbaru (mis. offline) — biarkan Baileys pakai default-nya
  }

  sock = makeWASocket({
    auth: state,
    version: waVersion,
    browser: Browsers.appropriate('Hanmar Chat Hub'),
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
        sendEvent('wa:qr', dataUrl);
      } catch {
        // gagal generate QR — biarkan, Baileys akan kirim qr baru beberapa saat lagi
      }
    }

    if (connection === 'open') {
      sendEvent('wa:status', { status: 'connected' });
    } else if (connection === 'connecting') {
      sendEvent('wa:status', { status: 'connecting' });
    } else if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.error('[whatsapp] connection closed, statusCode:', statusCode, 'loggedOut:', loggedOut, lastDisconnect?.error?.message);

      // Penting: socket lama sudah mati, HARUS di-null-kan di sini juga
      // (bukan cuma di path loggedOut) — kalau tidak, start() berikutnya
      // mengira masih ada koneksi aktif (`if (sock && ...) return`) dan
      // tidak pernah benar-benar nyambung ulang, nyangkut di "reconnecting".
      sock = null;

      if (loggedOut) {
        fs.rmSync(dir, { recursive: true, force: true });
        sendEvent('wa:status', { status: 'logged_out' });
      } else {
        sendEvent('wa:status', { status: 'reconnecting' });
        const uid = userId;
        reconnectTimer = setTimeout(() => start(uid), 2000);
      }
    }
  });

  sock.ev.on('messaging-history.set', ({ chats }) => {
    for (const chat of chats || []) {
      upsertChatMeta(chat.id, { name: chat.name || undefined });
    }
    sendEvent('wa:chats', getChatsList());
  });

  sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts || []) {
      upsertChatMeta(c.id, { name: c.name || c.notify || undefined });
    }
    sendEvent('wa:chats', getChatsList());
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;
    for (const msg of messages || []) {
      handleIncomingMessage(msg);
    }
  });

  return { status: getStatus() };
}

async function logoutWA() {
  if (sock) {
    try {
      await sock.logout();
    } catch {
      // kalau gagal (mis. sudah offline), tetap lanjut bersihkan sesi lokal
    }
  }
  if (currentUserId) {
    fs.rmSync(authDir(currentUserId), { recursive: true, force: true });
  }
  sock = null;
  chatsById.clear();
  messagesByChat.clear();
  sendEvent('wa:status', { status: 'logged_out' });
}

async function sendMessage(chatId, text) {
  if (!sock) {
    throw new Error('WhatsApp belum terhubung.');
  }
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('Pesan tidak boleh kosong.');
  }
  const sent = await sock.sendMessage(chatId, { text: trimmed });
  if (sent) handleIncomingMessage(sent);
  return { status: 'sent' };
}

module.exports = { setSendEvent, start, stop, logoutWA, getStatus, getChatsList, getMessages, sendMessage };
