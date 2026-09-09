const config = require('./config');
config.validate();

const bot    = require('./src/bot');
const db     = require('./src/services/database');
const ai     = require('./src/services/ai');
const logger = require('./src/utils/logger');
const http   = require('http');

const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const PREFERRED_PORT = config.server.port;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ── Global crash guards: never let the process die silently ─────────── */
process.on('uncaughtException', (err) => {
  logger.error('🔥 Uncaught exception (process kept alive)', { error: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.error('🔥 Unhandled rejection (process kept alive)', {
    error: reason?.message || String(reason),
    stack: reason?.stack,
  });
});

/* ── HTTP server (webhook / health) with port fallback ───────────────── */
let server = null;
let httpPort = null;

const createServer = () => http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const update = JSON.parse(body);
        bot.handleUpdate(update).catch((err) => {
          logger.error('Webhook update handler failed', { error: err.message });
        });
        // Always acknowledge immediately: Telegram treats 2xx as success and
        // only retries on non-2xx, which would re-deliver (and double-send)
        // for fire-and-forget AI work. Errors are surfaced via logger/bot.catch.
        res.writeHead(200);
        res.end('ok');
      } catch (err) {
        // Malformed JSON — reject so Telegram doesn't keep re-delivering a
        // payload we can never parse.
        logger.error('Webhook malformed body', { error: err.message });
        res.writeHead(400);
        res.end('bad request');
      }
    });
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status:  'ok',
      uptime:  process.uptime(),
      bot:     bot.botInfo?.username ?? 'unknown',
      ai:      ai.isEnabled ? 'enabled' : 'disabled',
      db:      db.isConnected() ? 'connected' : 'memory-only',
      port:    httpPort,
    }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
});

const listenOnPort = (port) => new Promise((resolve, reject) => {
  const srv = createServer();
  srv.once('error', reject);
  srv.listen(port, () => resolve(srv));
});

async function startHttpServer() {
  // Walk up to 20 ports — if 8080 is taken by another instance, we still run.
  for (let p = PREFERRED_PORT; p < PREFERRED_PORT + 20; p++) {
    try {
      server = await listenOnPort(p);
      httpPort = p;
      logger.info(`HTTP server listening on port ${p}`);
      server.on('error', (err) => logger.error('HTTP server error', { error: err.message }));
      return;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      logger.warn(`Port ${p} already in use, trying ${p + 1}...`);
    }
  }
  throw new Error('No free HTTP port found in range');
}

/* ── Polling with automatic re-launch ─────────────────────────────────── */
let pollRunning = false;
let consecutiveWatchdogFails = 0;

async function launchPolling() {
  for (let attempt = 1; ; attempt++) {
    try {
      await bot.telegram.callApi('deleteWebhook', { drop_pending_updates: true }).catch(() => {});
      await bot.launch({ dropPendingUpdates: true });
      pollRunning = true;
      consecutiveWatchdogFails = 0;
      logger.info('Polling launched');
      return;
    } catch (err) {
      const delay = Math.min(30_000, 3000 * attempt);
      logger.error(`Bot launch failed (attempt ${attempt}), retrying in ${delay / 1000}s`, {
        error: err.message,
      });
      await sleep(delay);
    }
  }
}

async function restartPolling() {
  try { bot.stop('watchdog'); } catch (_) {}
  await sleep(2000);
  await launchPolling();
}

// Watchdog: if Telegram becomes unreachable for a while, restart polling.
setInterval(async () => {
  if (WEBHOOK_URL || !pollRunning) return;
  try {
    await bot.telegram.getMe();
    consecutiveWatchdogFails = 0;
  } catch {
    consecutiveWatchdogFails++;
    if (consecutiveWatchdogFails >= 3) {
      logger.warn('Watchdog: bot unreachable, restarting polling...');
      restartPolling().catch(err =>
        logger.error('Watchdog restart failed', { error: err.message }));
    }
  }
}, 60_000).unref();

/* ── Startup (retried forever on failure) ─────────────────────────────── */
async function boot() {
  let attempt = 0;
  for (;;) {
    try {
      await db.connect();
      await startHttpServer();

      if (WEBHOOK_URL) {
        const fullUrl = `${WEBHOOK_URL.replace(/\/+$/, '')}/webhook`;
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        await bot.telegram.setWebhook(fullUrl);
        logger.info(`Webhook set to ${fullUrl}`);
      } else {
        await launchPolling();
      }

      logger.info('🚀 OrbitSynth Bot is online!', {
        mode:        WEBHOOK_URL ? 'webhook' : 'polling',
        aiEnabled:   ai.isEnabled,
        aiModel:     config.ai.model,
        dbConnected: db.isConnected(),
      });

      if (!ai.isEnabled) {
        logger.warn('AI is disabled. Set GEMINI_API_KEY in your .env to enable AI responses.');
      }
      return;
    } catch (err) {
      attempt++;
      const delay = Math.min(30_000, 5000 * attempt);
      logger.error(`Startup failed (attempt ${attempt}), restarting in ${delay / 1000}s`, {
        error: err.message,
      });
      await sleep(delay);
    }
  }
}

boot();

/* ── Graceful shutdown ────────────────────────────────────────────────── */
const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully...`);
  try { bot.stop(signal); } catch (_) {}
  await db.disconnect();
  if (server) server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
};

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
