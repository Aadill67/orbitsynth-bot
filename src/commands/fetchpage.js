const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../../config');
const logger = require('../utils/logger');

module.exports = async (ctx) => {
  const url = ctx.message.text.replace(/^\/fetch\s*/i, '').trim();

  if (!url) {
    return ctx.replyWithHTML(
      '📄 <b>Fetch & Summarize</b>\n\n<code>/fetch https://example.com</code>'
    );
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return ctx.reply('❌ Please provide a valid URL starting with http:// or https://');
  }

  const waitMsg = await ctx.reply(`📄 Fetching <i>${url}</i>...`);

  try {
    const { data: html } = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrbitSynthBot/2.0)' },
    });

    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, aside, iframe, noscript, svg, form').remove();

    let text = $('body').text()
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();

    const MAX_CHARS = 8000;
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS) + '...';
    }

    if (!text) {
      throw new Error('No readable content found on this page');
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id, waitMsg.message_id, null,
      '📄 Page fetched. Summarizing with AI...'
    ).catch(() => {});

    if (!config.ai.apiKey) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      return ctx.replyWithHTML(
        `📄 <b>Page Content</b>\n\n<pre>${text.slice(0, 3000)}</pre>\n\n<i>AI summary not available — set GEMINI_API_KEY</i>`
      );
    }

    const ai = new GoogleGenerativeAI(config.ai.apiKey);
    const model = ai.getGenerativeModel({ model: config.ai.model });

    const result = await model.generateContent(
      `Summarize the following web page content in a clear, concise way. Highlight the key points, main topic, and any important details. Keep the summary under 500 words.\n\n---\n\n${text}`
    );
    const summary = result.response.text();

    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    await ctx.replyWithHTML(
      `📄 <b>Summary</b>\n<a href="${url}">${url.length > 60 ? url.slice(0, 60) + '...' : url}</a>\n\n${summary}`
    );

    logger.info('Page fetched and summarized', { url, chars: text.length });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    logger.error('Fetch page error', { url, error: err.message });
    const msg = err.code === 'ENOTFOUND' ? '❌ Could not reach that URL. Check the address.'
      : err.code === 'ECONNABORTED' ? '❌ Request timed out. The page might be too slow.'
      : `❌ Failed: ${err.message}`;
    await ctx.reply(msg);
  }
};
