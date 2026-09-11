const { fetchWithTimeout } = require('./http');
const { YoutubeTranscript } = require('youtube-transcript');

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

async function getVideoInfo(videoId) {
  // Primary: YouTube's own oEmbed API (fast, free, no key, stable).
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
      {}, 8000
    );
    if (res.ok) {
      const data = await res.json();
      if (data?.title) return { title: data.title };
    }
  } catch (_) {}

  // Fallback: scrape the watch page title.
  try {
    const res = await fetchWithTimeout(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrbitSynthBot/2.0)' },
    }, 8000);
    if (res.ok) {
      const html = await res.text();
      const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(' - YouTube', '') || 'Unknown';
      if (title !== 'Unknown') return { title };
    }
  } catch (_) {}

  return { title: 'Unknown' };
}

/**
 * Get the transcript for a video.
 * Primary: scrape `captionTracks` from the watch page.
 * Fallback: the `youtube-transcript` package (its own endpoint).
 */
async function getTranscript(videoId) {
  try {
    return await scrapeTranscript(videoId);
  } catch (err) {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    if (!segments?.length) throw new Error('No transcript available');
    return segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
  }
}

async function scrapeTranscript(videoId) {
  const pageRes = await fetchWithTimeout(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  }, 15000);
  const html = await pageRes.text();

  const match = html.match(/"captionTracks":\s*(\[.*?\])/);
  if (!match) throw new Error('No caption tracks found');

  const tracks = JSON.parse(match[1]);
  let trackUrl = null;

  for (const t of tracks) {
    if (t.languageCode === 'en' || t.languageCode === 'en-US' || t.languageCode === 'en-GB') {
      trackUrl = t.baseUrl;
      break;
    }
  }
  if (!trackUrl && tracks.length > 0) {
    trackUrl = tracks[0].baseUrl;
  }
  if (!trackUrl) throw new Error('No transcript available');

  const transcriptRes = await fetchWithTimeout(trackUrl, {}, 15000);
  if (!transcriptRes.ok) throw new Error(`Transcript fetch failed: ${transcriptRes.status}`);
  const xml = await transcriptRes.text();

  const texts = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let xmlMatch;
  while ((xmlMatch = regex.exec(xml)) !== null) {
    texts.push(xmlMatch[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  }

  if (texts.length === 0) throw new Error('No transcript available');
  return texts.join(' ').replace(/\s+/g, ' ').trim();
}

module.exports = { extractVideoId, getTranscript, getVideoInfo };
