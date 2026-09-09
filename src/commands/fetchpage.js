const axios = require('axios');
const cheerio = require('cheerio');
const ai = require('../services/ai');
const logger = require('../utils/logger');
const { assertSafeUrl } = require('../services/http');

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
    // SSRF guard: reject internal/private/metadata targets before fetching.
    let current = url;
    for (let hop = 0; hop <= 5; hop++) {
      await assertSafeUrl(current);

      const { data: html, status, headers } = await axios.get(current, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrbitSynthBot/2.0)' },
        maxRedirects: 0,               // handle redirects manually so every hop is re-validated
        validateStatus: (s) => s < 400,
      });

      // Manual redirect handling with per-hop SSRF re-validation.
      if (status >= 300 && status < 400) {
        const location = headers?.location;
        if (!location) throw new Error('Redirect without Location header');
        current = new URL(location, current).href;
        continue;
      }

      return processPage(ctx, waitMsg, current, html, headers);
    }
    throw new Error('Too many redirects');
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    logger.error('Fetch page error', { url, error: err.message });
    const msg = err.code === 'ENOTFOUND' ? '❌ Could not reach that URL. Check the address.'
      : err.code === 'ECONNABORTED' ? '❌ Request timed out. The page might be too slow.'
      : /private\/internal|Only http|Invalid URL|Could not be resolved/.test(err.message)
        ? `❌ ${err.message}`
      : `❌ Failed: ${err.message}`;
    await ctx.reply(msg);
  }
};

async function processPage(ctx, waitMsg, url, html) {
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

  if (!ai.isEnabled) {
    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    return ctx.replyWithHTML(
      `📄 <b>Page Content</b>\n\n<pre>${escapeHtml(text.slice(0, 3000))}</pre>\n\n<i>AI summary not available — set GEMINI_API_KEY</i>`
    );
  }

  const summary = await ai.synthesize(
    `Summarize the following web page content in a clear, concise way. Highlight the key points, main topic, and any important details. Keep the summary under 500 words.\n\n---\n\n${text}`
  );

  await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
  await ctx.replyWithHTML(
    `📄 <b>Summary</b>\n<a href="${escapeHtml(url)}">${escapeHtml(url.length > 60 ? url.slice(0, 60) + '...' : url)}</a>\n\n${escapeHtml(summary)}`
  );

  logger.info('Page fetched and summarized', { url, chars: text.length });
}

// HTML-escape user/AI content so Telegram's HTML parser never throws on raw chars.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
