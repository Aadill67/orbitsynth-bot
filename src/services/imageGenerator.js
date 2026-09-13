const logger = require("../utils/logger");
const { fetchWithTimeout, sleep } = require("./http");

const CONTENT_TYPES_OK = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Cheap magic-byte check so an HTML/JSON error page can never be sent as a photo. */
function looksLikeImage(buffer) {
  const hex = buffer.subarray(0, 12).toString('hex');
  return (
    hex.startsWith('ffd8ff') ||                       // JPEG
    hex.startsWith('89504e47') ||                     // PNG
    (hex.startsWith('52494646') && hex.includes('57454250')) || // WEBP
    (hex.startsWith('47494638'))                      // GIF
  );
}

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
      if (!CONTENT_TYPES_OK.has(contentType.split(';')[0].trim())) {
        throw new Error(`Pollinations returned non-image content (${contentType})`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength < 1000) throw new Error('Pollinations returned an empty image');
      if (!looksLikeImage(buffer)) {
        throw new Error(`Pollinations returned an invalid image file (${buffer.byteLength}b)`);
      }

      logger.info("Image generated successfully via Pollinations", { attempt });
      return buffer;
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