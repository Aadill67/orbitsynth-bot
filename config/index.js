require('dotenv').config();

const config = {
  bot: {
    token: process.env.BOT_TOKEN,
    adminIds: process.env.ADMIN_IDS
      ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim(), 10)).filter(Boolean)
      : [],
  },
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/orbitsynth',
  },
  ai: {
    apiKey: process.env.GEMINI_API_KEY || null,
    model:  process.env.AI_MODEL || 'gemini-3.6-flash',
    // If the configured model is down/disabled, the AI service walks this
    // chain until one responds. Keep known-good, stable model names here.
    // (As of 2026, gemini-2.x/1.x models are retired by Google.)
    fallbackModels: (process.env.AI_FALLBACK_MODELS || 'gemini-3.6-flash,gemini-3-flash-preview')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '1024', 10),
    // Stream replies to the user token-by-token (big perceived speed win).
    // The reply placeholder is edited ~every streamEditMs so the user sees
    // text flowing in instead of a long silent wait. Disable by setting
    // AI_STREAM=false.
    stream:       process.env.AI_STREAM !== 'false',
    streamEditMs: parseInt(process.env.AI_STREAM_EDIT_MS || '1500', 10),
    // Minimum interval between "typing..." chat actions. Telegram drops them
    // after ~5s of inactivity, so a sustained loop stops the indicator
    // flickering off during long generations.
    typingMs: parseInt(process.env.AI_TYPING_MS || '4000', 10),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || null,
  },
  rateLimit: {
    windowMs:    10_000,
    maxMessages: 5,
  },
  conversation: {
    maxHistory: 20,
    ttlMs:      60 * 60 * 1000,
  },
  server: {
    port: parseInt(process.env.PORT || '8080', 10),
  },
};

/** Throws if any required environment variable is missing. */
config.validate = () => {
  if (!config.bot.token) {
    throw new Error('❌  BOT_TOKEN is required — add it to your .env file.');
  }
};

module.exports = config;
