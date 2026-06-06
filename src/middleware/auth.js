const db     = require('../services/database');
const User   = require('../models/User');
const logger = require('../utils/logger');

/**
 * Upserts the Telegram user in MongoDB and attaches `ctx.dbUser`.
 * If MongoDB is unavailable, ctx.dbUser is simply undefined —
 * every downstream handler must treat it as optional.
 *
 * Silently drops (ignores) messages from blocked users.
 */
module.exports = async (ctx, next) => {
  const tg = ctx.from;
  if (!tg) return next(); // system updates have no sender

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
        });
        logger.info('New user registered', { id: tg.id, username: tg.username });
      } else {
        // Returning user — refresh metadata
        user.lastSeenAt = new Date();
        user.username   = tg.username ?? null;
        if (ctx.message) user.messageCount += 1;
        await user.save();
      }

      // Silently ignore blocked users (no reply, no processing)
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
