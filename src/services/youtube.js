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
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrbitSynthBot/2.0)' },
  });
  const html = await res.text();
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(' - YouTube', '') || 'Unknown';
  return { title };
}

async function getTranscript(videoId) {
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
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

  const transcriptRes = await fetch(trackUrl);
  if (!transcriptRes.ok) throw new Error(`Transcript fetch failed: ${transcriptRes.status}`);
  const xml = await transcriptRes.text();

  const texts = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let xmlMatch;
  while ((xmlMatch = regex.exec(xml)) !== null) {
    texts.push(xmlMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  }

  if (texts.length === 0) throw new Error('No transcript available');
  return texts.join(' ').replace(/\s+/g, ' ').trim();
}

module.exports = { extractVideoId, getTranscript, getVideoInfo };
