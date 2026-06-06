// Config must be loaded & validated first
const config = require('./config');
config.validate();

const bot    = require('./src/bot');
const db     = require('./src/services/database');
const ai     = require('./src/services/ai');
const logger = require('./src/utils/logger');

(async () => {
  logger.info('Starting OrbitSynth Bot v2...');

  // MongoDB connection is attempted but non-fatal
  await db.connect();

  // Start polling for Telegram updates
  await bot.launch();

  logger.info('🚀 OrbitSynth Bot is online!', {
    botUsername: bot.botInfo?.username ?? '(fetching...)',
    aiEnabled:   ai.isEnabled,
    dbConnected: db.isConnected(),
  });

  if (!ai.isEnabled) {
    logger.warn(
      'AI is disabled. Set ANTHROPIC_API_KEY in your .env to enable Claude responses.'
    );
  }
})();

/* ── Graceful shutdown ───────────────────────────────────────────── */
const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully...`);
  bot.stop(signal);
  await db.disconnect();
  process.exit(0);
};

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
