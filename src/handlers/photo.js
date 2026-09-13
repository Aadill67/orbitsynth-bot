const ai     = require('../services/ai');
const logger = require('../utils/logger');
const { fetchWithTimeout } = require('../services/http');
const { getSessionKey } = require('../utils/session');
const { aiUserMessage } = require('../utils/errors');

// Hard ceiling for the entire photo handler so Render can't kill the process
// mid-flight without the user ever seeing a reply.
const HANDLER_TIMEOUT_MS = 90_000;

/**
 * Handles incoming photos.
 * - With caption    → uses caption as the question about the image
 * - Without caption → auto-describes the image in detail
 */
module.exports = async (ctx) => {
  const sessionKey = getSessionKey(ctx);
  const userId = ctx.from.id;

  let statusMsg = null;

  try {
    await ctx.sendChatAction('typing');

    const photos = ctx.message.photo;
    const photo  = photos[photos.length - 1];

    // Basic size guard (Gemini inline data limit ~4MB)
    if (photo.file_size && photo.file_size > 4 * 1024 * 1024) {
      return ctx.reply('⚠️ Photo is too large. Please send a photo under 4MB.').catch(() => {});
    }

    statusMsg = await ctx.reply('🔍 Analyzing your photo…').catch(() => null);

    const work = (async () => {
      // Get the download URL from Telegram
      const fileLink = await ctx.telegram.getFileLink(photo.file_id);

      // Download the photo WITH a timeout — bare fetch() can hang indefinitely
      // on Render's free tier during cold starts.
      const response = await fetchWithTimeout(fileLink.href, {}, 30_000);
      if (!response.ok) throw new Error(`Telegram download failed: ${response.status}`);

      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');

      const caption = ctx.message.caption || '';

      const isOcr = caption.trim().toLowerCase() === '/ocr';
      const question = isOcr
        ? 'Extract and return ALL visible text from this image exactly as written. Return only the extracted text, no commentary.'
        : caption || 'Describe this image in detail. What do you see? Include objects, colors, mood, and any visible text.';

      const analysis = await ai.analyzeImage(sessionKey, base64, 'image/jpeg', question);

      return { analysis, isOcr };
    })();

    // Hard timeout: if the whole chain hasn't finished in HANDLER_TIMEOUT_MS,
    // bail out with a user-visible error instead of dying silently.
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Photo analysis timed out')), HANDLER_TIMEOUT_MS)
    );

    const { analysis, isOcr } = await Promise.race([work, timeout]);

    // Delete the status message and send the result
    if (statusMsg) await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

    await ctx.reply(isOcr ? `📝 Extracted Text:\n\n${analysis}` : analysis);

    logger.info(isOcr ? 'OCR done' : 'Photo analyzed', {
      userId,
      hasCaption: !!ctx.message.caption,
      fileSize:   photo.file_size,
    });

  } catch (err) {
    logger.error('Photo handler error', { userId, error: err.message, status: err.status });

    // Always delete the status message so the user doesn't see a stale "Analyzing…"
    if (statusMsg) await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

    const msg = err.isAIError
      ? aiUserMessage(err.status, '⚠️ Could not analyze the photo. Please try again.')
      : err.message?.includes('timed out')
        ? '⏳ Photo analysis took too long. Please try again.'
        : '⚠️ Could not analyze the photo. Please try again with a clearer image.';

    await ctx.reply(msg).catch(() => {});
  }
};
