const logger = require('../utils/logger');

/**
 * Telegraf's global error boundary — passed to bot.catch().
 * Logs the full error and attempts to send a friendly reply to the user.
 *
 * @param {Error}  err Thrown error
 * @param {object} ctx Telegraf context (may be partially constructed)
 */
module.exports = (err, ctx) => {
  logger.error('Unhandled bot error', {
    message:    err.message,
    stack:      err.stack,
    userId:     ctx?.from?.id,
    updateType: ctx?.updateType,
    update:     JSON.stringify(ctx?.update)?.slice(0, 200),
  });

  // Best-effort user notification
  try {
    ctx?.reply?.(
      '⚠️ Something unexpected went wrong on my end.\n' +
      'Please try again, or use /start to reset the bot.'
    );
  } catch (_) {
    // If even this reply fails, there's nothing more we can do
  }
};
