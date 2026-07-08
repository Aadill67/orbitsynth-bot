const ai     = require('../services/ai');
const memory = require('../services/conversation');
const { getSessionKey } = require('../utils/session');

module.exports = async (ctx) => {
  const sessionKey = getSessionKey(ctx);
  const count  = memory.length(sessionKey);

  if (count === 0) {
    return ctx.reply('🧹 Your conversation history is already empty.\n\nStart fresh — just send me a message!');
  }

  ai.clearHistory(sessionKey);

  return ctx.reply(
    `✅ Cleared <b>${count} message${count !== 1 ? 's' : ''}</b> from your conversation history.\n\n` +
    `The AI starts fresh on your next message.`,
    { parse_mode: 'HTML' }
  );
};
