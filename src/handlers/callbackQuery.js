const ai     = require('../services/ai');
const memory = require('../services/conversation');
const db     = require('../services/database');
const User   = require('../models/User');
const logger = require('../utils/logger');
const {
  mainMenuKeyboard,
  personalityKeyboard,
  confirmClearKeyboard,
  backKeyboard,
} = require('../utils/keyboards');

const VALID_PERSONALITIES = new Set(['default', 'concise', 'detailed', 'friendly']);

async function safeEdit(ctx, text, extra = {}) {
  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...extra });
  } catch (err) {
    const knownSafe = ['not modified', 'message to edit not found', 'MESSAGE_ID_INVALID'];
    if (knownSafe.some(s => err.description?.includes(s) || err.message?.includes(s))) {
      try { await ctx.replyWithHTML(text, extra); } catch (_) {}
    } else {
      throw err;
    }
  }
}

module.exports = async (ctx) => {
  const action = ctx.callbackQuery?.data;
  const userId = ctx.from.id;

  await ctx.answerCbQuery().catch(() => {});

  logger.debug('Callback action', { userId, action });

  // ── Navigation ────────────────────────────────────────────────────
  if (action === 'menu_back') {
    return safeEdit(
      ctx,
      `<b>🏠 OrbitSynth Main Menu</b>\n\nChoose an option or type a message to chat with AI.`,
      mainMenuKeyboard()
    );
  }

  if (action === 'menu_chat') {
    return safeEdit(
      ctx,
      `<b>🤖 AI Chat Mode</b>\n\n` +
      `Just type any message and I'll respond with full conversation memory.\n\n` +
      `Context is remembered for 1 hour of inactivity.`,
      backKeyboard()
    );
  }

  if (action === 'menu_weather') {
    return safeEdit(
      ctx,
      `<b>🌤️ Weather</b>\n\n` +
      `Use the <code>/weather</code> command followed by a city name:\n\n` +
      `<code>/weather London</code>\n` +
      `<code>/weather Tokyo</code>\n` +
      `<code>/weather New York</code>\n\n` +
      `Powered by Open-Meteo (free).`,
      backKeyboard()
    );
  }

  if (action === 'menu_crypto') {
    return safeEdit(
      ctx,
      `<b>💰 Crypto Prices</b>\n\n` +
      `Quick shortcuts:\n` +
      `<code>/btc</code> — Bitcoin\n` +
      `<code>/eth</code> — Ethereum\n` +
      `<code>/sol</code> — Solana\n` +
      `<code>/doge</code> — Dogecoin\n\n` +
      `Search any coin:\n` +
      `<code>/crypto cardano</code>\n` +
      `<code>/crypto avalanche</code>`,
      backKeyboard()
    );
  }

  if (action === 'menu_translate') {
    return safeEdit(
      ctx,
      `<b>🌐 Translate</b>\n\n` +
      `Translate between 100+ languages:\n\n` +
      `<code>/translate en>es Hello</code>\n` +
      `<code>/translate auto>fr Good morning</code>\n` +
      `<code>/translate en>de How are you?</code>\n\n` +
      `<b>Common codes:</b> en, es, fr, de, it, pt, ru, ja, ko, zh, ar, hi`,
      backKeyboard()
    );
  }

  if (action === 'menu_search') {
    return safeEdit(
      ctx,
      `<b>🔍 Web Search</b>\n\n` +
      `Search the web right from Telegram:\n\n` +
      `<code>/search latest AI news 2026</code>\n` +
      `<code>/search best React courses</code>\n` +
      `<code>/search JavaScript vs Rust</code>\n\n` +
      `Powered by DuckDuckGo (private).`,
      backKeyboard()
    );
  }

  if (action === 'menu_youtube') {
    return safeEdit(
      ctx,
      `<b>🎬 YouTube Summarizer</b>\n\n` +
      `Get AI-powered summaries of any YouTube video:\n\n` +
      `<code>/yt https://youtube.com/watch?v=...</code>\n` +
      `<code>/yt &lt;video_id&gt;</code>\n\n` +
      `Or just <b>paste a YouTube link</b> and I'll auto-detect it!`,
      backKeyboard()
    );
  }

  if (action === 'menu_remind') {
    return safeEdit(
      ctx,
      `<b>⏰ Reminders</b>\n\n` +
      `Set reminders with natural time:\n\n` +
      `<code>/remind 10m Deploy the bot</code>\n` +
      `<code>/remind 1h Take a break</code>\n` +
      `<code>/remind 30s Quick test</code>\n\n` +
      `<b>Units:</b> s (seconds), m (minutes), h (hours)`,
      backKeyboard()
    );
  }

  if (action === 'menu_help') {
    return safeEdit(
      ctx,
      `<b>❓ Help</b>\n\n` +
      `<b>AI & Chat</b>\n` +
      `<code>/start</code>     — Welcome screen\n` +
      `<code>/help</code>      — This help\n` +
      `<code>/status</code>    — Your stats\n` +
      `<code>/clear</code>     — Reset AI memory\n\n` +
      `<b>Tools</b>\n` +
      `<code>/weather</code>   — Weather forecast\n` +
      `<code>/crypto</code>    — Crypto prices\n` +
      `<code>/btc /eth /sol</code> — Quick prices\n` +
      `<code>/translate</code> — Translate text\n` +
      `<code>/search</code>    — Web search\n` +
      `<code>/yt</code>        — YouTube summary\n` +
      `<code>/remind</code>    — Set a reminder\n` +
      `<code>/imagine</code>   — Generate image 🎨\n\n` +
      `<b>Send a photo</b> to analyze with AI 🖼️\n` +
      `<b>Send a YouTube link</b> for auto-summary 🎬`,
      backKeyboard()
    );
  }

  if (action === 'menu_stats') {
    const histLen     = memory.length(userId);
    const personality = ctx.session?.personality
      ?? ctx.dbUser?.preferences?.aiPersonality
      ?? 'default';

    return safeEdit(
      ctx,
      `<b>📊 Quick Stats</b>\n\n` +
      `User ID:            <code>${userId}</code>\n` +
      `Total messages:     ${ctx.dbUser?.messageCount ?? 'N/A'}\n` +
      `AI personality:     ${personality}\n` +
      `Conversation depth: ${histLen} message${histLen !== 1 ? 's' : ''}\n` +
      `AI service:         ${ai.isEnabled     ? '✅ Online' : '❌ Offline'}\n` +
      `Database:           ${db.isConnected() ? '✅ Connected' : '⚠️ Memory-only'}`,
      backKeyboard()
    );
  }

  if (action === 'menu_settings') {
    const current = ctx.session?.personality
      ?? ctx.dbUser?.preferences?.aiPersonality
      ?? 'default';

    return safeEdit(
      ctx,
      `<b>⚙️ Settings — AI Personality</b>\n\nChoose how I respond. Saved automatically.`,
      personalityKeyboard(current)
    );
  }

  // ── 🎨 Image Generation Info ──────────────────────────────────────
  if (action === 'menu_imagine') {
    return safeEdit(
      ctx,
      `<b>🎨 Image Generator</b>\n\n` +
      `Use the <code>/imagine</code> command followed by your description:\n\n` +
      `<code>/imagine a wolf howling at the moon, digital art</code>\n` +
      `<code>/imagine cozy coffee shop on a rainy day, warm lighting</code>\n` +
      `<code>/imagine futuristic city at night, neon lights, cyberpunk</code>\n\n` +
      `<b>Tips:</b>\n` +
      `• Mention art style (realistic, anime, watercolor)\n` +
      `• Mention lighting (golden hour, dramatic, neon)\n` +
      `• Be specific for better results\n\n` +
      `✅ Completely free — unlimited generations!`,
      backKeyboard()
    );
  }

  // ── 🖼️ Photo Analysis Info ───────────────────────────────────────
  if (action === 'menu_photo') {
    return safeEdit(
      ctx,
      `<b>🖼️ Photo Analyzer</b>\n\n` +
      `Simply <b>send any photo</b> to this chat and I'll analyze it using Gemini Vision AI.\n\n` +
      `<b>What I can do:</b>\n` +
      `• Describe what's in the image\n` +
      `• Read and extract text from photos\n` +
      `• Answer questions about the image\n` +
      `• Identify objects, places, and people\n` +
      `• Analyze charts, diagrams, screenshots\n\n` +
      `<b>Tip:</b> Add a caption to your photo to ask a specific question!\n` +
      `Example: send a photo with caption <i>"What brand is this?"</i>`,
      backKeyboard()
    );
  }

  // ── Confirm / cancel clear ────────────────────────────────────────
  if (action === 'menu_clear') {
    const count = memory.length(userId);
    if (count === 0) {
      return safeEdit(
        ctx,
        `<b>🧹 Nothing to Clear</b>\n\nYour conversation history is already empty.`,
        backKeyboard()
      );
    }
    return safeEdit(
      ctx,
      `<b>🗑️ Clear History?</b>\n\n` +
      `This will delete <b>${count} message${count !== 1 ? 's' : ''}</b>. The AI will lose all context.\n\nAre you sure?`,
      confirmClearKeyboard()
    );
  }

  if (action === 'confirm_clear') {
    const count = memory.length(userId);
    ai.clearHistory(userId);
    return safeEdit(
      ctx,
      `<b>✅ History Cleared</b>\n\nRemoved ${count} message${count !== 1 ? 's' : ''}. Fresh start on next message.`,
      backKeyboard()
    );
  }

  if (action === 'cancel_action') {
    return safeEdit(
      ctx,
      `<b>🏠 OrbitSynth Main Menu</b>\n\nAction cancelled.`,
      mainMenuKeyboard()
    );
  }

  // ── Personality ───────────────────────────────────────────────────
  if (action?.startsWith('set_personality_')) {
    const chosen = action.replace('set_personality_', '');
    if (!VALID_PERSONALITIES.has(chosen)) return;

    if (ctx.session != null) ctx.session.personality = chosen;

    if (db.isConnected() && ctx.dbUser) {
      try {
        await User.updateOne(
          { telegramId: userId },
          { $set: { 'preferences.aiPersonality': chosen } }
        );
      } catch (err) {
        logger.error('Failed to persist personality', { userId, err: err.message });
      }
    }

    logger.info('Personality updated', { userId, chosen });

    return safeEdit(
      ctx,
      `<b>⚙️ Settings — AI Personality</b>\n\n✅ Set to <b>${chosen}</b>. I'll respond in ${chosen} style from now on.`,
      personalityKeyboard(chosen)
    );
  }

  logger.warn('Unknown callback action', { userId, action });
  await ctx.answerCbQuery('Unknown action', { show_alert: true }).catch(() => {});
};
