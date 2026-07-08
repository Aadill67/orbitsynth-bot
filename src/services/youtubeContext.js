const TTL = 60 * 60 * 1000;
const store = new Map();

module.exports = {
  set(userId, data) {
    store.set(userId, { ...data, timestamp: Date.now() });
  },

  get(userId) {
    const data = store.get(userId);
    if (!data) return null;
    if (Date.now() - data.timestamp > TTL) {
      store.delete(userId);
      return null;
    }
    store.set(userId, { ...data, timestamp: Date.now() });
    return data;
  },

  clear(userId) {
    store.delete(userId);
  },
};
