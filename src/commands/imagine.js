// src/commands/imagine.js

const { generateImageWithFlux } = require("../services/imageGenerator");
const logger = require("../utils/logger");

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
      `🎨 Generating...\n📝 <i>${prompt}</i>\n\n⏳ ~5-10 seconds...`,
    );
    await ctx.sendChatAction("upload_photo");

    // 1. Call our new HuggingFace FLUX service
    const imageBuffer = await generateImageWithFlux(prompt);

    // 2. Delete the "Generating..." loading message
    if (waitMsg)
      await ctx.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});

    // 3. Send the actual image back to the user
    await ctx.replyWithPhoto(
      { source: imageBuffer, filename: "generated.jpg" },
      {
        parse_mode: "HTML",
        caption: `🎨 <b>Generated</b>\n📝 <i>${prompt}</i>`,
      },
    );

    logger.info("Image generated via FLUX", {
      userId,
      prompt: prompt.slice(0, 60),
    });
  } catch (err) {
    // Clean up loading message on failure
    if (waitMsg)
      await ctx.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});

    logger.error("Image generation error", { userId, error: err.message });
    const userMsg = err.message?.includes('FAL_KEY')
      ? '❌ Image generation is not configured. Admin needs to set FAL_KEY.'
      : err.message?.includes('401') || err.message?.includes('403')
        ? '❌ Invalid FAL_KEY or insufficient credits. Get a free key at fal.ai/dashboard'
        : err.message?.includes('429')
          ? '❌ Rate limited by image API. Wait a moment and try again.'
          : `❌ Image generation failed. Try a different prompt.`;
    await ctx.reply(userMsg);
  }
};
