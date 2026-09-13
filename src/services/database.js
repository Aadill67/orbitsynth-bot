const mongoose = require('mongoose');
const config   = require('../../config');
const logger   = require('../utils/logger');

let _connected  = false;
let _retryTimer = null;
let _connecting = false;

/**
 * Attempt MongoDB connection. Non-fatal — bot runs in memory-only mode
 * if MongoDB is unavailable, and a background loop keeps retrying so the
 * bot self-heals the moment the database comes back (no restart needed).
 */
const connect = async () => {
  if (_connecting) return;
  _connecting = true;
  try {
    await mongoose.connect(config.mongodb.uri, {
      serverSelectionTimeoutMS: 4_000, // fail fast on local dev
    });
    _connected = true;
    logger.info('✅ MongoDB connected', { uri: config.mongodb.uri });
  } catch (err) {
    logger.warn('⚠️  MongoDB unavailable — running without persistence', {
      reason: err.message,
    });
    scheduleReconnect();
  } finally {
    _connecting = false;
  }
};

/** Retry in the background so the bot never blocks on a DB that is down. */
function scheduleReconnect() {
  if (_retryTimer) return;
  _retryTimer = setInterval(async () => {
    if (_connected || _connecting) {
      if (_retryTimer) { clearInterval(_retryTimer); _retryTimer = null; }
      return;
    }
    await connect().catch(() => {});
  }, 30_000);
  _retryTimer.unref?.();
}

// If the connection drops after a successful connect, mark it and retry.
mongoose.connection.on('disconnected', () => {
  if (_connected) {
    logger.warn('⚠️  MongoDB connection lost — retrying in background');
  }
  _connected = false;
  scheduleReconnect();
});

mongoose.connection.on('reconnected', () => {
  logger.info('✅ MongoDB reconnected');
  _connected = true;
  if (_retryTimer) { clearInterval(_retryTimer); _retryTimer = null; }
});

const disconnect = async () => {
  if (_retryTimer) { clearInterval(_retryTimer); _retryTimer = null; }
  if (_connected) {
    await mongoose.disconnect();
    _connected = false;
    logger.info('MongoDB disconnected');
  }
};

/** Returns true only after a successful connect() call. */
const isConnected = () => _connected;

module.exports = { connect, disconnect, isConnected };