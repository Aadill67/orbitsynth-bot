const { mainMenuKeyboard } = require('../utils/keyboards');

module.exports = async (ctx) => {
  const text =
    `<b>📖 OrbitSynth Bot — Help</b>\n\n` +

    `<b>Commands:</b>\n` +
    `/start  — Show welcome screen & main menu\n` +
    `/help   — Show this help message\n` +
    `/status — Your account & bot stats\n` +
    `/clear  — Wipe your AI chat history\n\n` +

    `<b>AI Chat:</b>\n` +
    `Type any message and I'll reply using Claude AI. ` +
    `I remember the full conversation until you clear it or it expires after 1 hour of inactivity.\n\n` +

    `<b>AI Personalities:</b>\n` +
    `Change how I respond via <b>Settings → AI Personality:</b>\n` +
    `• <b>Default</b>  — Balanced, helpful responses\n` +
    `• <b>Concise</b>  — 1–3 sentence replies only\n` +
    `• <b>Detailed</b> — Thorough answers with context\n` +
    `• <b>Friendly</b> — Warm, emoji-sprinkled tone\n\n` +

    `<b>Tips:</b>\n` +
    `• Context persists across messages\n` +
    `• Use /clear before switching topics for best results\n` +
    `• Admins bypass rate limiting`;

  await ctx.replyWithHTML(text, mainMenuKeyboard());
};
