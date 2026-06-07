const axios  = require('axios');
const logger = require('../utils/logger');

module.exports = async (ctx) => {
  const userId = ctx.from.id;
  const prompt = ctx.message.text.replace(/^\/imagine\s*/i, '').trim();

  if (!process.env.HF_API_KEY) {
    return ctx.reply('⚠️ HF_API_KEY not set. Add it to Railway Variables tab.');
  }

  if (!prompt) {
    return ctx.replyWithHTML(
      `🎨 <b>Image Generator</b>\n\n` +
      `Usage: <code>/imagine a sunset over mountains</code>\n\n` +
      `<b>Examples:</b>\n` +
      `<code>/imagine Kashmir mountains golden hour, photorealistic</code>\n` +
      `<code>/imagine wolf howling at moon, digital art</code>\n` +
      `<code>/imagine cozy coffee shop rainy day, warm light</code>`
    );
  }

  let waitMsg;

  try {
    waitMsg = await ctx.replyWithHTML(
      `🎨 Generating...\n📝 <i>${prompt}</i>\n\n⏳ About 20 seconds...`
    );
    await ctx.sendChatAction('upload_photo');

    const response = await axios({
      method:       'POST',
      url:          'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
      headers: {
        'Authorization': `Bearer ${process.env.HF_API_KEY}`,
        'Content-Type':  'application/json',
        'x-wait-for-model': 'true',
      },
      data:         { inputs: prompt },
      responseType: 'arraybuffer',   // get raw image bytes
      timeout:      60_000,
    });

    const buffer = Buffer.from(response.data);

    if (buffer.length < 1000) {
      throw new Error('Received empty image — model may be loading, try again');
    }

    if (waitMsg) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    }

    await ctx.replyWithPhoto(
      { source: buffer, filename: 'generated.jpg' },
      {
        parse_mode: 'HTML',
        caption:
          `🎨 <b>Generated Image</b>\n` +
          `📝 <i>${prompt}</i>\n\n` +
          `💡 Run again for a different variation!`,
      }
    );

    logger.info('Image generated', { userId, prompt: prompt.slice(0, 60) });

  } catch (err) {
    if (waitMsg) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    }

    const status  = err.response?.status;
    const detail  = err.response?.data
      ? Buffer.from(err.response.data).toString().slice(0, 150)
      : err.message;

    logger.error('Image generation error', { userId, status, error: detail });

    if (status === 503) {
      await ctx.reply('⏳ Model is loading (cold start). Wait 20 seconds and try again.');
    } else if (status === 401) {
      await ctx.reply('🔑 Invalid HF API key. Check HF_API_KEY in Railway variables.');
    } else if (status === 429) {
      await ctx.reply('⏱️ HuggingFace rate limit hit. Wait a minute and try again.');
    } else {
      await ctx.reply(`⚠️ Failed: ${detail}\n\nTry again in a moment.`);
    }
  }
};
