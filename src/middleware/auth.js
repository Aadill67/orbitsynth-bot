const db     = require('../services/database');
const User   = require('../models/User');
const logger = require('../utils/logger');

/**
 * In-memory cache of blocked user IDs so the block stays enforced even when
 * MongoDB is temporarily unavailable (the design tolerates DB downtime).
 */
const blockedCache = new Set();

module.exports = async (ctx, next) => {
  const tg = ctx.from;
  if (!tg) return next(); // system updates have no sender

  // Enforce the in-memory blocklist regardless of DB state.
  if (blockedCache.has(tg.id)) {
    logger.warn('Blocked user intercepted (cache)', { id: tg.id });
    return;
  }

  if (db.isConnected()) {
    try {
      let user = await User.findOne({ telegramId: tg.id });

      if (!user) {
        // First interaction — register the user
        user = await User.create({
          telegramId:   tg.id,
          username:     tg.username     ?? null,
          firstName:    tg.first_name   ?? null,
          lastName:     tg.last_name    ?? null,
          languageCode: tg.language_code ?? 'en',
          messageCount: 1,
        });
        logger.info('New user registered', { id: tg.id, username: tg.username });
      } else {
        // Returning user — refresh metadata
        user.lastSeenAt = new Date();
        user.username   = tg.username ?? null;
        if (ctx.message) user.messageCount += 1;
        await user.save();
      }

      // Sync the block flag into the in-memory cache.
      if (user.isBlocked) blockedCache.add(tg.id);
      else blockedCache.delete(tg.id);

      // Silently ignore blocked users (no reply, no processing).
      if (user.isBlocked) {
        logger.warn('Blocked user intercepted', { id: tg.id });
        return;
      }

      ctx.dbUser = user; // available to all subsequent handlers
    } catch (err) {
      // DB error is non-fatal — log and continue without ctx.dbUser
      logger.error('Auth middleware DB error', { error: err.message });
    }
  }

  return next();
};

// Keep the cache bounded to the caller's needs; blocks are re-synced on every
// message where the DB is up.
module.exports._blockedCache = blockedCache;
