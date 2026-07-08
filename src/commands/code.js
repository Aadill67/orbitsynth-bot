const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../../config');
const logger = require('../utils/logger');

module.exports = async (ctx) => {
  const prompt = ctx.message.text.replace(/^\/code\s*/i, '').trim();

  if (!prompt) {
    return ctx.replyWithHTML(
      '💻 <b>Code Generator</b>\n\n<code>/code python fibonacci sequence</code>\n<code>/code javascript sort array of objects</code>'
    );
  }

  const waitMsg = await ctx.reply(`💻 Generating code for "${prompt}"...`);

  try {
    if (!config.ai.apiKey) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      return ctx.reply('❌ AI not configured. Set GEMINI_API_KEY in .env');
    }

    const ai = new GoogleGenerativeAI(config.ai.apiKey);
    const model = ai.getGenerativeModel({
      model: config.ai.model,
      systemInstruction: `You are a code generation assistant. For every request:
1. Output ONLY a code block with the solution
2. Follow it with a brief explanation in plain text
3. Use proper syntax highlighting markers
4. Keep explanations concise and focused on how the code works`,
    });

    const result = await model.generateContent(
      `Write code for: ${prompt}\n\nReturn a code block with syntax highlighting, then a short explanation.`
    );
    const reply = result.response.text();

    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

    if (reply.length > 4000) {
      const truncated = reply.slice(0, 4000) + '\n\n... (truncated)';
      await ctx.replyWithMarkdown(truncated);
    } else {
      await ctx.replyWithMarkdown(reply);
    }

    logger.info('Code generated', { prompt: prompt.slice(0, 60) });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    logger.error('Code generation error', { error: err.message });
    await ctx.reply('❌ Code generation failed. Try again.');
  }
};
