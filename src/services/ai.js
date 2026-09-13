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

// Hard ceiling for a single Gemini call (connect + generate). Prevents the
// process from hanging forever if Google's API stalls.
const REQUEST_TIMEOUT_MS = 60_000;

// Ceiling for a single streaming-chunk wait. Guards against a stalled network
// mid-stream so a user's reply never hangs forever.
const STREAM_CHUNK_TIMEOUT_MS = 45_000;

// Cooldown before a "model not found"-style failure is re-checked.
// 404 / "no longer available" are essentially permanent, so use a long TTL.
const DEAD_MODEL_NOT_FOUND_TTL = 6 * 60 * 60 * 1000; // 6 h
const DEAD_MODEL_RETRY_TTL     = 30 * 60 * 1000;     // 30 min for transient errors

class AIService {
  constructor() {
    this._enabled = !!config.ai.apiKey;
    this._client  = null;
    this._deadModels   = new Map(); // model → timestamp until which it is skipped
    this._lastGoodModel = null;
    this._maxAttempts  = 2;
    this._backoffMs    = 1200;
    this._preflightDone = false;

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

  get isStreamable() { return this._enabled && config.ai.stream; }

  /** Model that last produced a good reply (used by /status + /health). */
  get lastGoodModel() { return this._lastGoodModel; }

  /** Public wrapper so other modules can kick off the startup model check. */
  preflight() { return this._preflight(); }

  /** Ordered list of models to try: last-known-good → configured → fallbacks. */
  _modelChain() {
    const chain = [];
    if (this._lastGoodModel) chain.push(this._lastGoodModel);
    if (config.ai.model)      chain.push(config.ai.model);
    for (const m of config.ai.fallbackModels) chain.push(m);
    return [...new Set(chain)].filter(Boolean);
  }

  _markDead(model, ttlMs = DEAD_MODEL_RETRY_TTL) {
    this._deadModels.set(model, Date.now() + ttlMs);
  }

  /**
   * Ping every model in the chain once at startup. Models that respond OK are
   * remembered (fast path); dead models are marked dead so the very first user
   * message is not slowed down by a full retry cycle. Failures are logged so
   * Render/Vercel logs tell you exactly which model names are wrong.
   */
  async _preflight() {
    if (this._preflightDone || !this._enabled) return;
    this._preflightDone = true;

    const candidates = [...new Set([config.ai.model, ...config.ai.fallbackModels])].filter(Boolean);
    for (const model of candidates) {
      // Marked dead recently → skip, keep the existing cooldown.
      if (this._isDead(model)) continue;
      try {
        await this._generateOnce(model, 'Reply with the single word: OK');
        if (!this._lastGoodModel) this._lastGoodModel = model;
        logger.info('AI preflight OK', { model });
      } catch (err) {
        // Only "model not found" is permanent — mark it dead. Transient
        // failures (quota/traffic/timeout) are left alive so the runtime
        // retry/backoff logic handles them normally.
        if (err.status === 404) {
          this._markDead(model, DEAD_MODEL_NOT_FOUND_TTL);
          logger.warn('AI preflight: model unavailable', {
            model, status: err.status || 500, error: err.message,
          });
        } else {
          logger.warn('AI preflight: transient check failed', {
            model, status: err.status || 500, error: err.message,
          });
        }
      }
    }
  }

  _isDead(model) {
    const until = this._deadModels.get(model);
    return !!(until && until > Date.now());
  }

  /**
   * One attempt on one model, wrapped in a hard timeout so no call can hang
   * the process forever.
   */
  async _generateOnce(model, text, modelOpts = {}, startChat = {}) {
    const modelObj = this._client.getGenerativeModel({
      model,
      ...modelOpts,
      requestOptions: { timeout: REQUEST_TIMEOUT_MS },
    });

    const promise = modelObj.startChat
      ? modelObj.startChat(startChat).sendMessage(text)
      : modelObj.generateContent(text);

    const result = await Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(this._fail(0, `AI request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)), REQUEST_TIMEOUT_MS + 2000)
      ),
    ]);

    const reply = result?.response?.text?.() ?? '';
    if (!reply) throw this._fail(500, 'Empty AI response');
    return reply;
  }

  _statusOf(err) {
    if (err?.status) return err.status;
    const msg = String(err?.message || '');
    if (msg.includes('[429') || msg.includes('Quota exceeded'))  return 429;
    if (msg.includes('[503') || msg.includes('[529'))             return 503;
    if (msg.includes('[404') || msg.includes('is not found')
        || msg.includes('no longer available') || msg.includes('not found for API')) return 404;
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
    const tried  = [];
    let lastErr = null;

    for (const model of models) {
      if (this._isDead(model)) continue;

      for (let attempt = 0; attempt < this._maxAttempts; attempt++) {
        const attemptLabel = `model=${model} attempt=${attempt + 1}/${this._maxAttempts}`;
        try {
          const reply = await this._generateOnce(model, payload.text, modelOpts, payload.startChat);
          this._lastGoodModel = model;
          return reply;
        } catch (err) {
          lastErr = err;
          tried.push(attempt === 0 ? model : `${model}#${attempt + 1}`);
          const status = this._statusOf(err);

          // Model missing/unsupported → skip to next model (re-check much later).
          if (status === 404) {
            this._markDead(model, DEAD_MODEL_NOT_FOUND_TTL);
            logger.warn('AI model unavailable, trying next model', { model, error: err.message });
            break;
          }

          // Auth broken → no point trying other models.
          if (status === 401 || status === 403) {
            logger.error('AI authentication failed', { status, error: err.message });
            throw this._fail(status, 'AI authentication failed');
          }

          // Quota/rate/overload/network/timeout → retry with backoff, then next model.
          if (RETRYABLE.has(status)) {
            if (attempt < this._maxAttempts - 1) {
              const wait = this._backoffMs * (attempt + 1) * (status === 429 ? 2 : 1);
              logger.warn('AI retry', { model, attempt: attempt + 1, status, waitMs: wait });
              await sleep(wait);
              continue;
            }
            logger.warn('AI model exhausted attempts, trying next', { model, status });
            break;
          }

          // Anything else (400 bad request etc.) → surface immediately.
          throw this._fail(status || 500, `${err.message} (${attemptLabel})`);
        }
      }
    }

    const err = this._fail(lastErr?.status || 500, lastErr?.message || 'All AI models failed');
    logger.error('AI all models failed', {
      attempted: tried.join(' → '),
      status: err.status,
      error: err.message,
    });
    return Promise.reject(err);
  }

