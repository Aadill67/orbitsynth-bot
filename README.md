# OrbitSynth Bot v2

AI-powered Telegram bot built with **Node.js**, **Telegraf**, and **Claude AI**.

## What's New in v2

| Feature | v1 | v2 |
|---|---|---|
| Architecture | Single file (index.js) | Modular (15 files, clear separation) |
| AI | ❌ None | ✅ Claude via Anthropic API |
| Conversation memory | ❌ None | ✅ Per-user, TTL-based, in-memory |
| Database | ❌ None | ✅ MongoDB (optional, bot works without it) |
| Logging | console.log | ✅ Winston (console + file, JSON) |
| Rate limiting | ❌ None | ✅ Sliding window, per-user |
| Inline keyboards | ❌ None | ✅ Full menu system with callbacks |
| Commands | /start only | ✅ /start /help /status /clear |
| AI personalities | ❌ None | ✅ Default / Concise / Detailed / Friendly |
| Error handling | ❌ None | ✅ Global handler + user-friendly messages |
| Graceful shutdown | Basic | ✅ DB disconnect + signal handling |

---

## Quickstart

### 1. Install dependencies

```bash
cd orbitsynth-bot
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | ✅ Yes | From @BotFather on Telegram |
| `ANTHROPIC_API_KEY` | Recommended | From console.anthropic.com |
| `MONGODB_URI` | Optional | Defaults to localhost:27017 |
| `ADMIN_IDS` | Optional | Your Telegram user ID |

### 3. Run

```bash
# Production
npm start

# Development (hot-reload on file change)
npm run dev
```

---

## Project Structure

```
orbitsynth-bot/
├── config/
│   └── index.js              ← All config values + validation
├── src/
│   ├── bot.js                ← Bot factory: middleware + routes
│   ├── commands/
│   │   ├── start.js          ← /start
│   │   ├── help.js           ← /help
│   │   ├── status.js         ← /status
│   │   └── clear.js          ← /clear
│   ├── handlers/
│   │   ├── message.js        ← All text messages → AI
│   │   ├── callbackQuery.js  ← All inline button presses
│   │   └── error.js          ← Global error boundary
│   ├── middleware/
│   │   ├── requestLogger.js  ← Logs every update
│   │   ├── rateLimit.js      ← Per-user sliding-window limiter
│   │   └── auth.js           ← User upsert + block check
│   ├── models/
│   │   └── User.js           ← Mongoose schema
│   ├── services/
│   │   ├── ai.js             ← Anthropic Claude wrapper
│   │   ├── conversation.js   ← Per-user message history store
│   │   └── database.js       ← MongoDB connection
│   └── utils/
│       ├── keyboards.js      ← All Markup.inlineKeyboard builders
│       └── logger.js         ← Winston logger instance
├── logs/                     ← Auto-created: error.log + app.log
├── index.js                  ← Entry point: startup + shutdown
├── package.json
├── .env                      ← Your secrets (never commit this)
└── .env.example              ← Template
```

---

## Optional: MongoDB Setup

The bot runs fine without MongoDB — user preferences and stats just won't persist across restarts.

**Install MongoDB locally (Ubuntu/Debian):**
```bash
sudo apt install mongodb
sudo systemctl start mongodb
```

**Install MongoDB locally (macOS with Homebrew):**
```bash
brew install mongodb-community
brew services start mongodb-community
```

---

## Optional: Development with Hot Reload

```bash
npm install --save-dev nodemon   # already in package.json devDependencies
npm run dev
```

---

## Upgrading Conversation Memory to Redis

The `src/services/conversation.js` is designed for easy Redis migration:

```bash
npm install ioredis
```

Then in `conversation.js`, replace the `Map` operations with:
```javascript
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

// get  → redis.get(userId)
// set  → redis.set(userId, JSON.stringify(data), 'EX', ttlSeconds)
// del  → redis.del(userId)
```

This enables conversation memory to persist across bot restarts and scale across multiple bot instances.

---

## Adding New Commands

1. Create `src/commands/mycommand.js` — export an async function `(ctx) => {}`
2. Register it in `src/bot.js`:
   ```javascript
   const myCmd = require('./commands/mycommand');
   bot.command('mycommand', myCmd);
   ```

That's it.

---

## Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `BOT_TOKEN` | — | **Required.** Telegram bot token |
| `ANTHROPIC_API_KEY` | — | Enables AI chat features |
| `AI_MODEL` | `claude-haiku-4-5-20251001` | Claude model to use |
| `AI_MAX_TOKENS` | `1024` | Max tokens per AI response |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/orbitsynth` | MongoDB connection string |
| `ADMIN_IDS` | — | Comma-separated Telegram IDs (bypass rate limit) |
| `LOG_LEVEL` | `info` | Winston log level: error/warn/info/debug |
