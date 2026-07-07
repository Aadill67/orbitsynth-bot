const { mainMenuKeyboard } = require('../utils/keyboards');

module.exports = async (ctx) => {
  const text =
    `<b>📖 OrbitSynth Bot — Help</b>\n\n` +

    `<b>AI & Chat:</b>\n` +
    `Type any message to chat with AI. Full conversation memory for 1 hour.\n\n` +

    `<b>Commands:</b>\n` +
    `/start     — Welcome & main menu\n` +
    `/help      — This help\n` +
    `/status    — Your stats\n` +
    `/clear     — Reset AI memory\n` +
    `/weather   — Weather forecast for any city\n` +
    `/crypto    — Crypto price (e.g. /crypto bitcoin)\n` +
    `/btc /eth /sol — Quick crypto prices\n` +
    `/translate — Translate text (e.g. en>fr Hello)\n` +
    `/search    — Web search\n` +
    `/yt        — YouTube video summary\n` +
    `/remind    — Set a reminder\n` +
    `/imagine   — Generate AI image 🎨\n\n` +

    `<b>Smart Auto-Detect:</b>\n` +
    `• Send a YouTube link → auto-summary 🎬\n` +
    `• Send a photo → AI analysis 🖼️\n\n` +

    `<b>AI Personalities:</b>\n` +
    `Settings → AI Personality:\n` +
    `• <b>Default</b>  — Balanced\n` +
    `• <b>Concise</b>  — 1–3 sentences\n` +
    `• <b>Detailed</b> — Thorough\n` +
    `• <b>Friendly</b> — Warm with emojis\n\n` +

    `<b>Tips:</b>\n` +
    `• Context persists per conversation\n` +
    `• Use /clear before switching topics\n` +
    `• Admins bypass rate limiting`;

  await ctx.replyWithHTML(text, mainMenuKeyboard());
};
