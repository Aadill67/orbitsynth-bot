const ai     = require('../services/ai');
const memory = require('../services/conversation');

module.exports = async (ctx) => {
  const userId = ctx.from.id;
  const count  = memory.length(userId);

  if (count === 0) {
    return ctx.reply('🧹 Your conversation history is already empty.\n\nStart fresh — just send me a message!');
  }

  ai.clearHistory(userId);

  return ctx.reply(
    `✅ Cleared <b>${count} message${count !== 1 ? 's' : ''}</b> from your conversation history.\n\n` +
    `The AI starts fresh on your next message.`,
    { parse_mode: 'HTML' }
  );
};
