const logger = require('../utils/logger');

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function getTranscript(videoId) {
  const res = await fetch(`https://youtubetranscript.com/?v=${videoId}`);
  if (!res.ok) throw new Error(`Transcript fetch failed: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('No transcript available');
  return data.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim();
}

async function getVideoInfo(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrbitSynthBot/2.0)' },
  });
  const html = await res.text();
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(' - YouTube', '') || 'Unknown';
  return { title };
}

module.exports = { extractVideoId, getTranscript, getVideoInfo };
