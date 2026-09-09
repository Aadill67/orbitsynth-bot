const ai = require('../services/ai');
const logger = require('../utils/logger');
const { escapeHtml } = require('../utils/format');

module.exports = async (ctx) => {
  const prompt = ctx.message.text.replace(/^\/code\s*/i, '').trim();

  if (!prompt) {
    return ctx.replyWithHTML(
      '💻 <b>Code Generator</b>\n\n<code>/code python fibonacci sequence</code>\n<code>/code javascript sort array of objects</code>'
    );
  }

  const waitMsg = await ctx.reply(`💻 Generating code for "${prompt}"...`);

  try {
    if (!ai.isEnabled) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      return ctx.reply('❌ AI not configured. Set GEMINI_API_KEY in .env');
    }

    const reply = await ai.synthesize(
      `Write code for: ${prompt}\n\nReturn a code block with syntax highlighting, then a short explanation.`,
      {
        system: `You are a code generation assistant. For every request:
1. Output ONLY a code block with the solution
2. Follow it with a brief explanation in plain text
3. Use proper syntax highlighting markers
4. Keep explanations concise and focused on how the code works`,
      }
    );

    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

    // Telegram HTML has no Markdown code fences — render with a pre/code block,
    // escaping so the parser never throws on special characters.
    const rendered = `<pre><code>${escapeHtml(reply)}</code></pre>`;
    if (reply.length > 4000) {
      const truncated = escapeHtml(reply.slice(0, 4000)) + '\n\n... (truncated)';
      await ctx.replyWithHTML(`<pre><code>${truncated}</code></pre>`);
    } else {
      await ctx.replyWithHTML(rendered);
    }

    logger.info('Code generated', { prompt: prompt.slice(0, 60) });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    logger.error('Code generation error', { status: err.status, error: err.message });
    await ctx.reply('❌ Code generation failed. Try again.');
  }
};