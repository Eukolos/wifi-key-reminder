// index.js
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const TelegramBot = require('node-telegram-bot-api');

const app = express();

// ---- ENV ----
const TOKEN = process.env.TG_TOKEN;
let CHAT_ID = (process.env.TG_CHAT_ID || '').trim(); // boşsa otomatik yakalanır
const ALLOWED_USER_ID = parseInt(process.env.ALLOWED_USER_ID || '0', 10);

const PHONE_IP = process.env.PHONE_IP || '192.168.1.42';
const CHECK_EVERY = parseInt(process.env.CHECK_EVERY || '5', 10);
const ASK_DELAY = parseInt(process.env.ASK_DELAY || '90', 10);
const DEBOUNCE_UP = parseInt(process.env.DEBOUNCE_UP || '2', 10);
const DEBOUNCE_DOWN = parseInt(process.env.DEBOUNCE_DOWN || '3', 10);

const PORT = parseInt(process.env.PORT || '3000', 10);

if (!TOKEN) {
  console.error('TG_TOKEN eksik (.env)'); process.exit(1);
}

// ---- TELEGRAM BOT (long-polling) ----
const bot = new TelegramBot(TOKEN, { polling: true });

// data klasörü
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const CHAT_ID_FILE = path.join(DATA_DIR, 'chat_id.txt');

if (!CHAT_ID && fs.existsSync(CHAT_ID_FILE)) {
  CHAT_ID = fs.readFileSync(CHAT_ID_FILE, 'utf8').trim();
}

// chat_id otomatik yakalama
bot.on('message', (msg) => {
  try {
    if (!CHAT_ID) {
      CHAT_ID = String(msg.chat.id);
      fs.writeFileSync(CHAT_ID_FILE, CHAT_ID);
      bot.sendMessage(CHAT_ID, 'chat_id kaydedildi ✅');
      console.log('CHAT_ID=', CHAT_ID);
    }
  } catch (_) {}
});

// /myid komutu: kullanıcı id öğrenmek için
bot.onText(/\/myid/, (msg) => {
  bot.sendMessage(msg.chat.id, `your user id: ${msg.from.id}`);
});

// Buton cevapları (sadece izinli kullanıcı)
bot.on('callback_query', async (cbq) => {
  try {
    const data = cbq.data; // "EVET" | "HAYIR"
    const fromId = cbq.from.id;
    const chatId = cbq.message.chat.id;
    const mid = cbq.message.message_id;

    if (ALLOWED_USER_ID && fromId !== ALLOWED_USER_ID) {
      await bot.answerCallbackQuery(cbq.id, { text: 'Bu soruya sadece yetkili kişi cevap verebilir.', show_alert: true });
      return;
    }

    await bot.answerCallbackQuery(cbq.id, { text: 'teşekkürler ✔' });

    // FIX #2: Mesaj içeriği değişmediyse Telegram hata fırlatır
    const newText = `${cbq.message.text}\n\ncevap: ${data.toLowerCase()}`;
    const oldText = cbq.message.text;

    if (newText !== oldText) {
      await bot.editMessageText(newText, {
        chat_id: chatId,
        message_id: mid
      });
    }

    STATE.lastAnswer = { at: Date.now(), fromId, value: data };
  } catch (e) {
    console.error('callback_query error:', e.message);
  }
});

// ---- DURUM ----
const STATE = {
  isOnline: false,           // telefon wifi'de mi?
  onlineStreak: 0,
  offlineStreak: 0,
  askedThisSession: false,   // bu online oturumda bir soru soruldu mu?
  askAtTs: 0,                // online doğrulanınca ASK_DELAY sonrası zaman damgası
  lastPingOk: null,
  lastAskAt: null,
  lastAnswer: null
};

// ---- AĞ: ping (Raspberry Pi/Linux için optimize) ----
function pingOnce(ip) {
  return new Promise((resolve) => {
    // Raspberry Pi için -c 1 -W 1 (1 saniye timeout)
    const cmd = `ping -c 1 -W 1 ${ip}`;
    exec(cmd, (err) => resolve(!err));
  });
}

