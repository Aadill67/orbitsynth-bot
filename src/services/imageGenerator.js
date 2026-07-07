// src/services/imageGenerator.js

const config = require('../../config');
const logger = require('../utils/logger');

const HF_URL =
  "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell";

async function generateImageWithFlux(prompt) {
  if (!config.hf.apiKey) {
    throw new Error('HF_API_KEY not configured. Add it to your Railway env vars.');
  }

  const response = await fetch(HF_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.hf.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: prompt }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HuggingFace API returned ${response.status}: ${body.slice(0, 100)}`);
  }

  const imageBuffer = await response.arrayBuffer();
  return Buffer.from(imageBuffer);
}

module.exports = { generateImageWithFlux };
