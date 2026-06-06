const ai     = require('../services/ai');
const logger = require('../utils/logger');

/**
 * Handles incoming photos.
 * - With caption    → uses caption as the question about the image
 * - Without caption → auto-describes the image in detail
 */
module.exports = async (ctx) => {
  const userId = ctx.from.id;

  try {
    await ctx.sendChatAction('typing');

    // Telegram gives multiple sizes — always use the largest
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

    // If user added a caption, treat it as the question about the image
    const question = ctx.message.caption
      || 'Describe this image in detail. What do you see? Include objects, colors, mood, and any visible text.';

    const analysis = await ai.analyzeImage(userId, base64, 'image/jpeg', question);

    await ctx.reply(analysis);

    logger.info('Photo analyzed', {
      userId,
      hasCaption: !!ctx.message.caption,
      fileSize:   photo.file_size,
    });

  } catch (err) {
    logger.error('Photo handler error', { userId, error: err.message });
    await ctx.reply('⚠️ Could not analyze the photo. Please try again with a clearer image.');
  }
};