// ---- SORU GÖNDER ----
async function sendQuestion() {
  if (!CHAT_ID) return;
  const opts = {
    reply_markup: {
      inline_keyboard: [[
        { text: 'EVET ✅', callback_data: 'EVET' },
        { text: 'HAYIR ❌', callback_data: 'HAYIR' }
      ]]
    }
  };
  try {
    await bot.sendMessage(CHAT_ID, 'anahtarı anahtarlığa koydun mu?', opts);
    STATE.askedThisSession = true;
    STATE.lastAskAt = Date.now();
  } catch (e) {
    console.error('sendMessage error:', e.message);
  }
}

// ---- ANA DÖNGÜ ----
async function tick() {
  try {
    const nowOnline = await pingOnce(PHONE_IP);
    STATE.lastPingOk = nowOnline;

    if (nowOnline) {
      STATE.onlineStreak += 1;
      STATE.offlineStreak = 0;

      // offline -> online doğrulandı
      if (!STATE.isOnline && STATE.onlineStreak >= DEBOUNCE_UP) {
        STATE.isOnline = true;
        STATE.askedThisSession = false;
        STATE.askAtTs = Date.now() + ASK_DELAY * 1000;
        console.log(`📱 Telefon online oldu. Soru ${ASK_DELAY}s sonra sorulacak.`);
      }
    } else {
      STATE.offlineStreak += 1;
      STATE.onlineStreak = 0;

      // online -> offline doğrulandı (sıfırla)
      if (STATE.isOnline && STATE.offlineStreak >= DEBOUNCE_DOWN) {
        STATE.isOnline = false;
        STATE.askedThisSession = false;
        STATE.askAtTs = 0;
        console.log('📴 Telefon offline oldu. Session sıfırlandı.');
      }
    }

    // koşullar sağlandıysa bir kez sor
    if (STATE.isOnline && !STATE.askedThisSession && STATE.askAtTs && Date.now() >= STATE.askAtTs) {
      console.log('❓ Soru gönderiliyor...');
      await sendQuestion();
    }
  } catch (e) {
    // hatayı yut, logla
    console.error('tick error:', e.message);
  }
}

// FIX #3: Bellek sızıntısı önlemi - interval referansını sakla
let tickInterval = null;

function startMonitoring() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(tick, CHECK_EVERY * 1000);
  console.log(`Monitoring başladı: ${CHECK_EVERY}s periyot`);
}

function stopMonitoring() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
    console.log('Monitoring durduruldu');
  }
}

// ---- EXPRESS API ----
app.get('/status', (req, res) => {
  res.json({
    phoneIp: PHONE_IP,
    isOnline: STATE.isOnline,
    onlineStreak: STATE.onlineStreak,
    offlineStreak: STATE.offlineStreak,
    askedThisSession: STATE.askedThisSession,
    askDueInSec: STATE.askAtTs ? Math.max(0, Math.ceil((STATE.askAtTs - Date.now()) / 1000)) : null,
    lastPingOk: STATE.lastPingOk,
    lastAskAt: STATE.lastAskAt,
    lastAnswer: STATE.lastAnswer,
    chatId: CHAT_ID || null,
    allowedUserId: ALLOWED_USER_ID || null
  });
});

// manuel test: soruyu şimdi gönder
app.get('/ask/test', async (req, res) => {
  if (!CHAT_ID) return res.status(400).json({ ok: false, error: "CHAT_ID yok. Bot'a /start yazın." });
  await sendQuestion();
  res.json({ ok: true });
});

// monitoring kontrol endpoints
app.get('/monitoring/start', (req, res) => {
  startMonitoring();
  res.json({ ok: true, status: 'started' });
});

app.get('/monitoring/stop', (req, res) => {
  stopMonitoring();
  res.json({ ok: true, status: 'stopped' });
});

// kullanıcı id öğrenmek için web endpoint
app.get('/whoami/help', (req, res) => {
  res.send('Telegram\'da bota "/myid" yaz; dönen sayıyı .env -> ALLOWED_USER_ID olarak gir.');
});

// health
app.get('/health', (req, res) => res.json({ ok: true }));

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM sinyali alındı, temizleniyor...');
  stopMonitoring();
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT sinyali alındı, temizleniyor...');
  stopMonitoring();
  bot.stopPolling();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Express up on :${PORT}`);
  console.log('Bot polling aktif. Grupta /start@BotKullaniciAdin veya özelden /start yaz.');
  startMonitoring();
});