  _raceTimeout(promise, ms, message) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(this._fail(0, message)), ms)
      ),
    ]);
  }

  /** Open a streaming chat session on `model` (hard timeout on connect). */
  async _openStream(model, text, modelOpts = {}, startChat = {}) {
    const modelObj = this._client.getGenerativeModel({
      model,
      ...modelOpts,
      requestOptions: { timeout: REQUEST_TIMEOUT_MS },
    });
    const result = await this._raceTimeout(
      modelObj.startChat(startChat).sendMessageStream(text),
      REQUEST_TIMEOUT_MS + 2000,
      `AI stream timed out opening ${REQUEST_TIMEOUT_MS / 1000}s`
    );
    return result; // { stream: AsyncGenerator, response: Promise }
  }

  /**
   * Core streaming generation with model fallback + retry, mirroring
   * `_generate` but yielding partial text as it arrives. Yields the
   * accumulated reply on every chunk so the caller can render live text;
   * the final authoritative value is the aggregated response text.
   */
  async *_generateStream(modelOpts, payload) {
    const models = this._modelChain();
    const tried  = [];
    let lastErr = null;

    for (const model of models) {
      if (this._isDead(model)) continue;

      for (let attempt = 0; attempt < this._maxAttempts; attempt++) {
        try {
          const result   = await this._openStream(model, payload.text, modelOpts, payload.startChat);
          const iterator = result.stream[Symbol.asyncIterator]();
          this._lastGoodModel = model;

          let acc = '';
          for (;;) {
            const { done, value } = await this._raceTimeout(
              iterator.next(),
              STREAM_CHUNK_TIMEOUT_MS,
              `AI stream stalled >${STREAM_CHUNK_TIMEOUT_MS / 1000}s`
            );
            if (done) break;
            const t = value?.text?.() || '';
            if (t) {
              acc += t;
              yield acc; // live partial reply
            }
          }

          // Aggregated response text is the authoritative final answer.
          const full = (await result.response)?.text?.() || acc;
          if (full) {
            yield full;
            return;
          }
          throw this._fail(500, 'Empty AI response');
        } catch (err) {
          lastErr = err;
          tried.push(attempt === 0 ? model : `${model}#${attempt + 1}`);
          const status = this._statusOf(err);

          if (status === 404) {
            this._markDead(model, DEAD_MODEL_NOT_FOUND_TTL);
            logger.warn('AI stream model unavailable, trying next', { model, error: err.message });
            break;
          }
          if (status === 401 || status === 403) {
            logger.error('AI stream authentication failed', { status, error: err.message });
            throw this._fail(status, 'AI authentication failed');
          }
          if (RETRYABLE.has(status)) {
            if (attempt < this._maxAttempts - 1) {
              const wait = this._backoffMs * (attempt + 1) * (status === 429 ? 2 : 1);
              logger.warn('AI stream retry', { model, attempt: attempt + 1, status, waitMs: wait });
              await sleep(wait);
              continue;
            }
            logger.warn('AI stream model exhausted attempts, trying next', { model, status });
            break;
          }
          throw this._fail(status || 500, `${err.message} (streaming)`);
        }
      }
    }

    const err = this._fail(lastErr?.status || 500, lastErr?.message || 'All AI models failed');
    logger.error('AI stream all models failed', {
      attempted: tried.join(' → '),
      status: err.status,
      error: err.message,
    });
    throw err;
  }

  /**
   * Send a text message to Gemini and stream the reply back token-by-token.
   * Usage: for await (const partial of ai.streamChat(...)) { ... }
   * Same memory handling + personalities as chat(). Callers must consume
   * until completion; a terminal error rejects after yielding partial text.
   */
  async *streamChat(userId, text, personality = 'default', context = '') {
    if (!this._enabled) {
      yield '🔇 AI is not configured. Add GEMINI_API_KEY to .env to enable.';
      return;
    }

    const finalText = context ? `${context}\n\nUser question: ${text}` : text;

    memory.push(userId, 'user', finalText);

    const allHistory      = memory.getHistory(userId);
    const previousHistory = this._toGeminiHistory(allHistory.slice(0, -1));
    const system          = SYSTEM_PROMPTS[personality] ?? SYSTEM_PROMPTS.default;

    const t0 = Date.now();
    let lastChunk = '';

    try {
      for await (const chunk of this._generateStream(
        { systemInstruction: system },
        {
          text: finalText,
          startChat: {
            history:          previousHistory,
            generationConfig: { maxOutputTokens: config.ai.maxTokens },
          },
        }
      )) {
        lastChunk = chunk;
        yield chunk;
      }

      memory.push(userId, 'assistant', lastChunk);

      logger.info('AI response streamed', {
        userId, ms: Date.now() - t0, personality,
        model: this._lastGoodModel, historyDepth: memory.length(userId),
      });
    } catch (err) {
      memory.popLast(userId);
      logger.error('AI stream service error', { userId, status: err.status, error: err.message });
      throw err;
    }
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
