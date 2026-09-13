const logger = require("../utils/logger");
const { fetchWithTimeout, sleep } = require("./http");
const config = require("../../config");

const CONTENT_TYPES_OK = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Cap a single Pollinations call — cached requests return in ~1-3s,
 *  cold ones can legitimately take 35-60s. Never block the user longer. */
const ATTEMPT_TIMEOUT_MS = 60_000;

// Gemini image models to try (flash-lite is fastest, flash is higher quality).
// These use the same API key as chat — no extra cost/config needed.
const GEMINI_IMAGE_MODELS = [
  'gemini-3.1-flash-lite-image',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
];

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

/**
 * Generate an image using Gemini's native image generation capability.
 * Uses the same GEMINI_API_KEY as chat — no extra credentials needed,
 * and since it's a proper keyed API it works from Render/cloud IPs
 * (unlike Pollinations which blocks shared hosting IPs).
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
        const errText = await response.text().catch(() => '');
        const status = response.status;
        // 429 = quota; try next model. 404 = model gone; try next. Otherwise bail.
        if (status === 429 || status === 404) {
          logger.warn("Gemini image model unavailable", { model, status, error: errText.slice(0, 120) });
          continue;
        }
        throw new Error(`Gemini image API returned ${status}: ${errText.slice(0, 120)}`);
      }

      const data = await response.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find(p => p.inlineData);

      if (!imagePart) {
        logger.warn("Gemini image model returned text only", { model });
        continue;
      }

      const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
      if (buffer.byteLength < 500) {
        logger.warn("Gemini image too small", { model, size: buffer.byteLength });
        continue;
      }

      logger.info("Image generated via Gemini", { model, size: buffer.byteLength });
      return buffer;

    } catch (err) {
      logger.warn("Gemini image generation failed", { model, error: err.message });
      continue;
    }
  }

  return null; // All Gemini models exhausted — caller should try Pollinations
}

/**
 * Generate an image using the free Pollinations API.
 * Works well from local machines / residential IPs, but Render's shared
 * cloud IPs often get rate-limited (402) or blocked.
 */
async function generateImageWithPollinations(prompt) {
  logger.info("Generating image with Pollinations", {
    prompt: prompt.slice(0, 60),
  });

  const seed = Math.floor(Math.random() * 1000000);

  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const url =
        `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
        `?width=1024&height=768&nologo=true&seed=${seed}`;

      const response = await fetchWithTimeout(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrbitSynthBot/2.0)' },
      }, ATTEMPT_TIMEOUT_MS);

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
      // 402/429 are rate limits — retrying immediately won't help, surface now.
      if (err.message?.includes('402') || err.message?.includes('429')) break;
      if (attempt < 3) {
        logger.warn("Pollinations attempt failed, retrying", { attempt, error: err.message });
        await sleep(1500 * attempt);
      }
    }
  }

  throw lastErr;
}

/**
 * Main entry point: tries Gemini image generation first (works from cloud IPs),
 * then falls back to Pollinations (free, fast, but blocked on shared hosting).
 */
async function generateImageWithFlux(prompt) {
  // Try Gemini first — it's keyed so it works from Render/cloud IPs
  const geminiResult = await generateImageWithGemini(prompt);
  if (geminiResult) return geminiResult;

  // Fall back to Pollinations
  return generateImageWithPollinations(prompt);
}

module.exports = { generateImageWithFlux };