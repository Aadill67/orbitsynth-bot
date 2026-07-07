const logger = require('../utils/logger');

module.exports = async (ctx) => {
  const text = ctx.message.text.replace(/^\/translate\s*/i, '').trim();

  if (!text) {
    return ctx.replyWithHTML(
      '🌐 <b>Translate</b>\n\n<code>/translate en>fr Hello world</code>\n<code>/translate auto>es Good morning</code>\n<code>/translate en>de How are you?</code>\n\n<b>Language codes:</b> en, es, fr, de, it, pt, ru, ja, ko, zh, ar, hi, nl, pl, tr, vi, th'
    );
  }

  const match = text.match(/^(\w+)>(\w+)\s+(.+)/s);
  if (!match) {
    return ctx.reply('❌ Format: <code>/translate en>es Hello</code>');
  }

  const [_, fromLang, toLang, content] = match;
  const waitMsg = await ctx.reply(`🌐 Translating...`);

  try {
    const res = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(content)}`
    );
    if (!res.ok) throw new Error(`Translation API returned ${res.status}`);
    const data = await res.json();
    const translation = data[0].map(t => t[0]).join('');

    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    await ctx.replyWithHTML(
      `🌐 <b>Translation</b>\n\n` +
      `<b>Original</b> (${fromLang}):\n${content.slice(0, 400)}\n\n` +
      `<b>Translated</b> (${toLang}):\n${translation.slice(0, 400)}`
    );

    logger.info('Translation done', { from: fromLang, to: toLang, len: content.length });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    logger.error('Translate error', { error: err.message });
    await ctx.reply('❌ Translation failed. Try again soon.');
  }
};
