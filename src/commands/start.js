const { mainMenuKeyboard } = require('../utils/keyboards');

module.exports = async (ctx) => {
  const name      = ctx.from?.first_name ?? 'there';
  const isNewUser = !ctx.dbUser || ctx.dbUser.messageCount <= 1;

  const text = isNewUser
    ? `🚀 <b>Welcome to OrbitSynth Bot, ${name}!</b>\n\n` +
      `I'm your AI-powered assistant, built on Claude.\n\n` +
      `<b>What I can do:</b>\n` +
      `• 🤖 Hold intelligent conversations with full memory\n` +
      `• ⚙️ Adapt my personality to your preference\n` +
      `• 📊 Show your usage stats\n` +
      `• 🗑️ Reset chat history on demand\n\n` +
      `<b>Just type anything</b> to chat with AI — or tap a button below.`
    : `👋 <b>Welcome back, ${name}!</b>\n\nWhat can I help you with today?`;

  await ctx.replyWithHTML(text, mainMenuKeyboard());
};
