const logger = require('../utils/logger');
const { fetchWithTimeout } = require('../services/http');

async function googleTranslate(fromLang, toLang, content) {
  const res = await fetchWithTimeout(
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(content)}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } }, 12000
  );
  if (!res.ok) throw new Error(`Google Translate returned ${res.status}`);
  const data = await res.json();
  const text = data[0].map(t => t[0]).join('');
  if (!text) throw new Error('Empty translation');
  return text;
}

/** Free keyless fallback (supports no `auto` — defaults to English). */
async function myMemoryTranslate(fromLang, toLang, content) {
  const from = fromLang === 'auto' ? 'en' : fromLang;
  const res = await fetchWithTimeout(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(content.slice(0, 450))}&langpair=${from}|${toLang}`,
    {}, 12000
  );
  if (!res.ok) throw new Error(`MyMemory returned ${res.status}`);
  const data = await res.json();
  if (data?.responseStatus !== 200) throw new Error(`MyMemory: ${data?.responseDetails || 'error'}`);
  const text = data.responseData?.translatedText;
  if (!text) throw new Error('Empty translation');
  return text;
}

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
    let translation;
    try {
      translation = await googleTranslate(fromLang, toLang, content);
    } catch (err) {
      logger.warn('Google Translate failed, falling back to MyMemory', { error: err.message });
      translation = await myMemoryTranslate(fromLang, toLang, content);
    }

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
