// src/commands/imagine.js

const { generateImageWithFlux } = require("../services/imageGenerator");
const logger = require("../utils/logger");
const { escapeHtml } = require("../utils/format");

/** editMessageText is not modified-friendly (uses plain text marker approach). */
async function editStatus(ctx, msgId, text) {
  try {
    await ctx.telegram.editMessageText(ctx.chat.id, msgId, null, text);
  } catch (_) {
    // Message deleted by user / not modified — ignore.
  }
}

module.exports = async (ctx) => {
  const userId = ctx.from.id;
  // Extract the prompt from the user's message
  const prompt = ctx.message.text.replace(/^\/imagine\s*/i, "").trim();

  if (!prompt) {
    return ctx.replyWithHTML(
      `🎨 <b>Image Generator</b>\n\n` +
        `<code>/imagine Kashmir mountains at golden hour</code>\n` +
        `<code>/imagine wolf howling at moon, digital art</code>`,
    );
  }

  let waitMsg;

  try {
    waitMsg = await ctx.replyWithHTML(
      `🎨 Generating...\n📝 <i>${escapeHtml(prompt)}</i>\n\n⏳ ~5-10 seconds...`,
    );

    const imageBuffer = await generateImageWithFlux(prompt);

    // Send the photo FIRST, delete the "Generating..." message only after the
    // photo is safely delivered. If a failure happens here the user still sees
    // the status message with a clear error instead of it mysteriously wiping.
    await ctx.sendChatAction("upload_photo").catch(() => {});
    try {
      await ctx.replyWithPhoto(
        { source: imageBuffer, filename: "generated.jpg" },
        {
          parse_mode: "HTML",
          caption: `🎨 <b>Generated</b>\n📝 <i>${escapeHtml(prompt)}</i>`,
        },
      );
    } catch (sendErr) {
      // Transient Telegram failure — retry once before giving up.
      logger.warn("sendPhoto retry", { userId, error: sendErr.message });
      await ctx.sendChatAction("upload_photo").catch(() => {});
      await ctx.replyWithPhoto(
        { source: imageBuffer, filename: "generated.jpg" },
        {
          parse_mode: "HTML",
          caption: `🎨 <b>Generated</b>\n📝 <i>${escapeHtml(prompt)}</i>`,
        },
      );
    }

    if (waitMsg) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    }

    logger.info("Image generated", {
      userId,
      prompt: prompt.slice(0, 60),
    });
  } catch (err) {
    logger.error("Image generation error", { userId, error: err.message, status: err.status });

    // Always surface the failure IN the status message — never delete it.
    // A disappearing message + zero explanation is the worst UX.
    const reason =
      err.message?.includes("402") || err.message?.includes("429")
        ? "The image service is busy. Wait a few seconds and try again."
        : err.message?.includes("Timeout") || err.message?.includes("fetch failed")
        ? "The image service took too long to respond. Try again."
        : "Something went wrong while generating. Try a different prompt.";

    const text = `❌ <b>Generation failed</b>\n📝 <i>${escapeHtml(prompt)}</i>\n\n${reason}`;

    if (waitMsg) {
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, text, { parse_mode: "HTML" });
      } catch (_) {
        await ctx.reply(text, { parse_mode: "HTML" }).catch(() => {});
      }
    } else {
      await ctx.reply(text, { parse_mode: "HTML" }).catch(() => {});
    }
  }
};