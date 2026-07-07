// Config must be loaded & validated first
const config = require('./config');
config.validate();

const bot    = require('./src/bot');
const db     = require('./src/services/database');
const ai     = require('./src/services/ai');
const logger = require('./src/utils/logger');

/* ── Health check server (start FIRST so Render sees port open) ── */
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
});
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  logger.info(`Health check server listening on port ${PORT}`);
});

(async () => {
  logger.info('Starting OrbitSynth Bot v2...');

  // MongoDB connection is attempted but non-fatal
  await db.connect();

  // Force-kill any stale Telegram session to prevent 409 conflicts on restart
  try {
    await bot.telegram.callApi('deleteWebhook', { drop_pending_updates: true });
    await bot.telegram.callApi('close');
    logger.info('Cleared stale Telegram session');
  } catch (_) {}
  await new Promise(r => setTimeout(r, 2000));

  // Start polling with retry on 409 conflict
  let launched = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await bot.launch();
      launched = true;
      break;
    } catch (err) {
      if (err.message?.includes('409') && attempt < 5) {
        logger.warn(`409 conflict on attempt ${attempt}, retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
      } else {
        throw err;
      }
    }
  }
  if (!launched) throw new Error('Failed to launch bot after 5 attempts');

  logger.info('OrbitSynth Bot is online!', {
    botUsername: bot.botInfo?.username ?? '(fetching...)',
    aiEnabled:   ai.isEnabled,
    dbConnected: db.isConnected(),
  });

  if (!ai.isEnabled) {
    logger.warn(
      'AI is disabled. Set GEMINI_API_KEY in your .env to enable AI responses.'
    );
  }
})();

/* ── Graceful shutdown ───────────────────────────────────────────── */
const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully...`);
  bot.stop(signal);
  await db.disconnect();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
};

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
