const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    telegramId:   { type: Number, required: true, unique: true, index: true },
    username:     { type: String,  default: null },
    firstName:    { type: String,  default: null },
    lastName:     { type: String,  default: null },
    languageCode: { type: String,  default: 'en' },
    isBlocked:    { type: Boolean, default: false },
    messageCount: { type: Number,  default: 0 },
    defaultCity: { type: String, default: null },
    sessionTtl: { type: Number, default: 3600000 },
    preferences: {
      aiPersonality: {
        type:    String,
        default: 'default',
        enum:    ['default', 'concise', 'detailed', 'friendly'],
      },
    },
    lastSeenAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true, // adds createdAt + updatedAt automatically
  }
);

/** Returns a human-friendly display name. */
userSchema.methods.getDisplayName = function () {
  if (this.username) return `@${this.username}`;
  if (this.firstName) return this.firstName;
  return `User#${this.telegramId}`;
};

module.exports = mongoose.model('User', userSchema);
