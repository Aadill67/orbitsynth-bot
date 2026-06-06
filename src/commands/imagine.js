const logger = require('../utils/logger');

/**
 * /imagine <prompt>
 * Generates images using Hugging Face FLUX.1-schnell — free, high quality.
 * Requires HF_API_KEY in .env (free at huggingface.co)
 */
module.exports = async (ctx) => {
  const userId = ctx.from.id;
  const prompt = ctx.message.text.replace(/^\/imagine\s*/i, '').trim();

  if (!process.env.HF_API_KEY) {
    return ctx.reply('⚠️ Image generation not configured. Admin needs to add HF_API_KEY to .env');
  }

  if (!prompt) {
    return ctx.replyWithHTML(
      `🎨 <b>Image Generator</b>\n\n` +
      `Add a description:\n` +
      `<code>/imagine Kashmir mountains at golden hour, photorealistic</code>\n` +
      `<code>/imagine a wolf howling at the moon, digital art</code>\n` +
      `<code>/imagine cozy coffee shop rainy day, warm lighting</code>`
    );
  }

  let waitMsg;

  try {
    waitMsg = await ctx.replyWithHTML(
      `🎨 Generating your image...\n` +
      `📝 <i>${prompt}</i>\n\n` +
      `⏳ Please wait ~20 seconds...`
    );

    await ctx.sendChatAction('upload_photo');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    // First attempt
    let response = await fetch(
      'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${process.env.HF_API_KEY}`,
          'Content-Type': 'application/json',
          'x-wait-for-model': 'true',
        },
        body:   JSON.stringify({ inputs: prompt }),
        signal: controller.signal,
      }
    );

    // Model loading — wait and retry once
    if (response.status === 503) {
      logger.info('Model loading, retrying in 10s...', { userId });
      await ctx.telegram.editMessageText(
        ctx.chat.id, waitMsg.message_id, null,
        `🎨 Model warming up...\n📝 <i>${prompt}</i>\n\n⏳ Almost there, ~10 more seconds...`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      await new Promise(r => setTimeout(r, 10_000));
      await ctx.sendChatAction('upload_photo');

      response = await fetch(
        'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
        {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${process.env.HF_API_KEY}`,
            'Content-Type': 'application/json',
            'x-wait-for-model': 'true',
          },
          body:   JSON.stringify({ inputs: prompt }),
          signal: controller.signal,
        }
      );
    }

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HF API ${response.status}: ${errText.slice(0, 150)}`);
    }

    // Response is raw image bytes
    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length < 1000) {
      throw new Error('Received empty or invalid image data');
    }

    await ctx.sendChatAction('upload_photo');

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

    if (waitMsg) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    }

    logger.info('Image generated via HuggingFace', { userId, prompt: prompt.slice(0, 60) });

  } catch (err) {
    if (waitMsg) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    }

    logger.error('Image generation error', { userId, error: err.message });

    const isTimeout = err.name === 'AbortError';
    await ctx.reply(
      isTimeout
        ? '⏱️ Timed out. HuggingFace is under heavy load. Try again in a minute!'
        : `⚠️ Generation failed: ${err.message.slice(0, 100)}\n\nTry again or rephrase your prompt.`
    );
  }
};
