const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');

module.exports = async (ctx) => {
  const userId = ctx.from.id;
  const prompt = ctx.message.text.replace(/^\/imagine\s*/i, '').trim();

  if (!prompt) {
    return ctx.replyWithHTML(
      `🎨 <b>Image Generator</b>\n\n` +
      `<code>/imagine Kashmir mountains at golden hour</code>\n` +
      `<code>/imagine wolf howling at moon, digital art</code>`
    );
  }

  let waitMsg;

  try {
    waitMsg = await ctx.replyWithHTML(`🎨 Generating...\n📝 <i>${prompt}</i>\n\n⏳ ~15 seconds...`);
    await ctx.sendChatAction('upload_photo');

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Use the same model already working for chat
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `Generate an image of: ${prompt}` }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    });

    const parts    = result.response.candidates[0].content.parts;
    const imgPart  = parts.find(p => p.inlineData);

    if (!imgPart) throw new Error('No image returned — model may not support image output');

    const buffer = Buffer.from(imgPart.inlineData.data, 'base64');

    if (waitMsg) await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

    await ctx.replyWithPhoto(
      { source: buffer, filename: 'generated.jpg' },
      { parse_mode: 'HTML', caption: `🎨 <b>Generated</b>\n📝 <i>${prompt}</i>` }
    );

    logger.info('Image generated', { userId, prompt: prompt.slice(0, 60) });

  } catch (err) {
    if (waitMsg) await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

    logger.error('Image generation error', { userId, error: err.message });

    await ctx.reply(`❌ ${err.message.slice(0, 200)}`);
  }
};
