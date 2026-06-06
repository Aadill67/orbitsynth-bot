const logger = require('../utils/logger');

/**
 * Logs every incoming Telegram update with user info and processing time.
 * Applied globally before all other middleware.
 */
module.exports = async (ctx, next) => {
  const user  = ctx.from;
  const start = Date.now();

  // Build a compact "who" string
  const who = user
    ? `${user.id}${user.username ? `/@${user.username}` : ''}`
    : 'unknown';

  // What they sent (truncated for log hygiene)
  const what =
    ctx.message?.text?.slice(0, 80) ??
    ctx.callbackQuery?.data ??
    ctx.updateType;

  logger.info(`← ${what}`, { user: who });

  await next();

  logger.debug(`→ done`, { user: who, ms: Date.now() - start });
};
