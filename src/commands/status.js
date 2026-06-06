const ai     = require('../services/ai');
const db     = require('../services/database');
const memory = require('../services/conversation');
const { mainMenuKeyboard } = require('../utils/keyboards');

module.exports = async (ctx) => {
  const userId = ctx.from.id;

  const histLen     = memory.length(userId);
  const personality = ctx.session?.personality
    ?? ctx.dbUser?.preferences?.aiPersonality
    ?? 'default';

  const msgCount = ctx.dbUser?.messageCount ?? 'N/A';

  const joinedDate = ctx.dbUser?.createdAt
    ? new Date(ctx.dbUser.createdAt).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
    : 'N/A';

  const text =
    `<b>📊 Your Stats</b>\n\n` +

    `<b>Account</b>\n` +
    `Name:          ${ctx.from.first_name ?? '—'}\n` +
    `Username:      ${ctx.from.username ? '@' + ctx.from.username : '—'}\n` +
    `Telegram ID:   <code>${userId}</code>\n` +
    `Member since:  ${joinedDate}\n` +
    `Total messages: ${msgCount}\n\n` +

    `<b>Current Session</b>\n` +
    `AI personality:     ${personality}\n` +
    `Conversation depth: ${histLen} message${histLen !== 1 ? 's' : ''}\n\n` +

    `<b>System</b>\n` +
    `AI service:      ${ai.isEnabled     ? '✅ Online'    : '❌ Offline'}\n` +
    `Database:        ${db.isConnected() ? '✅ Connected' : '⚠️ Memory-only'}\n` +
    `Active sessions: ${memory.activeSessions}`;

  await ctx.replyWithHTML(text, mainMenuKeyboard());
};
