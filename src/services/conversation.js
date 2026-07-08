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
const DEFAULT_TTL = 3600000;

class ConversationMemory {
  constructor() {
    this._store = new Map();
    setInterval(() => this._evict(), 15 * 60 * 1000).unref();
  }

  getHistory(userId) {
    const entry = this._store.get(userId);
    if (!entry) return [];

    const ttl = entry.ttlMs || DEFAULT_TTL;
    if (Date.now() - entry.lastAccess > ttl) {
      this._store.delete(userId);
      return [];
    }

    entry.lastAccess = Date.now();
    return [...entry.history];
  }

  push(userId, role, content, ttlMs) {
    if (!this._store.has(userId)) {
      this._store.set(userId, { history: [], lastAccess: Date.now(), ttlMs: ttlMs || DEFAULT_TTL });
    }

    const entry = this._store.get(userId);
    entry.history.push({ role, content });
    entry.lastAccess = Date.now();
    if (ttlMs) entry.ttlMs = ttlMs;

    const max = config.conversation.maxHistory;
    if (entry.history.length > max) {
      entry.history = entry.history.slice(-max);
    }
  }

  /**
   * Update TTL for an existing session without pushing a message.
   */
  setTtl(userId, ttlMs) {
    if (this._store.has(userId)) {
      this._store.get(userId).ttlMs = ttlMs;
    }
  }

  popLast(userId) {
    const entry = this._store.get(userId);
    if (entry?.history.length) entry.history.pop();
  }

  clear(userId) {
    this._store.delete(userId);
    logger.debug('Conversation cleared', { userId });
  }

  length(userId) {
    return this.getHistory(userId).length;
  }

  get activeSessions() {
    return this._store.size;
  }

  _evict() {
    const now = Date.now();
    let removed = 0;

    for (const [id, entry] of this._store) {
      const ttl = entry.ttlMs || DEFAULT_TTL;
      if (now - entry.lastAccess > ttl) {
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
