const config = require('../../config');
const logger  = require('../utils/logger');

/**
 * Manages per-user conversation history in memory.
 *
 * Architecture note: this is intentionally a thin abstraction so you can
 * swap the backing store for Redis (ioredis) without touching any other file.
 * Just replace the Map operations inside get/push/clear with async Redis calls
 * and make the public methods async.
 */
class ConversationMemory {
  constructor() {
    /**
     * @type {Map<number, { history: Array<{role: string, content: string}>, lastAccess: number }>}
     */
    this._store = new Map();

    // Evict sessions idle longer than TTL — runs every 15 minutes
    setInterval(() => this._evict(), 15 * 60 * 1000).unref();
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Returns a COPY of the message history for a user.
   * Returns [] if the session has expired or doesn't exist.
   * @param {number} userId
   * @returns {Array<{role: string, content: string}>}
   */
  getHistory(userId) {
    const entry = this._store.get(userId);
    if (!entry) return [];

    if (Date.now() - entry.lastAccess > config.conversation.ttlMs) {
      this._store.delete(userId);
      return [];
    }

    entry.lastAccess = Date.now();
    return [...entry.history]; // shallow copy — callers must not mutate
  }

  /**
   * Append one message to a user's history and trim to maxHistory.
   * @param {number} userId
   * @param {'user' | 'assistant'} role
   * @param {string} content
   */
  push(userId, role, content) {
    if (!this._store.has(userId)) {
      this._store.set(userId, { history: [], lastAccess: Date.now() });
    }

    const entry     = this._store.get(userId);
    entry.history.push({ role, content });
    entry.lastAccess = Date.now();

    // Trim oldest messages when exceeding the cap
    const max = config.conversation.maxHistory;
    if (entry.history.length > max) {
      entry.history = entry.history.slice(-max);
    }
  }

  /**
   * Remove the most recently pushed message (used for AI error rollback).
   * @param {number} userId
   */
  popLast(userId) {
    const entry = this._store.get(userId);
    if (entry?.history.length) entry.history.pop();
  }

  /**
   * Wipe a user's entire conversation history.
   * @param {number} userId
   */
  clear(userId) {
    this._store.delete(userId);
    logger.debug('Conversation cleared', { userId });
  }

  /**
   * Number of messages in a user's active history.
   * @param {number} userId
   */
  length(userId) {
    return this.getHistory(userId).length;
  }

  /** Total number of active user sessions currently in memory. */
  get activeSessions() {
    return this._store.size;
  }

  // ── Private ───────────────────────────────────────────────────────────

  _evict() {
    const now     = Date.now();
    let   removed = 0;

    for (const [id, entry] of this._store) {
      if (now - entry.lastAccess > config.conversation.ttlMs) {
        this._store.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('Evicted stale conversation sessions', { count: removed });
    }
  }
}

// Singleton — one shared store for the entire process
module.exports = new ConversationMemory();
