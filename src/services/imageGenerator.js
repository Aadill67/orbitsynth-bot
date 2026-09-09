const logger = require("../utils/logger");
const { fetchWithTimeout, sleep } = require("./http");

async function generateImageWithFlux(prompt) {
  logger.info("Generating image with Pollinations", {
    prompt: prompt.slice(0, 60),
  });

  const seed = Math.floor(Math.random() * 1000000);

  // Retry twice — Pollinations is free and occasionally returns 402/5xx.
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const url =
        `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
        `?width=1024&height=768&nologo=true&seed=${seed}`;

      const response = await fetchWithTimeout(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrbitSynthBot/2.0)' },
      }, 90_000);

      if (!response.ok) throw new Error(`Pollinations returned ${response.status}`);

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        throw new Error(`Pollinations returned non-image content (${contentType})`);
      }

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < 1000) throw new Error('Pollinations returned an empty image');

      logger.info("Image generated successfully via Pollinations", { attempt });
      return Buffer.from(buffer);
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        logger.warn("Pollinations attempt failed, retrying", { attempt, error: err.message });
        await sleep(2000 * attempt);
      }
    }
  }

  throw lastErr;
}

module.exports = { generateImageWithFlux };