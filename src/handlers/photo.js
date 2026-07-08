const ai     = require('../services/ai');
const logger = require('../utils/logger');
const { getSessionKey } = require('../utils/session');

/**
 * Handles incoming photos.
 * - With caption    → uses caption as the question about the image
 * - Without caption → auto-describes the image in detail
 */
module.exports = async (ctx) => {
  const sessionKey = getSessionKey(ctx);
  const userId = ctx.from.id;

  try {
    await ctx.sendChatAction('typing');

    const photos = ctx.message.photo;
    const photo  = photos[photos.length - 1];

    // Basic size guard (Gemini inline data limit ~4MB)
    if (photo.file_size && photo.file_size > 4 * 1024 * 1024) {
      return ctx.reply('⚠️ Photo is too large. Please send a photo under 4MB.');
    }

    // Get the download URL from Telegram
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);

    // Download the photo using Node 18+ built-in fetch
    const response = await fetch(fileLink.href);
    if (!response.ok) throw new Error(`Telegram download failed: ${response.status}`);

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    const caption = ctx.message.caption || '';

    const isOcr = caption.trim().toLowerCase() === '/ocr';
    const question = isOcr
      ? 'Extract and return ALL visible text from this image exactly as written. Return only the extracted text, no commentary.'
      : caption || 'Describe this image in detail. What do you see? Include objects, colors, mood, and any visible text.';

    const analysis = await ai.analyzeImage(sessionKey, base64, 'image/jpeg', question);

    await ctx.reply(isOcr ? `📝 Extracted Text:\n\n${analysis}` : analysis);

    logger.info(isOcr ? 'OCR done' : 'Photo analyzed', {
      userId,
      hasCaption: !!caption,
      fileSize:   photo.file_size,
    });

  } catch (err) {
    logger.error('Photo handler error', { userId, error: err.message });
    await ctx.reply('⚠️ Could not analyze the photo. Please try again with a clearer image.');
  }
};
