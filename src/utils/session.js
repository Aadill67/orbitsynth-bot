function getSessionKey(ctx) {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!chatId || !userId) return `u:${userId}`;
  return chatId > 0 ? `u:${userId}` : `g:${chatId}:${userId}`;
}

function isGroup(ctx) {
  return ctx.chat?.id < 0;
}

async function shouldRespondInGroup(ctx) {
  if (!isGroup(ctx)) return true;

  const botUsername = ctx.botInfo?.username;
  const text = ctx.message.text || '';
  const entities = ctx.message.entities || [];

  const hasMention = entities.some(e =>
    e.type === 'mention' &&
    text.slice(e.offset, e.offset + e.length).toLowerCase() === `@${botUsername?.toLowerCase()}`
  );

  if (hasMention) {
    ctx.message.text = text.replace(new RegExp(`@${botUsername}\\b`, 'gi'), '').trim();
    return true;
  }

  if (ctx.message.reply_to_message) {
    const replyTo = ctx.message.reply_to_message;
    if (replyTo.from?.id === ctx.botInfo?.id) return true;
  }

  return false;
}

module.exports = { getSessionKey, isGroup, shouldRespondInGroup };
