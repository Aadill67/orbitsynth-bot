const logger = require('../utils/logger');

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
    while ((match = regex.exec(html)) !== null && results.length < 5) {
      results.push({
        url: match[1].replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, '').replace(/&rut=.*$/, ''),
        title: match[2].replace(/<[^>]+>/g, ''),
        snippet: match[3].replace(/<[^>]+>/g, '').trim(),
      });
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

    if (results.length === 0) {
      return ctx.reply('🔍 No results found. Try different keywords.');
    }

    const lines = results.map((r, i) =>
      `${i + 1}. <b>${r.title}</b>\n   ${r.snippet.slice(0, 120)}...\n   <a href="${r.url}">${r.url.slice(0, 60)}</a>`
    );
    await ctx.replyWithHTML(`🔍 <b>Search: ${query}</b>\n\n${lines.join('\n\n')}`);

    logger.info('Web search done', { query, results: results.length });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    logger.error('Search error', { query, error: err.message });
    await ctx.reply('❌ Search failed. Try again later.');
  }
};
