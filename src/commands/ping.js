const os = require('os');
const ai  = require('../services/ai');
const db  = require('../services/database');
const config = require('../../config');

module.exports = async (ctx) => {
  const start = Date.now();
  const body = (await ctx.telegram.getMe()).username;

  const text =
    `<b>🏓 Pong!</b>\n\n` +
    `• Bot: <code>@${body}</code>\n` +
    `• AI: <code>${ai.isEnabled ? (ai.lastGoodModel || config.ai.model) : 'off'}</code>\n` +
    `• Streaming: <code>${ai.isStreamable ? 'on' : 'off'}</code>\n` +
    `• DB: <code>${db.isConnected() ? 'connected' : 'memory-only'}</code>\n` +
    `• Host: <code>${os.hostname()}</code>\n` +
    `• Reply latency: <code>${Date.now() - start}ms</code>\n` +
    `• Uptime: <code>${Math.floor(process.uptime() / 86400)}d ${Math.floor((process.uptime() % 86400) / 3600)}h</code>`;

  await ctx.replyWithHTML(text);
};