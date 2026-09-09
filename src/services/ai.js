const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../../config');
const memory = require('./conversation');
const logger = require('../utils/logger');
const { sleep } = require('./http');

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

// Errors we can safely retry (quota/traffic/network).
const RETRYABLE = new Set([429, 500, 502, 503, 529, 0]);

class AIService {
  constructor() {
    this._enabled = !!config.ai.apiKey;
    this._client  = null;
    this._deadModels   = new Map(); // model → timestamp until which it is skipped
    this._lastGoodModel = null;
    this._maxAttempts  = 3;
    this._backoffMs    = 1000;

    if (this._enabled) {
      this._client = new GoogleGenerativeAI(config.ai.apiKey);
      logger.info('🤖 Gemini AI service ready', {
        model:  config.ai.model,
        backup: config.ai.fallbackModels.join(', '),
      });
    } else {
      logger.warn('⚠️  AI service disabled — add GEMINI_API_KEY to .env to enable');
    }
  }

  get isEnabled() { return this._enabled; }

  /** Ordered list of models to try: last-known-good → configured → fallbacks. */
  _modelChain() {
    const chain = [];
    if (this._lastGoodModel) chain.push(this._lastGoodModel);
    if (config.ai.model)      chain.push(config.ai.model);
    for (const m of config.ai.fallbackModels) chain.push(m);
    return [...new Set(chain)].filter(Boolean);
  }

  _markDead(model) {
    this._deadModels.set(model, Date.now() + 30 * 60 * 1000); // re-check in 30 min
  }

  _statusOf(err) {
    if (err?.status) return err.status;
    const msg = String(err?.message || '');
    if (msg.includes('[429') || msg.includes('Quota exceeded'))  return 429;
    if (msg.includes('[503') || msg.includes('[529'))             return 503;
    if (msg.includes('[404') || msg.includes('is not found'))     return 404;
    if (msg.includes('[400'))                                     return 400;
    if (msg.includes('[401') || msg.includes('[403'))             return 403;
    if (msg.includes('fetch failed') || msg.includes('Timeout'))  return 0;
    return 500;
  }

  /** Throw a normalized error with `.status` so handlers can map user messages. */
  _fail(status, message) {
    const err = new Error(message);
    err.status = status;
    err.isAIError = true;
    return err;
  }

  /**
   * Core generation with model fallback + retry.
   * Tries the model chain; on retryable errors backs off and retries.
   */
  async _generate(modelOpts, payload) {
    const models = this._modelChain();
    let lastErr = null;

    for (const model of models) {
      const deadUntil = this._deadModels.get(model);
      if (deadUntil && deadUntil > Date.now()) continue;

      for (let attempt = 0; attempt < this._maxAttempts; attempt++) {
        try {
          const modelObj = this._client.getGenerativeModel({ model, ...modelOpts });
          const result = modelObj.startChat
            ? await modelObj.startChat(payload.startChat).sendMessage(payload.text)
            : await modelObj.generateContent(payload.text);

          const reply = result.response?.text?.() ?? '';
          if (!reply) throw this._fail(500, 'Empty AI response');
          this._lastGoodModel = model;
          return reply;
        } catch (err) {
          lastErr = err;
          const status = this._statusOf(err);

          // Model missing/unsupported → skip to next model (re-check later).
          if (status === 404) {
            this._markDead(model);
            logger.warn('AI model unavailable, trying next model', { model, error: err.message });
            break;
          }

          // Auth broken → no point trying other models.
          if (status === 401 || status === 403) {
            logger.error('AI authentication failed', { status, error: err.message });
            throw this._fail(status, 'AI authentication failed');
          }

          // Quota/rate/overload/network → retry with backoff, then next model.
          if (RETRYABLE.has(status)) {
            if (attempt < this._maxAttempts - 1) {
              const wait = this._backoffMs * (attempt + 1) * (status === 429 ? 2 : 1);
              logger.warn('AI retry', { model, attempt: attempt + 1, status, waitMs: wait });
              await sleep(wait);
              continue;
            }
            // Out of attempts for this model → try the next one.
            logger.warn('AI model exhausted attempts, trying next', { model, status });
            break;
          }

          // Anything else (400 bad request etc.) → surface immediately.
          throw this._fail(status || 500, err.message);
        }
      }
    }

    throw this._fail(lastErr?.status || 500, lastErr?.message || 'All AI models failed');
  }

