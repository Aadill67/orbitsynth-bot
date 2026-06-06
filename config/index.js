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
    apiKey:    process.env.GEMINI_API_KEY || null,        // ← Gemini key
    model:     process.env.AI_MODEL || 'gemini-1.5-flash', // ← Gemini model
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '1024', 10),
  },
  rateLimit: {
    windowMs:    10_000,
    maxMessages: 5,
  },
  conversation: {
    maxHistory: 20,
    ttlMs:      60 * 60 * 1000,
  },
};

/** Throws if any required environment variable is missing. */
config.validate = () => {
  if (!config.bot.token) {
    throw new Error('❌  BOT_TOKEN is required — add it to your .env file.');
  }
};

module.exports = config;
