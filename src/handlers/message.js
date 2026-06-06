const ai     = require('../services/ai');
const logger = require('../utils/logger');

/**
 * Handles all plain-text messages that aren't handled by a /command.
 * Sends the message to the AI service and replies with the response.
 */
module.exports = async (ctx) => {
  const userId = ctx.from.id;
  const text   = ctx.message.text;

  // Commands not matched by bot.command() fall through to here — skip them
  if (text.startsWith('/')) {
    return ctx.reply(
      `❓ Unknown command. Use /help to see available commands.`
    );
  }

  // Read personality from session → DB preference → fallback to default
  const personality = ctx.session?.personality
    ?? ctx.dbUser?.preferences?.aiPersonality
    ?? 'default';

  // Show "typing…" while the AI processes the request
  await ctx.sendChatAction('typing');

  try {
    const reply = await ai.chat(userId, text, personality);
    await ctx.reply(reply);

  } catch (err) {
    logger.error('Message handler: AI error', { userId, error: err.message, status: err.status });

    // Provide user-facing error messages that are actually helpful
    let userMsg;
    if (err.status === 429) {
      userMsg = '⏳ The AI is temporarily overloaded. Please try again in a moment.';
    } else if (err.status === 401) {
      userMsg = '🔑 AI authentication failed. Please contact the bot admin.';
    } else if (err.status === 529) {
      userMsg = '🔧 The AI service is currently overloaded. Please wait a few seconds and try again.';
    } else {
      userMsg = '⚠️ Something went wrong while generating a response. Please try again.';
    }

    await ctx.reply(userMsg);
  }
};
