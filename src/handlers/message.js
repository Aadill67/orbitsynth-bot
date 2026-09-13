const config   = require('../../config');
const ai       = require('../services/ai');
const logger   = require('../utils/logger');
const { extractVideoId, getTranscript, getVideoInfo } = require('../services/youtube');
const ytCtx    = require('../services/youtubeContext');
const { getSessionKey, shouldRespondInGroup } = require('../utils/session');
const { aiUserMessage } = require('../utils/errors');
const { escapeHtml } = require('../utils/format');

const MAX_MSG_LEN = 4000; // Telegram hard limit is 4096 — stay under it.

// One in-flight AI reply per session. Prevents a spammer stacking several
// Gemini calls that would cross-corrupt conversation history and drown the
// streaming edit loop.
const activeStreams = new Set();

/** Keep the "typing…" indicator alive while a generation is in progress. */
function startTyping(ctx) {
  let stopped = false;
  const timer = setInterval(async () => {
    if (stopped) return;
    try { await ctx.sendChatAction('typing'); } catch (_) {}
  }, config.ai.typingMs);
  timer.unref?.();
  return { stop() { stopped = true; clearInterval(timer); } };
}

async function editPlain(ctx, msgId, text) {
  try {
    await ctx.telegram.editMessageText(ctx.chat.id, msgId, null, text);
  } catch (_) {
    // "message is not modified" / deleted by user — not fatal.
  }
}

function splitLong(text) {
  const parts = [];
  while (text.length > MAX_MSG_LEN) {
    let cut = text.slice(0, MAX_MSG_LEN);
    if (text[MAX_MSG_LEN] && !/\s/.test(text[MAX_MSG_LEN])) {
      const sp = cut.lastIndexOf(' ');
      if (sp > MAX_MSG_LEN * 0.6) cut = cut.slice(0, sp);
    }
    parts.push(cut);
    text = text.slice(cut.length).trimStart();
  }
  if (text) parts.push(text);
  return parts;
}

module.exports = async (ctx) => {
  const sessionKey = getSessionKey(ctx);
  const text   = ctx.message.text;

  if (text.startsWith('/')) {
    return ctx.reply(`❓ Unknown command. Use /help to see available commands.`).catch(() => {});
  }

  if (!(await shouldRespondInGroup(ctx))) return;

  const videoId = extractVideoId(text);
  if (videoId) {
    const waitMsg = await ctx.reply(`🎬 Detected YouTube link! Fetching transcript...`).catch(() => null);
    if (!waitMsg) return;

    try {
      const info = await getVideoInfo(videoId);
      await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, `📥 Getting transcript for: ${escapeHtml(info.title.slice(0, 50))}...`).catch(() => {});

      const transcript = await getTranscript(videoId);

      if (transcript.length < 50) {
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        return ctx.reply('❌ This video has no transcript available.');
      }

      const truncated = transcript.slice(0, 3000);
      const aiPrompt = `Summarize this YouTube video transcript in 3-5 bullet points.\n\nTitle: ${info.title}\n\nTranscript: ${truncated}`;

      await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, `🤖 Generating AI summary...`).catch(() => {});

      const summary = await ai.chat(sessionKey, aiPrompt, 'concise');

      ytCtx.set(sessionKey, { transcript, title: info.title, videoId });

      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      await ctx.replyWithHTML(
        `🎬 <b>${escapeHtml(info.title)}</b>\n\n${escapeHtml(summary)}\n\n💬 <i>You can now ask follow-up questions about this video!</i>\n🔗 <a href="${escapeHtml('https://youtu.be/' + videoId)}">Watch on YouTube</a>`
      );

      logger.info('YouTube auto-summarized', { videoId, title: info.title });
    } catch (err) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      logger.error('YouTube auto-summary error', { videoId, error: err.message, status: err.status });
      await ctx.reply('❌ Could not summarize this video. Try /yt <url> for more details.');
    }
    return;
  }

  const personality = ctx.session?.personality
    ?? ctx.dbUser?.preferences?.aiPersonality
    ?? 'default';

  /* ── Chat (streaming) ─────────────────────────────────────────────── */
  if (ai.isStreamable) {
    if (activeStreams.has(sessionKey)) {
      return ctx.reply('⏳ I\'m still typing your previous answer — hang on a second!').catch(() => {});
    }
    activeStreams.add(sessionKey);

    const typing   = startTyping(ctx);
    let statusMsg  = null;
    let acc        = '';
    let lastEditAt = 0;

    try {
      statusMsg = await ctx.reply('🤖 Thinking…').catch(() => null);

      const ytData = ytCtx.get(sessionKey);
      const stream = ai.streamChat(
        sessionKey,
        text,
        ytData ? 'default' : personality,
        ytData
          ? `The user previously watched a YouTube video titled "${ytData.title}" (https://youtu.be/${ytData.videoId}).\nUse the transcript below to answer their follow-up question accurately. Reference specific parts of the video in your answer.\n\nTranscript:\n${ytData.transcript.slice(0, 5000)}`
          : ''
      );

      for await (const chunk of stream) {
        if (!acc) typing.stop(); // first token arrived → text is visible now
        acc = chunk;
        if (!statusMsg) continue; // couldn't send placeholder → just consume
        const now = Date.now();
        if (now - lastEditAt >= config.ai.streamEditMs) {
          lastEditAt = now;
          await editPlain(ctx, statusMsg.message_id, acc.slice(0, MAX_MSG_LEN));
        }
      }

      if (statusMsg) {
        const parts = splitLong(acc);
        await editPlain(ctx, statusMsg.message_id, parts[0] || '🤖 …');
        for (let i = 1; i < parts.length; i++) {
          await ctx.reply(parts[i]).catch(() => {});
        }
      } else if (acc) {
        const parts = splitLong(acc);
        for (let i = 0; i < parts.length; i++) {
          await ctx.reply(parts[i]).catch(() => {});
        }
      }
    } catch (err) {
      logger.error('Message handler: AI stream error', { userId: ctx.from.id, error: err.message, status: err.status });
      if (statusMsg) {
        if (acc) {
          await editPlain(ctx, statusMsg.message_id, `${acc.slice(0, MAX_MSG_LEN)}\n\n⚠️ Connection interrupted — this reply may be incomplete.`);
        } else {
          await editPlain(ctx, statusMsg.message_id, aiUserMessage(err.status));
        }
      } else {
        await ctx.reply(aiUserMessage(err.status)).catch(() => {});
      }
    } finally {
      typing.stop();
      activeStreams.delete(sessionKey);
    }
    return;
  }

  /* ── Chat (non-streaming fallback: AI_STREAM=false or disabled) ───── */
  const typing = startTyping(ctx);

  try {
    const ytData = ytCtx.get(sessionKey);
    const reply = ytData
      ? await ai.chat(sessionKey, text, 'default',
          `The user previously watched a YouTube video titled "${ytData.title}" (https://youtu.be/${ytData.videoId}).\nUse the transcript below to answer their follow-up question accurately. Reference specific parts of the video in your answer.\n\nTranscript:\n${ytData.transcript.slice(0, 5000)}`)
      : await ai.chat(sessionKey, text, personality);
    const parts = splitLong(reply);
    for (let i = 0; i < parts.length; i++) {
      await ctx.reply(parts[i]).catch(() => {});
    }
  } catch (err) {
    logger.error('Message handler: AI error', { userId: ctx.from.id, error: err.message, status: err.status });
    await ctx.reply(aiUserMessage(err.status)).catch(() => {});
  } finally {
    typing.stop();
  }
};