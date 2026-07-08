const { Telegraf, session } = require('telegraf');
const config = require('../config');

/* ── Middleware ───────────────────────────────────────────────────── */
const requestLogger = require('./middleware/requestLogger');
const rateLimit     = require('./middleware/rateLimit');
const auth          = require('./middleware/auth');

/* ── Commands ────────────────────────────────────────────────────── */
const startCmd     = require('./commands/start');
const helpCmd      = require('./commands/help');
const statusCmd    = require('./commands/status');
const clearCmd     = require('./commands/clear');
const imagineCmd   = require('./commands/imagine');
const weatherCmd   = require('./commands/weather');
const cryptoCmd    = require('./commands/crypto');
const translateCmd = require('./commands/translate');
const searchCmd    = require('./commands/websearch');
const remindCmd    = require('./commands/remind');
const ytCmd        = require('./commands/yt');
const fetchCmd     = require('./commands/fetchpage');
const codeCmd      = require('./commands/code');

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
bot.command('help',     helpCmd);
bot.command('status',   statusCmd);
bot.command('clear',    clearCmd);
bot.command('imagine',  imagineCmd);
bot.command('weather',  weatherCmd);
bot.command('crypto',   cryptoCmd);
bot.command('btc',      cryptoCmd);
bot.command('eth',      cryptoCmd);
bot.command('sol',      cryptoCmd);
bot.command('xrp',      cryptoCmd);
bot.command('ada',      cryptoCmd);
bot.command('doge',     cryptoCmd);
bot.command('translate', translateCmd);
bot.command('search',   searchCmd);
bot.command('remind',   remindCmd);
bot.command('yt',       ytCmd);
bot.command('fetch',    fetchCmd);
bot.command('code',     codeCmd);

/* ── Event handlers ──────────────────────────────────────────────── */
bot.on('callback_query', callbackQueryHandler);
bot.on('photo',          photoHandler);    // 📸 any photo sent to the bot
bot.on('text',           messageHandler);  // all other text → AI

/* ── Global error boundary ───────────────────────────────────────── */
bot.catch(errorHandler);

module.exports = bot;
