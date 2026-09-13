const logger = require('../utils/logger');

/**
 * Telegraf's global error boundary — passed to bot.catch().
 * Logs the full error and attempts to send a friendly reply to the user.
 * Only fires when an error escapes a handler (handlers should catch their own).
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

  // Best-effort user notification — never tell the user to "reset the bot",
  // that is admin jargon and scares people.
  try {
    ctx?.reply?.(
      '⚠️ Something went wrong on my end.\n' +
      'Please try again in a moment. If it keeps happening, use /ping.'
    );
  } catch (_) {
    // If even this reply fails, there's nothing more we can do
  }
};