const logger = require('../utils/logger');
const db     = require('../services/database');
const Reminder = require('../models/Reminder');

/*
 * Reminders are persisted to MongoDB when available so they survive restarts.
 * When the DB is down they fall back to an in-memory map. Only the minimal
 * data needed to fire (telegram api + chatId + message) is kept — never the
 * full ctx — so there is no memory leak from captured contexts.
 */
const inMemory = new Map(); // id -> { api, chatId, userId, message, fireAt }
let counter = 0;

async function loadCounter() {
  if (!db.isConnected()) return;
  try {
    const last = await Reminder.findOne().sort({ id: -1 }).select('id').lean();
    if (last && last.id) counter = last.id;
  } catch {}
}

// Serve persisted-but-not-yet-fired reminders on startup so restarts don't
// drop pending reminders.
async function reloadPending() {
  if (!db.isConnected()) return;
  try {
    const pending = await Reminder.find({ fired: false, fireAt: { $gt: new Date() } }).lean();
    for (const r of pending) inMemory.set(r.id, r);
    if (pending.length) logger.info(`Restored ${pending.length} pending reminders`);
  } catch {}
}

async function markFired(id) {
  if (!db.isConnected()) return;
  try { await Reminder.updateOne({ id }, { $set: { fired: true } }); } catch {}
}

async function fireReminder(id, r) {
  inMemory.delete(id);
  await markFired(id);
  try {
    // Resolve the Telegram API at fire time. Live reminders carry it directly;
    // reminders restored from DB fall back to the bot instance (required lazily
    // to avoid a circular require() at startup).
    const api = r.api || require('../bot').telegram;
    await api.sendMessage(
      r.chatId,
      `⏰ <b>Reminder!</b>\n\n${escapeHtml(r.message)}`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    logger.error('Failed to deliver reminder', { id, error: err.message });
  }
}

async function tick() {
  const now = Date.now();
  for (const [id, r] of inMemory) {
    if (new Date(r.fireAt).getTime() <= now) {
      fireReminder(id, r).catch(() => {});
    }
  }
}

setInterval(tick, 5000).unref();

module.exports = async (ctx) => {
  const text = ctx.message.text.replace(/^\/remind\s*/i, '').trim();

  if (!text) {
    return ctx.replyWithHTML(
      '⏰ <b>Reminders</b>\n\n<code>/remind 10m Deploy the bot</code>\n<code>/remind 1h Take a break</code>\n<code>/remind 30s Test reminder</code>\n\n<b>Units:</b> s (seconds), m (minutes), h (hours)'
    );
  }

  const match = text.match(/^(\d+)([smh])\s+(.+)/s);
  if (!match) {
    return ctx.reply('❌ Format: <code>/remind 10m Your message</code>');
  }

  const [_, amount, unit, message] = match;
  const multipliers = { s: 1000, m: 60000, h: 3600000 };
  const ms = parseInt(amount) * (multipliers[unit] || 60000);
  const fireAt = new Date(Date.now() + ms);

  const id = ++counter;
  const record = { id, api: ctx.telegram, chatId: ctx.chat.id, userId: ctx.from.id, message, fireAt };
  inMemory.set(id, record);

  // Persist best-effort; the in-memory copy fires even if persistence fails.
  if (db.isConnected()) {
    try { await Reminder.create(record); } catch (err) { logger.warn('Reminder persist failed', { error: err.message }); }
  }

  const unitLabels = { s: 'seconds', m: 'minutes', h: 'hours' };
  await ctx.reply(`⏰ Reminder set for <b>${amount} ${unitLabels[unit]}</b> from now.\n\n📝 "${message}"\n\nID: #${id}`);

  logger.info('Reminder set', { userId: ctx.from.id, amount, unit, message: message.slice(0, 50) });
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Restore pending reminders + counter once MongoDB is available. Startup races
// db.connect(), so retry every few seconds until it connects. Uses unref'd
// timers so this never keeps the process alive (graceful shutdown still works).
function startRestore() {
  const deadline = Date.now() + 2 * 60 * 1000;
  (function attempt() {
    if (Date.now() > deadline) return;
    if (db.isConnected()) {
      Promise.all([reloadPending(), loadCounter()]).catch(() => {});
      return;
    }
    setTimeout(attempt, 3000).unref();
  })();
}

// Load pending reminders on startup (non-blocking).
startRestore();