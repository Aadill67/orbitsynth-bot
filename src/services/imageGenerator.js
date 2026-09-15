const logger = require("../utils/logger");
const { fetchWithTimeout, sleep } = require("./http");
const config = require("../../config");

const ATTEMPT_TIMEOUT_MS = 60_000;

// Gemini image models (same API key as chat). nano-banana-pro-preview is free
// on Google Pro plans and produces the best results.
const GEMINI_IMAGE_MODELS = [
  'nano-banana-pro-preview',
  'gemini-3.1-flash-lite-image',
  'gemini-3.1-flash-image',
];

/**
 * Try Gemini native image generation. Returns a Buffer on success, null on
 * failure (caller falls back to Pollinations URL approach).
 */
async function generateImageWithGemini(prompt) {
  if (!config.ai.apiKey) return null;

  for (const model of GEMINI_IMAGE_MODELS) {
    try {
      logger.info("Trying Gemini image generation", { model, prompt: prompt.slice(0, 60) });

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.ai.apiKey}`;
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Generate an image: ${prompt}` }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      }, ATTEMPT_TIMEOUT_MS);

      if (!response.ok) {
        const status = response.status;
        if (status === 429 || status === 404) {
          logger.warn("Gemini image model unavailable", { model, status });
          continue;
        }
        throw new Error(`Gemini image API returned ${status}`);
      }

      const data = await response.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find(p => p.inlineData);
      if (!imagePart || !imagePart.inlineData?.data) {
        logger.warn("Gemini image model returned text only", { model });
        continue;
      }

      const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
      if (buffer.byteLength < 500) continue;

      logger.info("Image generated via Gemini", { model, size: buffer.byteLength });
      return { buffer };
    } catch (err) {
      logger.warn("Gemini image generation failed", { model, error: err.message });
      continue;
    }
  }
  return null;
}

/**
 * Build a Pollinations URL for the given prompt. Instead of downloading the
 * image and re-uploading to Telegram (which causes "socket hang up" on
 * Render's free tier), we return the URL so Telegram downloads it directly.
 *
 * We still do a quick HEAD/lightweight check to make sure the URL is live
 * before handing it off.
 */
async function generatePollinationsUrl(prompt) {
  const enhanced = `high quality, detailed, 4k, professional, ${prompt}`;
  const seed = Math.floor(Math.random() * 1000000);
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(enhanced)}` +
    `?width=1024&height=768&nologo=true&seed=${seed}&model=flux-realism`;

  logger.info("Generating image URL via Pollinations", { prompt: prompt.slice(0, 60) });

  // Quick check that Pollinations will serve this URL (follows redirects,
  // reads just enough to confirm it's an image). If it 402s/blocks us, we
  // surface the error immediately instead of sending a dead URL to Telegram.
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrbitSynthBot/2.0)' },
      }, ATTEMPT_TIMEOUT_MS);

      if (!response.ok) throw new Error(`Pollinations returned ${response.status}`);

      // Consume the body so the connection is properly closed, but we don't
      // need the buffer — Telegram will re-fetch the URL itself.
      await response.arrayBuffer();

      logger.info("Pollinations URL verified", { attempt });
      return { url };
    } catch (err) {
      lastErr = err;
      if (err.message?.includes('402') || err.message?.includes('429')) break;
      if (attempt < 2) {
        logger.warn("Pollinations check failed, retrying", { attempt, error: err.message });
        await sleep(2000);
      }
    }
  }

  throw lastErr;
}

/**
 * Main entry point. Returns either { url } (Telegram fetches directly) or
 * { buffer } (uploaded from the bot). The URL approach avoids the "socket
 * hang up" problem on Render's free tier.
 */
async function generateImageWithFlux(prompt) {
  // Try Gemini first (keyed API, works from cloud IPs)
  const gemini = await generateImageWithGemini(prompt);
  if (gemini) return gemini;

  // Fall back to Pollinations (return URL, not buffer)
  return generatePollinationsUrl(prompt);
}

module.exports = { generateImageWithFlux };