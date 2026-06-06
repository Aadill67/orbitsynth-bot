const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../../config');
const memory = require('./conversation');
const logger = require('../utils/logger');

/* ── System prompts per personality ─────────────────────────────────── */
const SYSTEM_PROMPTS = {
  default: `You are OrbitSynth, a smart and helpful Telegram bot assistant powered by Gemini AI.
Be conversational, concise, and practical — this is a chat interface, not an essay.
Use plain text; avoid heavy markdown since Telegram has limited formatting support.
When the user asks follow-up questions, use the conversation history for context.`,

  concise: `You are OrbitSynth. Reply in 1–3 sentences maximum. Direct, no fluff, no pleasantries.
If a list is needed, keep it under 5 items.`,

  detailed: `You are OrbitSynth. Provide thorough, well-structured answers with context and examples.
Use numbered lists or bullet points when they aid clarity.
Take your time to cover edge cases and nuances.`,

  friendly: `You are OrbitSynth, an enthusiastic and warm assistant!
Be encouraging, upbeat, and accessible. Use occasional emojis to match the vibe.
Keep responses friendly and easy to understand for all skill levels.`,
};

class AIService {
  constructor() {
    this._enabled = !!config.ai.apiKey;

    if (this._enabled) {
      this._client = new GoogleGenerativeAI(config.ai.apiKey);
      logger.info('🤖 Gemini AI service ready', { model: config.ai.model });
    } else {
      logger.warn('⚠️  AI service disabled — add GEMINI_API_KEY to .env to enable');
    }
  }

  get isEnabled() { return this._enabled; }

  _toGeminiHistory(messages) {
    return messages.map(msg => ({
      role:  msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));
  }

  /**
   * Send a text message to Gemini and return the AI reply.
   * Manages conversation history automatically.
   */
  async chat(userId, text, personality = 'default') {
    if (!this._enabled) {
      return '🔇 AI is not configured. Add GEMINI_API_KEY to .env to enable.';
    }

    memory.push(userId, 'user', text);

    const allHistory      = memory.getHistory(userId);
    const previousHistory = this._toGeminiHistory(allHistory.slice(0, -1));
    const system          = SYSTEM_PROMPTS[personality] ?? SYSTEM_PROMPTS.default;

    const t0 = Date.now();

    try {
      const model = this._client.getGenerativeModel({
        model:             config.ai.model,
        systemInstruction: system,
      });

      const chatSession = model.startChat({
        history:          previousHistory,
        generationConfig: { maxOutputTokens: config.ai.maxTokens },
      });

      const result = await chatSession.sendMessage(text);
      const reply  = result.response.text();

      memory.push(userId, 'assistant', reply);

      logger.info('AI response generated', {
        userId, ms: Date.now() - t0, personality,
        historyDepth: memory.length(userId),
      });

      return reply;

    } catch (err) {
      memory.popLast(userId);
      logger.error('AI service error', { userId, error: err.message });
      throw err;
    }
  }

  /**
   * Analyze an image using Gemini's vision capability.
   * Adds the interaction to conversation memory for context continuity.
   *
   * @param {number} userId    Telegram user ID
   * @param {string} base64    Base64-encoded image data
   * @param {string} mimeType  e.g. 'image/jpeg' or 'image/png'
   * @param {string} question  What to ask about the image
   * @returns {Promise<string>}
   */
  async analyzeImage(userId, base64, mimeType = 'image/jpeg', question = 'Describe this image in detail.') {
    if (!this._enabled) {
      return '🔇 AI vision is not configured. Add GEMINI_API_KEY to .env to enable.';
    }

    const t0 = Date.now();

    try {
      // Vision uses generateContent directly (not chat API)
      const model = this._client.getGenerativeModel({ model: config.ai.model });

      const result = await model.generateContent([
        { inlineData: { data: base64, mimeType } },
        { text: question },
      ]);

      const reply = result.response.text();
      const ms    = Date.now() - t0;

      // Add to conversation memory so follow-up questions have context
      memory.push(userId, 'user',      `[Sent a photo] ${question}`);
      memory.push(userId, 'assistant', reply);

      logger.info('Image analyzed', { userId, ms, mimeType });

      return reply;

    } catch (err) {
      logger.error('Image analysis error', { userId, error: err.message });
      throw err;
    }
  }

  clearHistory(userId)  { memory.clear(userId); }
  historyLength(userId) { return memory.length(userId); }
}

module.exports = new AIService();
