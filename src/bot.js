const { Telegraf, session } = require('telegraf');
const config = require('../config');

/* ── Middleware ───────────────────────────────────────────────────── */
const requestLogger = require('./middleware/requestLogger');
const rateLimit     = require('./middleware/rateLimit');
const auth          = require('./middleware/auth');

/* ── Commands ────────────────────────────────────────────────────── */
const startCmd   = require('./commands/start');
const helpCmd    = require('./commands/help');
const statusCmd  = require('./commands/status');
const clearCmd   = require('./commands/clear');
const imagineCmd = require('./commands/imagine');       // 🎨 NEW

/* ── Handlers ────────────────────────────────────────────────────── */
const messageHandler       = require('./handlers/message');
const photoHandler         = require('./handlers/photo');           // 📸 NEW
const callbackQueryHandler = require('./handlers/callbackQuery');
const errorHandler         = require('./handlers/error');

/* ─────────────────────────────────────────────────────────────────── */

const bot = new Telegraf(config.bot.token);

/*
 * MIDDLEWARE STACK — order matters.
 * session → logger → rateLimit → auth → [commands/handlers]
 */
bot.use(session());
bot.use(requestLogger);
bot.use(rateLimit);
bot.use(auth);

/* ── Commands ─────────────────────────────────────────────────────── */
bot.start(startCmd);
bot.command('help',    helpCmd);
bot.command('status',  statusCmd);
bot.command('clear',   clearCmd);
bot.command('imagine', imagineCmd);   // 🎨 /imagine <prompt>

/* ── Event handlers ──────────────────────────────────────────────── */
bot.on('callback_query', callbackQueryHandler);
bot.on('photo',          photoHandler);    // 📸 any photo sent to the bot
bot.on('text',           messageHandler);  // all other text → AI

/* ── Global error boundary ───────────────────────────────────────── */
bot.catch(errorHandler);

module.exports = bot;
