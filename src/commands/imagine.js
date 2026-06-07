const axios  = require('axios');
const logger = require('../utils/logger');

module.exports = async (ctx) => {
  const userId = ctx.from.id;
  const prompt = ctx.message.text.replace(/^\/imagine\s*/i, '').trim();

  if (!process.env.GEMINI_API_KEY) {
    return ctx.reply('⚠️ GEMINI_API_KEY not set in Railway Variables.');
  }

  if (!prompt) {
    return ctx.replyWithHTML(
      `🎨 <b>Image Generator</b>\n\n` +
      `<code>/imagine Kashmir mountains at golden hour</code>\n` +
      `<code>/imagine wolf howling at moon, digital art</code>\n` +
      `<code>/imagine cozy coffee shop rainy day</code>`
    );
  }

  let waitMsg;

  try {
    waitMsg = await ctx.replyWithHTML(
      `🎨 Generating...\n📝 <i>${prompt}</i>\n\n⏳ About 15 seconds...`
    );
    await ctx.sendChatAction('upload_photo');

    // Use Gemini's Imagen via REST — same API key you already have
    const response = await axios({
      method: 'POST',
      url: `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${process.env.GEMINI_API_KEY}`,
      headers: { 'Content-Type': 'application/json' },
      data: {
        instances: [{ prompt: prompt }],
        parameters: { sampleCount: 1 },
      },
      timeout: 60_000,
    });

    const base64Image = response.data.predictions[0].bytesBase64Encoded;
    const buffer = Buffer.from(base64Image, 'base64');

    if (waitMsg) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    }

    await ctx.replyWithPhoto(
      { source: buffer, filename: 'generated.jpg' },
      {
        parse_mode: 'HTML',
        caption: `🎨 <b>Generated</b>\n📝 <i>${prompt}</i>`,
      }
    );

    logger.info('Image generated via Imagen', { userId, prompt: prompt.slice(0, 60) });

  } catch (err) {
    if (waitMsg) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    }

    const status = err.response?.status;
    const detail = err.response?.data?.error?.message || err.message;

    logger.error('Image generation error', { userId, status, error: detail });

    // Clear error messages so you know exactly what's wrong
    if (status === 403 || status === 400) {
      await ctx.reply(
        `❌ Imagen not enabled on your API key.\n\n` +
        `Fix: Go to aistudio.google.com → your project → enable Imagen API.\n` +
        `Or reply with the exact error and I'll find another way.`
      );
    } else if (status === 429) {
      await ctx.reply('⏱️ Rate limited. Wait a minute and try again.');
    } else {
      await ctx.reply(`⚠️ Error ${status}: ${String(detail).slice(0, 150)}`);
    }
  }
};
