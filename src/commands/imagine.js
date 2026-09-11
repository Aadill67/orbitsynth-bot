// src/commands/imagine.js

const { generateImageWithFlux } = require("../services/imageGenerator");
const logger = require("../utils/logger");
const { escapeHtml } = require("../utils/format");

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
    await ctx.sendChatAction("upload_photo");

    const imageBuffer = await generateImageWithFlux(prompt);

    if (waitMsg)
      await ctx.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});

    await ctx.replyWithPhoto(
      { source: imageBuffer, filename: "generated.jpg" },
      {
        parse_mode: "HTML",
        caption: `🎨 <b>Generated</b>\n📝 <i>${escapeHtml(prompt)}</i>`,
      },
    );

    logger.info("Image generated", {
      userId,
      prompt: prompt.slice(0, 60),
    });
  } catch (err) {
    if (waitMsg)
      await ctx.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});

    logger.error("Image generation error", { userId, error: err.message });

    const userMsg = err.message?.includes("402")
      ? "❌ Pollinations rate limit hit. Wait a moment and try again."
      : `❌ Image generation failed. Try a different prompt.`;
    await ctx.reply(userMsg);
  }
};
