// src/commands/imagine.js

const { generateImageWithFlux } = require("../services/imageGenerator");
const logger = require("../utils/logger");
const { escapeHtml } = require("../utils/format");

// One image generation per user — spamming /imagine can't stack multiple
// slow Pollinations calls that each block for up to a minute.
const inFlight = new Set();

async function editStatus(ctx, msgId, text, extra = {}) {
  try {
    await ctx.telegram.editMessageText(ctx.chat.id, msgId, null, text, extra);
  } catch (_) {
    // Message deleted by user / not modified — ignore.
  }
}

module.exports = async (ctx) => {
  const userId = ctx.from.id;
  const promptText = ctx.message.text.replace(/^\/imagine\s*/i, "").trim();

  if (!promptText) {
    return ctx.replyWithHTML(
      `🎨 <b>Image Generator</b>\n\n` +
        `<code>/imagine Kashmir mountains at golden hour</code>\n` +
        `<code>/imagine wolf howling at moon, digital art</code>`,
    );
  }

  if (inFlight.has(userId)) {
    return ctx.reply("⏳ I'm still generating your last image — hang on a few more seconds!").catch(() => {});
  }
  inFlight.add(userId);

  let waitMsg = null;
  let statusTimer = null;

  try {
    waitMsg = await ctx.replyWithHTML(
      `🎨 Generating your image...\n📝 <i>${escapeHtml(promptText)}</i>\n\n⏳ Usually takes 5-45 seconds.`,
    );

    // Keep the status message alive with a refresher so the user always sees
    // progress instead of a frozen "Generating..." while Pollinations works.
    const t0 = Date.now();
    statusTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - t0) / 1000);
      editStatus(
        ctx,
        waitMsg.message_id,
        `🎨 Generating your image... ⏳ <b>${sec}s</b>\n📝 <i>${escapeHtml(promptText)}</i>\n\nImages can take up to a minute on a cold prompt.`,
        { parse_mode: "HTML" }
      );
    }, 10000);
    statusTimer.unref?.();

    const result = await generateImageWithFlux(promptText);
    clearInterval(statusTimer);
    statusTimer = null;

    const caption = { parse_mode: "HTML", caption: `🎨 <b>Generated</b>\n📝 <i>${escapeHtml(promptText)}</i>` };

    // URL mode: Telegram downloads the image directly (avoids Render upload issues).
    // Buffer mode: upload from the bot (works when Render networking is healthy).
    await ctx.sendChatAction("upload_photo").catch(() => {});
    const photoSource = result.url ? result.url : { source: result.buffer, filename: "generated.jpg" };

    try {
      await ctx.replyWithPhoto(photoSource, caption);
    } catch (sendErr) {
      logger.warn("sendPhoto retry", { userId, error: sendErr.message, mode: result.url ? 'url' : 'buffer' });
      await ctx.sendChatAction("upload_photo").catch(() => {});
      try {
        await ctx.replyWithPhoto(photoSource, caption);
      } catch (retryErr) {
        logger.error("sendPhoto failed after retry", { userId, error: retryErr.message });
        throw retryErr;
      }
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

    logger.info("Image generated", {
      userId,
      prompt: promptText.slice(0, 60),
      ms: Date.now() - t0,
    });
  } catch (err) {
    logger.error("Image generation error", { userId, error: err.message, status: err.status });

    const reason =
      err.message?.includes("402") || err.message?.includes("429") || err.message?.includes("quota")
        ? "The image service is busy right now. Wait a few seconds and try again."
        : err.message?.includes("Timeout") || err.message?.includes("timed out") || err.message?.includes("fetch failed")
        ? "The image service took too long to respond. Try again."
        : err.message?.includes("sendPhoto") || err.message?.includes("PHOTO")
        ? "The image was generated but couldn't be sent. Try again."
        : "Something went wrong while generating. Try a different prompt.";

    const text = `❌ <b>Generation failed</b>\n📝 <i>${escapeHtml(promptText)}</i>\n\n${reason}\n\n<i>Tip: try /imagine again in a few seconds.</i>`;

    let shown = false;
    if (waitMsg) {
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, text, { parse_mode: "HTML" });
        shown = true;
      } catch (_) {}
    }
    if (!shown) await ctx.reply(text, { parse_mode: "HTML" }).catch(() => {});
  } finally {
    if (statusTimer) clearInterval(statusTimer);
    inFlight.delete(userId);
  }
};