  /**
   * Send a text message to Gemini and return the AI reply.
   * Manages conversation history automatically.
   */
  async chat(userId, text, personality = 'default', context = '') {
    if (!this._enabled) {
      return '🔇 AI is not configured. Add GEMINI_API_KEY to .env to enable.';
    }

    const finalText = context ? `${context}\n\nUser question: ${text}` : text;

    memory.push(userId, 'user', finalText);

    const allHistory      = memory.getHistory(userId);
    const previousHistory = this._toGeminiHistory(allHistory.slice(0, -1));
    const system          = SYSTEM_PROMPTS[personality] ?? SYSTEM_PROMPTS.default;

    const t0 = Date.now();

    try {
      const reply = await this._generate(
        { systemInstruction: system },
        {
          text:       finalText,
          startChat:  {
            history:          previousHistory,
            generationConfig: { maxOutputTokens: config.ai.maxTokens },
          },
        }
      );

      memory.push(userId, 'assistant', reply);

      logger.info('AI response generated', {
        userId, ms: Date.now() - t0, personality,
        model: this._lastGoodModel, historyDepth: memory.length(userId),
      });

      return reply;
    } catch (err) {
      memory.popLast(userId);
      logger.error('AI service error', { userId, status: err.status, error: err.message });
      throw err;
    }
  }

  /** One-shot text generation (used by /search, /fetch, /code). */
  async synthesize(text, { system } = {}) {
    if (!this._enabled) throw this._fail(403, 'AI is not configured');
    return this._generate(
      system ? { systemInstruction: system } : {},
      { text, startChat: { generationConfig: { maxOutputTokens: config.ai.maxTokens } } }
    );
  }

  /**
   * Analyze an image using Gemini's vision capability.
   * Adds the interaction to conversation memory for context continuity.
   */
  async analyzeImage(userId, base64, mimeType = 'image/jpeg', question = 'Describe this image in detail.') {
    if (!this._enabled) {
      return '🔇 AI vision is not configured. Add GEMINI_API_KEY to .env to enable.';
    }

    const t0 = Date.now();

    try {
      const reply = await this._generate(
        {},
        {
          text:       question,
          startChat:  {
            history:          [{ role: 'user', parts: [{ inlineData: { data: base64, mimeType } }] }],
            generationConfig: { maxOutputTokens: config.ai.maxTokens },
          },
        }
      );

      // Add to conversation memory so follow-up questions have context
      memory.push(userId, 'user',      `[Sent a photo] ${question}`);
      memory.push(userId, 'assistant', reply);

      logger.info('Image analyzed', { userId, ms: Date.now() - t0, mimeType });

      return reply;
    } catch (err) {
      logger.error('Image analysis error', { userId, status: err.status, error: err.message });
      throw err;
    }
  }

  /**
   * Transcribe audio using Gemini's native audio understanding.
   * Used as a free fallback when Whisper (OpenAI) is unavailable.
   */
  async transcribeAudio(base64, mimeType = 'audio/ogg') {
    if (!this._enabled) throw this._fail(403, 'AI is not configured');
    const t0 = Date.now();

    const reply = await this._generate(
      {},
      {
        text: 'Transcribe this audio message verbatim. Return only the transcribed text.',
        startChat: {
          history:          [{ role: 'user', parts: [{ inlineData: { data: base64, mimeType } }] }],
          generationConfig: { maxOutputTokens: 4096 },
        },
      }
    );

    logger.info('Audio transcribed via Gemini', { ms: Date.now() - t0, mimeType });
    return reply;
  }

  _toGeminiHistory(messages) {
    return messages.map(msg => ({
      role:  msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));
  }

  clearHistory(userId)  { memory.clear(userId); }
  historyLength(userId) { return memory.length(userId); }
}

module.exports = new AIService();
