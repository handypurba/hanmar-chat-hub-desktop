const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { app } = require('electron');

/**
 * Koneksi WhatsApp (Baileys, unofficial) — mendukung banyak akun sekaligus
 * (mis. "WA Pribadi" + "WA Bisnis"), masing-masing instance terpisah total
 * (socket, sesi auth, chat, pesan sendiri-sendiri).
 *
 * Baileys adalah ESM-only, sedangkan sisa app ini CommonJS — makanya modul
 * di-import secara dinamis (bukan require) di dalam start().
 */

let sendEvent = () => {}; // (accountId, channel, payload)
const instances = new Map(); // accountId -> instance state

function setSendEvent(fn) {
  sendEvent = fn;
}

function authDir(userId, accountId) {
  return path.join(app.getPath('userData'), 'wa-auth', String(userId), accountId);
}

function formatJid(jid) {
  return jid.split('@')[0];
}

function getOrCreateInstance(accountId) {
  let inst = instances.get(accountId);
  if (!inst) {
    inst = {
      sock: null,
      reconnectTimer: null,
      chatsById: new Map(),
      messagesByChat: new Map(),
      avatarCache: new Map(),
    };
    instances.set(accountId, inst);
  }
  return inst;
}

function getStatus(accountId) {
  const inst = instances.get(accountId);
  if (!inst) return 'disconnected';
  if (inst.sock && inst.sock.user) return 'connected';
  if (inst.sock) return 'connecting';
  return 'disconnected';
}

function upsertChatMeta(inst, chatId, patch) {
  if (!chatId || chatId === 'status@broadcast') return;
  const existing = inst.chatsById.get(chatId) || {
    id: chatId,
    name: formatJid(chatId),
    isGroup: chatId.endsWith('@g.us'),
    unreadCount: 0,
  };
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
    sendEvent(accountId, 'wa:chats', getChatsList(accountId));
  }
}

