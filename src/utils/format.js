const { Markup } = require('telegraf');

/** Escape a string for Telegram's HTML (parse_mode: 'HTML') so the parser never throws. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape a string for Telegram MarkdownV2 reserved characters. */
function escapeMarkdownV2(str) {
  return String(str).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/**
 * Send a multi-line reply as HTML, escaping each line so raw user/AI text
 * containing <, > or & never crashes Telegram's HTML parser.
 * Any line already intended as markup must be pre-escaped by the caller.
 */
function replyEscapedHTML(ctx, lines) {
  const text = lines
    .map(l => (typeof l === 'string' ? escapeHtml(l) : String(l)))
    .join('\n');
  return ctx.replyWithHTML(text);
}

module.exports = { escapeHtml, escapeMarkdownV2, replyEscapedHTML, Markup };
