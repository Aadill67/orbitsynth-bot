# OrbitSynth Bot — Session Context Save
**Written:** after AI model fix (`1e7f5ac`). **Purpose:** reload context after restart.

---

## What This Project Is
A Telegram chatbot (**OrbitSynth Bot**) at `A:\orbitsynth-bot`. Node.js + `node-telegram-bot-api`
(TG Bot Framework v0.66). Uses Gemini AI (chat, image analysis, OCR, audio transcription,
search/fetch/code synthesis), OpenAI Whisper (voice transcription fallback), MongoDB
(user stats/persistence — optional), Pollinations (image gen), Open-Meteo (weather),
CoinGecko/Binance/CoinCap (crypto), DuckDuckGo (search), YouTube (transcription via captions +
oEmbed metadata). No auto-deploy config exists — only a `Dockerfile`. Deployed manually on
**Render** (`orbitsynth-bot.onrender.com`, webhook mode).

---

## CI/CD / Deploy Facts
- Remote origin: `https://github.com/Aadill67/orbitsynth-bot.git`, branch: `main`
- **Deploy host: Render (free web service)** — user knows how to trigger "Manual Deploy → Clear build cache & deploy"
- `WEBHOOK_URL` set on Render to `https://orbitsynth-bot.onrender.com` → webhook mode (not polling)
- No GitHub Actions / render.yaml / Procfile — deployments are manual after each push
- MongoDB warning on Render logs: `querySrv ENOTFOUND _mongodb._tcp.cluster0.px44z3p.mongodb.net`
  → the MONGODB_URI on Render points to a paused/gone Atlas cluster. Bot runs memory-only (graceful). LOWER priority — cosmetic, but persistence features (User stats, reminders, default city) won't survive restarts until fixed.

---

## LATEST PROBLEM — Gemini Models Retired (THIS IS WHAT WE JUST FIXED)
### Root cause (confirmed by live API tests)
Google retired ALL `gemini-1.x` and `gemini-2.x` models for new keys. API response:
> "gemini-2.5-flash is no longer available. Please update your code to use models/gemini-3.6-flash."

Only these two models work today (VERIFIED with real calls on this API key):
- ✅ `gemini-3.6-flash`
- ✅ `gemini-3-flash-preview`

Every other model the old config used (`gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-1.5-flash`,
`gemini-1.5-pro`, all 2.x/1.x variants) returns **404**. This 404 → "AI model unavailable,
switching to backup" then 500 → "internal error" messages the user saw. The bot's AI features
were ALL dead (chat, /search, /fetch, /code, /ocr, image analysis, voice transcription).

Local `.env` had `AI_MODEL=gemini-3-flash-preview` so local tests worked; **Render env was using
the old default `gemini-2.5-flash`** (the deploy log line:
`Gemini AI service ready {"model":"gemini-2.5-flash",...}` proves it).

### Fix (committed `1e7f5ac`, pushed to origin/main)
1. **config/index.js** — default `AI_MODEL` → `gemini-3.6-flash`; `AI_FALLBACK_MODELS` default →
   `gemini-3.6-flash,gemini-3-flash-preview` (was the dead 2.5/2.0/1.5 chain)
2. **src/services/ai.js** — hardened:
   - `_preflight()` (public wrapper `preflight()`): at boot, pings each model in the chain once;
     dead (404) models are marked dead IMMEDIATELY and cached 6h; live ones cached as
     `_lastGoodModel` fast path; transient failures (429/5xx/timeout) are left alive so runtime
     backoff handles them. → first user message never stalls on dead-model retries.
   - `_generateOnce(model, text, modelOpts, startChat)`: single attempt with a hard **60s timeout**
     (`requestOptions.timeout` + `Promise.race`), so no call can hang the process.
   - `_generate()`: uses `_generateOnce`; tracks tried models; logs exact models attempted + raw
     API error on total failure (`AI all models failed { attempted: 'modelA → modelB' }`).
   - `_statusOf()`: 404 detection also catches "no longer available" / "not found for API".
   - `_markDead(model, ttlMs)`: 404 → 6h TTL, transient → 30min.
3. **index.js** — `boot()` now calls `await ai.preflight?.()` before webhook setup, so Render logs
   show `AI preflight OK {model}` lines confirming exactly which models work.
4. **.env.example** + **README.md** — updated `AI_MODEL` and `AI_FALLBACK_MODELS` docs to
   gemini-3.x only (with 2026 retirement note).

### Verification done (before commit)
- Tested all ~15 candidate model names against the live API — only 3.6-flash / 3-flash-preview pass.
- Full integration test with config forced to dead `gemini-2.5-flash`:
  preflight marked it dead, chat/synthesize instantly recovered via `gemini-3.6-flash`.
- `node --check` on all modified files.

---

## NEXT STEPS (what remains — the user's action)
1. **USER MUST REDEPLOY on Render** — Render dashboard → service → **Manual Deploy → Clear build
   cache & deploy** so it picks up `1e7f5ac`.
