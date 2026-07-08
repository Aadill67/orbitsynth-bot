const config = require('./config');
config.validate();

const bot    = require('./src/bot');
const db     = require('./src/services/database');
const ai     = require('./src/services/ai');
const logger = require('./src/utils/logger');
const http   = require('http');

const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        bot.handleUpdate(JSON.parse(body));
      } catch (_) {}
      res.writeHead(200);
      res.end('ok');
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  }
});

server.listen(PORT, () => {
  logger.info(`HTTP server listening on port ${PORT}`);
});

(async () => {
  logger.info('Starting OrbitSynth Bot v2...');

  await db.connect();

  if (WEBHOOK_URL) {
    const fullUrl = `${WEBHOOK_URL.replace(/\/+$/, '')}/webhook`;
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      await bot.telegram.setWebhook(fullUrl);
      logger.info(`Webhook set to ${fullUrl}`);
    } catch (err) {
      logger.error('Webhook setup failed, falling back to polling', { error: err.message });
      await bot.launch();
    }
  } else {
    try {
      await bot.telegram.callApi('deleteWebhook', { drop_pending_updates: true });
      logger.info('Cleared webhook');
    } catch (_) {}
    await new Promise(r => setTimeout(r, 2000));

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
  }

  logger.info('OrbitSynth Bot is online!', {
    mode:        WEBHOOK_URL ? 'webhook' : 'polling',
    aiEnabled:   ai.isEnabled,
    dbConnected: db.isConnected(),
  });

  if (!ai.isEnabled) {
    logger.warn('AI is disabled. Set GEMINI_API_KEY in your .env to enable AI responses.');
  }
})();

const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully...`);
  bot.stop(signal);
  await db.disconnect();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
};

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
