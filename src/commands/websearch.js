const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../../config');
const logger = require('../utils/logger');

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/');
}

module.exports = async (ctx) => {
  const query = ctx.message.text.replace(/^\/search\s*/i, '').trim();

  if (!query) {
    return ctx.replyWithHTML(
      '🔍 <b>Web Search</b>\n\n<code>/search latest AI news 2026</code>\n<code>/search JavaScript vs TypeScript</code>'
    );
  }

  const waitMsg = await ctx.reply(`🔍 Searching for "${query}"...`);

  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrbitSynthBot/2.0)' } }
    );
    if (!res.ok) throw new Error(`Search returned ${res.status}`);

    const html = await res.text();

    const results = [];
    const regex = /<a rel="nofollow" class="result__a" href="([^"]+)".*?>(.*?)<\/a>.*?<a class="result__snippet"[^>]*>(.*?)<\/a>/gs;
    let match;
    while ((match = regex.exec(html)) !== null && results.length < 3) {
      const url = decodeURIComponent(
        match[1].replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, '').replace(/&rut=.*$/, '')
      );
      results.push({
        url,
        title: decodeEntities(match[2].replace(/<[^>]+>/g, '')),
        snippet: decodeEntities(match[3].replace(/<[^>]+>/g, '').trim()),
      });
    }

    if (results.length === 0) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      return ctx.reply('🔍 No results found. Try different keywords.');
    }

    if (!config.ai.apiKey) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      const lines = results.map((r, i) =>
        `${i + 1}. <b>${r.title}</b>\n   ${r.snippet.slice(0, 120)}...\n   <a href="${r.url}">${r.url.slice(0, 60)}</a>`
      );
      return ctx.replyWithHTML(`🔍 <b>Search: ${query}</b>\n\n${lines.join('\n\n')}`);
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id, waitMsg.message_id, null,
      `🤖 Synthesizing answer from ${results.length} sources...`
    ).catch(() => {});

    const sourcesText = results.map((r, i) =>
      `Source ${i + 1}: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`
    ).join('\n\n');

    const ai = new GoogleGenerativeAI(config.ai.apiKey);
    const model = ai.getGenerativeModel({ model: config.ai.model });

    const result = await model.generateContent(
      `You are a research assistant. Based on the following web search results, write a comprehensive answer to the user's query.\n\n` +
      `User query: "${query}"\n\n` +
      `Search results:\n${sourcesText}\n\n` +
      `Write a clear, well-structured answer. At the end, list the sources used with their titles and URLs.`
    );
    const answer = result.response.text();

    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    await ctx.replyWithHTML(
      `🔍 <b>Search: ${query}</b>\n\n${answer.replace(/\n/g, '\n')}`
    );

    logger.info('Web search synthesized', { query, sources: results.length });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    logger.error('Search error', { query, error: err.message });
    await ctx.reply('❌ Search failed. Try again later.');
  }
};
