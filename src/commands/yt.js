const ai = require('../services/ai');
const logger = require('../utils/logger');
const { extractVideoId, getTranscript, getVideoInfo } = require('../services/youtube');
const ytCtx = require('../services/youtubeContext');
const { getSessionKey } = require('../utils/session');

module.exports = async (ctx) => {
  const sessionKey = getSessionKey(ctx);
  const text = ctx.message.text.replace(/^\/yt\s*/i, '').trim();
  if (!text) {
    return ctx.replyWithHTML(
      '🎬 <b>YouTube Summarizer</b>\n\n<code>/yt https://youtube.com/watch?v=...</code>\n<code>/yt &lt;video_id&gt;</code>\n\nOr just send a YouTube link!'
    );
  }

  const videoId = extractVideoId(text);
  if (!videoId) {
    return ctx.reply('❌ Invalid YouTube URL or video ID.');
  }

  const waitMsg = await ctx.reply(`🎬 Fetching video info...`);

  try {
    const info = await getVideoInfo(videoId);
    await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, `📥 Getting transcript for: ${info.title.slice(0, 50)}...`);

    const transcript = await getTranscript(videoId);

    if (transcript.length < 50) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      return ctx.reply('❌ This video has no transcript available.');
    }

    const truncated = transcript.slice(0, 3000);
    const aiPrompt = `Summarize this YouTube video transcript in 3-5 bullet points. Keep it concise and informative.\n\nTitle: ${info.title}\n\nTranscript: ${truncated}`;

    await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, `🤖 Generating summary with AI...`);

    const summary = await ai.chat(sessionKey, aiPrompt, 'concise');

    ytCtx.set(sessionKey, { transcript, title: info.title, videoId });

    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    await ctx.replyWithHTML(
      `🎬 <b>${info.title}</b>\n\n${summary}\n\n💬 <i>You can now ask follow-up questions about this video!</i>\n🔗 <a href="https://youtu.be/${videoId}">Watch on YouTube</a>`
    );

    logger.info('YouTube summarized', { videoId, title: info.title, transcriptLen: transcript.length });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    logger.error('YouTube error', { videoId, error: err.message });
    await ctx.reply('❌ Failed to summarize. The video may have no transcript or captions disabled.');
  }
};