async function getAvatar(accountId, chatId) {
  const inst = instances.get(accountId);
  if (!inst) return null;
  if (inst.avatarCache.has(chatId)) return inst.avatarCache.get(chatId);
  if (!inst.sock) return null;

  try {
    const url = await inst.sock.profilePictureUrl(chatId, 'image');
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch avatar gagal');
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
    inst.avatarCache.set(chatId, dataUrl);
    return dataUrl;
  } catch {
    inst.avatarCache.set(chatId, null);
    return null;
  }
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

function handleIncomingMessage(accountId, inst, waMsg) {
  const chatId = waMsg.key?.remoteJid;
  if (!chatId || chatId === 'status@broadcast') return;

  const msgId = waMsg.key.id;
  const list = inst.messagesByChat.get(chatId) || [];
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
  inst.messagesByChat.set(chatId, list);

  const chat = inst.chatsById.get(chatId);
  const unreadCount = !entry.fromMe ? (chat?.unreadCount || 0) + 1 : chat?.unreadCount || 0;
  upsertChatMeta(inst, chatId, { lastMessageText: text, lastMessageAt: timestamp, unreadCount });
  sendEvent(accountId, 'wa:message', { chatId, message: entry });
  sendEvent(accountId, 'wa:chats', getChatsList(accountId));
}

async function stop(accountId) {
  const inst = instances.get(accountId);
  if (!inst) return;
  if (inst.reconnectTimer) {
    clearTimeout(inst.reconnectTimer);
    inst.reconnectTimer = null;
  }
  if (inst.sock) {
    try {
      inst.sock.end(undefined);
    } catch {
      // abaikan — socket mungkin sudah tertutup
    }
  }
  inst.sock = null;
}

async function stopAll() {
  await Promise.all(Array.from(instances.keys()).map(stop));
}

async function start(userId, accountId) {
  const inst = getOrCreateInstance(accountId);
  if (inst.sock) {
    return { status: getStatus(accountId) };
  }
  inst.chatsById.clear();
  inst.messagesByChat.clear();
  inst.avatarCache.clear();

  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } =
    await import('@whiskeysockets/baileys');

  const dir = authDir(userId, accountId);
  fs.mkdirSync(dir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(dir);

  // Versi protokol WA Web bawaan Baileys gampang basi (WhatsApp sering update
  // di sisi server) — kalau dipaksa pakai versi lama, WA langsung nutup
  // koneksi sebelum sempat kasih QR. Ambil versi terbaru tiap connect.
  let waVersion;
  try {
    ({ version: waVersion } = await fetchLatestBaileysVersion());
  } catch {
    waVersion = undefined;
  }

  const sock = makeWASocket({
    auth: state,
    version: waVersion,
    browser: Browsers.appropriate('Hanmar Chat Hub'),
    syncFullHistory: false,
  });
  inst.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
        sendEvent(accountId, 'wa:qr', dataUrl);
      } catch {
        // gagal generate QR — biarkan, Baileys akan kirim qr baru beberapa saat lagi
      }
    }

    if (connection === 'open') {
      sendEvent(accountId, 'wa:status', { status: 'connected' });
    } else if (connection === 'connecting') {
      sendEvent(accountId, 'wa:status', { status: 'connecting' });
    } else if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.error('[whatsapp]', accountId, 'connection closed, statusCode:', statusCode, 'loggedOut:', loggedOut, lastDisconnect?.error?.message);

      // Penting: socket lama sudah mati, HARUS di-null-kan di sini juga
      // (bukan cuma di path loggedOut) — kalau tidak, start() berikutnya
      // mengira masih ada koneksi aktif dan tidak pernah nyambung ulang.
      inst.sock = null;

      if (loggedOut) {
        fs.rmSync(dir, { recursive: true, force: true });
        sendEvent(accountId, 'wa:status', { status: 'logged_out' });
      } else {
        sendEvent(accountId, 'wa:status', { status: 'reconnecting' });
        inst.reconnectTimer = setTimeout(() => start(userId, accountId), 2000);
      }
    }
  });

  sock.ev.on('messaging-history.set', ({ chats }) => {
    for (const chat of chats || []) {
      upsertChatMeta(inst, chat.id, { name: chat.name || undefined });
    }
    sendEvent(accountId, 'wa:chats', getChatsList(accountId));
  });

  sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts || []) {
      upsertChatMeta(inst, c.id, { name: c.name || c.notify || undefined });
    }
    sendEvent(accountId, 'wa:chats', getChatsList(accountId));
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;
    for (const msg of messages || []) {
      handleIncomingMessage(accountId, inst, msg);
    }
  });

  return { status: getStatus(accountId) };
}

async function logoutWA(userId, accountId) {
  const inst = instances.get(accountId);
  if (inst?.sock) {
    try {
      await inst.sock.logout();
    } catch {
      // kalau gagal (mis. sudah offline), tetap lanjut bersihkan sesi lokal
    }
  }
  fs.rmSync(authDir(userId, accountId), { recursive: true, force: true });
  if (inst) {
    inst.sock = null;
    inst.chatsById.clear();
    inst.messagesByChat.clear();
  }
  sendEvent(accountId, 'wa:status', { status: 'logged_out' });
}

function removeInstance(accountId) {
  instances.delete(accountId);
}

async function sendMessage(accountId, chatId, text) {
  const inst = instances.get(accountId);
  if (!inst?.sock) {
    throw new Error('WhatsApp belum terhubung.');
  }
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('Pesan tidak boleh kosong.');
  }
  const sent = await inst.sock.sendMessage(chatId, { text: trimmed });
  if (sent) handleIncomingMessage(accountId, inst, sent);
  return { status: 'sent' };
}

module.exports = {
  setSendEvent,
  start,
  stop,
  stopAll,
  removeInstance,
  logoutWA,
  getStatus,
  getChatsList,
  getMessages,
  markChatRead,
  getAvatar,
  sendMessage,
};
