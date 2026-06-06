const config = require('../../config');
const logger  = require('../utils/logger');

/**
 * Sliding-window rate limiter stored in memory.
 * Admins (listed in ADMIN_IDS) are exempt.
 *
 * Upgrade path → swap the Map for a Redis ZSET to share limits
 * across multiple bot processes/instances.
 *
 * @type {Map<number, number[]>}  userId → array of Unix-ms timestamps
 */
const buckets = new Map();

// Purge stale buckets every 5 minutes to keep memory clean
setInterval(() => {
  const cutoff = Date.now() - config.rateLimit.windowMs;
  for (const [id, stamps] of buckets) {
    const fresh = stamps.filter(t => t > cutoff);
    if (fresh.length === 0) buckets.delete(id);
    else                    buckets.set(id, fresh);
  }
}, 5 * 60 * 1000).unref();

module.exports = async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return next(); // anonymous update — pass through

  // Admins bypass rate limiting entirely
  if (config.bot.adminIds.includes(userId)) return next();

  const now    = Date.now();
  const cutoff = now - config.rateLimit.windowMs;
  const stamps = (buckets.get(userId) ?? []).filter(t => t > cutoff);

  if (stamps.length >= config.rateLimit.maxMessages) {
    const waitSec = Math.ceil((stamps[0] + config.rateLimit.windowMs - now) / 1000);
    logger.warn('Rate limit hit', { userId, count: stamps.length });
    return ctx.reply(
      `⏳ Slow down a little! You're sending too many messages.\n` +
      `Please wait <b>${waitSec}s</b> before trying again.`,
      { parse_mode: 'HTML' }
    );
  }

  stamps.push(now);
  buckets.set(userId, stamps);
  return next();
};
