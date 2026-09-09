const ai     = require('../services/ai');
const logger = require('../utils/logger');
const { searchWeb } = require('../services/search');
const { escapeHtml } = require('../utils/format');

module.exports = async (ctx) => {
  const query = ctx.message.text.replace(/^\/search\s*/i, '').trim();

  if (!query) {
    return ctx.replyWithHTML(
      '🔍 <b>Web Search</b>\n\n<code>/search latest AI news 2026</code>\n<code>/search JavaScript vs TypeScript</code>'
    );
  }

  const waitMsg = await ctx.reply(`🔍 Searching for "${query}"...`);

  try {
    const results = await searchWeb(query, 3);

    if (results.length === 0) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      return ctx.reply('🔍 No results found. Try different keywords.');
    }

    if (!ai.isEnabled) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      const lines = results.map((r, i) =>
        `${i + 1}. <b>${escapeHtml(r.title)}</b>\n   ${escapeHtml(r.snippet.slice(0, 120))}...\n   <a href="${escapeHtml(r.url)}">${escapeHtml(r.url.slice(0, 60))}</a>`
      );
      return ctx.replyWithHTML(`🔍 <b>Search: ${escapeHtml(query)}</b>\n\n${lines.join('\n\n')}`);
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id, waitMsg.message_id, null,
      `🤖 Synthesizing answer from ${results.length} sources...`
    ).catch(() => {});

    const sourcesText = results.map((r, i) =>
      `Source ${i + 1}: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`
    ).join('\n\n');

    const answer = await ai.synthesize(
      `User query: "${query}"\n\nSearch results:\n${sourcesText}\n\n` +
      `Write a clear, well-structured answer. At the end, list the sources used with their titles and URLs.`,
      { system: `You are a research assistant. Based on the following web search results, write a comprehensive answer to the user's query.` }
    );

    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    await ctx.replyWithHTML(`🔍 <b>Search: ${escapeHtml(query)}</b>\n\n${escapeHtml(answer)}`);

    logger.info('Web search synthesized', { query, sources: results.length });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    logger.error('Search error', { query, error: err.message });
    const hint = err.failures ? ` (${err.failures.join('; ')})` : '';
    await ctx.reply(`❌ Search failed. Try again later.${hint}`);
  }
};
