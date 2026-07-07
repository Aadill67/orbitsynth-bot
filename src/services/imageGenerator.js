const config = require("../../config");
const logger = require("../utils/logger");

// async function generateImageWithFlux(prompt) {
//   if (!config.fal.apiKey) {
//     throw new Error('FAL_KEY not configured. Get one at https://fal.ai/dashboard');
//   }
////////
async function generateImageWithFlux(prompt) {
  console.log("FAL_KEY loaded:", !!config.fal.apiKey); // ← add this

  if (!config.fal.apiKey) {
    throw new Error(
      "FAL_KEY not configured. Get one at https://fal.ai/dashboard",
    );
  }
  ////////////

  const { fal } = require("@fal-ai/client");
  fal.config({ credentials: config.fal.apiKey });

  logger.info("Generating image with Fal.ai", { prompt: prompt.slice(0, 60) });

  const result = await fal.run("fal-ai/flux/schnell", {
    input: {
      prompt: prompt,
      image_size: "landscape_4_3",
      num_images: 1,
    },
  });

  const imageUrl = result.data?.images?.[0]?.url;
  if (!imageUrl) throw new Error("No image URL in Fal.ai response");

  const response = await fetch(imageUrl);
  if (!response.ok)
    throw new Error(`Failed to download image: ${response.status}`);
  const buffer = await response.arrayBuffer();

  logger.info("Image generated successfully via Fal.ai");
  return Buffer.from(buffer);
}

module.exports = { generateImageWithFlux };
