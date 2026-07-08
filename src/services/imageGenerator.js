const logger = require("../utils/logger");

async function generateImageWithFlux(prompt) {
  logger.info("Generating image with Pollinations", {
    prompt: prompt.slice(0, 60),
  });

  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=768&nologo=true`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Pollinations returned ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  logger.info("Image generated successfully via Pollinations");
  return Buffer.from(buffer);
}

module.exports = { generateImageWithFlux };
