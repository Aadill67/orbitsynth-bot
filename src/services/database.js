const mongoose = require('mongoose');
const config   = require('../../config');
const logger   = require('../utils/logger');

let _connected = false;

/**
 * Attempt MongoDB connection. Non-fatal — bot runs in memory-only mode
 * if MongoDB is unavailable.
 */
const connect = async () => {
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
    // Intentionally non-fatal so the bot still starts
  }
};

const disconnect = async () => {
  if (_connected) {
    await mongoose.disconnect();
    _connected = false;
    logger.info('MongoDB disconnected');
  }
};

/** Returns true only after a successful connect() call. */
const isConnected = () => _connected;

module.exports = { connect, disconnect, isConnected };
