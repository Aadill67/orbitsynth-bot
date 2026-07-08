const ai     = require('../services/ai');
const logger = require('../utils/logger');
const { extractVideoId, getTranscript, getVideoInfo } = require('../services/youtube');
const ytCtx = require('../services/youtubeContext');

/**
 * Handles all plain-text messages that aren't handled by a /command.
 * Auto-detects YouTube links, otherwise sends to AI.
 */
module.exports = async (ctx) => {
  const userId = ctx.from.id;
  const text   = ctx.message.text;

  // Commands not matched by bot.command() fall through to here — skip them
  if (text.startsWith('/')) {
    return ctx.reply(
      `❓ Unknown command. Use /help to see available commands.`
    );
  }

  // Auto-detect YouTube links
  const videoId = extractVideoId(text);
  if (videoId) {
    const waitMsg = await ctx.reply(`🎬 Detected YouTube link! Fetching transcript...`);

    try {
      const info = await getVideoInfo(videoId);
      await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, `📥 Getting transcript for: ${info.title.slice(0, 50)}...`);

      const transcript = await getTranscript(videoId);

      if (transcript.length < 50) {
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        return ctx.reply('❌ This video has no transcript available.');
      }

      const truncated = transcript.slice(0, 3000);
      const aiPrompt = `Summarize this YouTube video transcript in 3-5 bullet points.\n\nTitle: ${info.title}\n\nTranscript: ${truncated}`;

      await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, `🤖 Generating AI summary...`);

      const summary = await ai.chat(userId, aiPrompt, 'concise');

      ytCtx.set(userId, { transcript, title: info.title, videoId });

      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      await ctx.replyWithHTML(
        `🎬 <b>${info.title}</b>\n\n${summary}\n\n💬 <i>You can now ask follow-up questions about this video!</i>\n🔗 <a href="https://youtu.be/${videoId}">Watch on YouTube</a>`
      );

      logger.info('YouTube auto-summarized', { videoId, title: info.title });
    } catch (err) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      logger.error('YouTube auto-summary error', { videoId, error: err.message });
      await ctx.reply('❌ Could not summarize this video. Try /yt <url> for more details.');
    }
    return;
  }

  // Read personality from session → DB preference → fallback to default
  const personality = ctx.session?.personality
    ?? ctx.dbUser?.preferences?.aiPersonality
    ?? 'default';

  await ctx.sendChatAction('typing');

  try {
    const ytData = ytCtx.get(userId);
    const reply = ytData
      ? await ai.chat(userId, text, 'default',
          `The user previously watched a YouTube video titled "${ytData.title}" (https://youtu.be/${ytData.videoId}).\nUse the transcript below to answer their follow-up question accurately. Reference specific parts of the video in your answer.\n\nTranscript:\n${ytData.transcript.slice(0, 5000)}`)
      : await ai.chat(userId, text, personality);
    await ctx.reply(reply);

  } catch (err) {
    logger.error('Message handler: AI error', { userId, error: err.message, status: err.status });

    let userMsg;
    if (err.status === 429) {
      userMsg = '⏳ The AI is temporarily overloaded. Please try again in a moment.';
    } else if (err.status === 401) {
      userMsg = '🔑 AI authentication failed. Please contact the bot admin.';
    } else if (err.status === 529) {
      userMsg = '🔧 The AI service is currently overloaded. Please wait a few seconds and try again.';
    } else {
      userMsg = '⚠️ Something went wrong while generating a response. Please try again.';
    }

    await ctx.reply(userMsg);
  }
};