2. Optionally set `AI_MODEL=gemini-3.6-flash` in Render's **Environment** tab (only needed if
   `AI_MODEL` is explicitly set there; code default is already correct, and even a dead `AI_MODEL`
   now auto-recovers via preflight + live fallback chain).
3. After redeploy, user sends `/hi` (or any message) in Telegram → should get an AI reply (~4s).
4. Check Render logs after deploy: expect `AI preflight OK {"model":"gemini-3.6-flash"}` and
   `🚀 OrbitSynth Bot is online!`.
5. MongoDB fix (LOW priority, optional): resume/correct the Atlas cluster and update `MONGODB_URI`
   on Render so persistence features (stats/reminders/city) survive restarts. Atlas free tier
   auto-pauses after inactivity — likely just needs a Resume + correct connection string. NOT
   required for AI/basic chat to work.

---

## GIT HISTORY (all pushed to origin/main)
```
1e7f5ac  fix: current Gemini models + startup preflight + hard timeouts + detailed logs  ← HEAD
842ce39  fix: HTML-escape user prompts in /imagine (photo loading message/caption crash)
a058892  fix: replace broken noembed.com with YouTube's own oEmbed API for video info
638f997  fix: harden bot (SSRF protection, non-blocking ffmpeg, HTML-safe replies,
          persistent reminders w/ MongoDB, weather weekday TZ, blocked-user cache,
          webhook 400 on malformed JSON, crypto -0.00% fix, README Claude→Gemini)
67f23e0  fix: YouTube transcript via captionTracks + cleanup unused deps + fix status.js
562a7a1  feat: group chat mode (@mention/reply only, per group+user session context)
85ccd8a  feat: /search AI synthesis (top 3 results → Gemini → single answer w/ links)
a235168  feat: OCR mode (/ocr caption on photo → Gemini Vision text extraction)
```
Working tree: **CLEAN** as of session end.

---

## KEY FILES
- `index.js` — entrypoint; boot() with retry loop; webhook vs polling; preflight hook; watchdog;
  graceful shutdown
- `config/index.js` — env-driven config (ai.model/fallbackModels now gemini-3.x)
- `src/services/ai.js` — **CLAUDE-CRITICAL**: the Gemini wrapper (preflight, model fallback,
  timout, chat/synthesize/analyzeImage/transcribeAudio). Every AI feature funnels through here;
  if a model dies again, THIS is where to look (check the "AI all models failed" / preflight logs)
- `src/services/http.js` — SSRF-safe fetch helpers (`assertSafeUrl`, `isPrivateIp`,
  `fetchWithTimeout`, `sleep`, `TimeoutError`, `pubIp`)
- `src/utils/format.js` — `escapeHtml` / `escapeMarkdownV2` / `replyEscapedHTML`
- `src/models/Reminder.js` — Mongoose reminder model (persistent /remind)
- `src/commands/remind.js` — rewritten (Mongo persist, restore on boot, lazy bot require, no ctx capture)
- `src/commands/fetchpage.js` — SSRF-guarded fetch + per-hop redirect validation
- `src/commands/imagine.js` — image gen (loading msg deleted, HTML-escaped prompt)
- `src/services/youtube.js` — `getVideoInfo` = YouTube oEmbed first, scraper fallback; subtitles
- `src/handlers/voice.js` — async execFile ffmpeg → OpenAI Whisper → Gemini fallback
- `src/middleware/auth.js` — in-memory blockedCache (works when DB down)
- `src/commands/weather.js` + `src/handlers/callbackQuery.js` — weather weekday UTC fix
- `Dockerfile` — only deploy config that exists (no auto-deploy setup)

## COMMANDS USER HAS
`/start /help` `AI chat (no cmd, any message)` `/search <q>` `/img <prompt>` `/imagine <prompt>`
`/yt <url>` `/fetch <url>` `/code <q>` `/weather <city>` `/crypto [coin]` `/translate <text>`
`/ocr <photo>` `/remind <sec> <msg>` `/status` `/mode` `/personality`

## IMPORTANT CONVENTIONS / NOTES
- Only commit/push when the user EXPLICITLY asks (user allows committing+push of multi-file fixes
  — they explicitly requested it earlier in this session chain).
- NO comments in code unless asked (existing code files already have comments from prior sessions —
  follow surrounding style, but don't add new ones gratuitously).
- Windows env (`win32`, shell=bash). Line-ending warnings (LF→CRLF) from git are cosmetic — ignore.
- The user is non-technical about deployment; they call Render "vercel/render" loosely — confirm
  actual host from logs (`/opt/render/...`) before trusting claims. Current host is Render.
- **Never print secrets.** API keys live only in local `.env` (git-ignored) and Render dashboard.
- When AI fails, check BOTH: (a) preflight/404 logs in Render, (b) whether Google retired more
  model names — run the direct REST probe against the key before touching code.
```