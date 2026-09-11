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
