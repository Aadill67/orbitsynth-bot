const logger = require('../utils/logger');

const reminders = new Map();
let counter = 0;

setInterval(() => {
  const now = Date.now();
  for (const [id, r] of reminders) {
    if (r.time <= now) {
      reminders.delete(id);
      r.ctx.telegram.sendMessage(r.chatId, `⏰ <b>Reminder!</b>\n\n${r.message}`, { parse_mode: 'HTML' }).catch(() => {});
      logger.debug('Reminder fired', { userId: r.userId, message: r.message.slice(0, 50) });
    }
  }
}, 5000).unref();

module.exports = async (ctx) => {
  const text = ctx.message.text.replace(/^\/remind\s*/i, '').trim();

  if (!text) {
    return ctx.replyWithHTML(
      '⏰ <b>Reminders</b>\n\n<code>/remind 10m Deploy the bot</code>\n<code>/remind 1h Take a break</code>\n<code>/remind 30s Test reminder</code>\n\n<b>Units:</b> s (seconds), m (minutes), h (hours)'
    );
  }

  const match = text.match(/^(\d+)([smh])\s+(.+)/s);
  if (!match) {
    return ctx.reply('❌ Format: <code>/remind 10m Your message</code>');
  }

  const [_, amount, unit, message] = match;
  const multipliers = { s: 1000, m: 60000, h: 3600000 };
  const ms = parseInt(amount) * (multipliers[unit] || 60000);
  const time = Date.now() + ms;

  const id = ++counter;
  reminders.set(id, { time, chatId: ctx.chat.id, userId: ctx.from.id, message, ctx });

  const unitLabels = { s: 'seconds', m: 'minutes', h: 'hours' };
  const reply = await ctx.reply(`⏰ Reminder set for <b>${amount} ${unitLabels[unit]}</b> from now.\n\n📝 "${message}"\n\nID: #${id}`);

  logger.info('Reminder set', { userId: ctx.from.id, amount, unit, message: message.slice(0, 50) });
};
