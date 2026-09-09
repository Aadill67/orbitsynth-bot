/**
 * Keyless web search with automatic provider fallback.
 * Order: DuckDuckGo Lite → DuckDuckGo HTML → Bing → Wikipedia.
 * If a provider dies or changes markup, the next one takes over,
 * so /search keeps working with zero API keys.
 */
const { fetchWithTimeout } = require('./http');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'en-US,en;q=0.9',
};

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/* ── DuckDuckGo Lite (simplest, most stable DDG page) ─────────────────── */
async function ddgLite(query, limit) {
  const res = await fetchWithTimeout(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    { headers: HEADERS }, 10000
  );
  if (!res.ok) throw new Error(`DDG Lite ${res.status}`);
  const html = await res.text();

  const results = [];
  const linkRe = /<a rel="nofollow" href="([^"]+)"[^>]*>(.*?)<\/a>/g;
  const snippets = [...html.matchAll(/<td class='result-snippet'>(.*?)<\/td>/gs)].map(m => stripTags(m[1]));

  let m;
  let i = 0;
  while ((m = linkRe.exec(html)) !== null && results.length < limit) {
    const url = m[1].trim();
    if (!url.startsWith('http')) continue;
    results.push({ url, title: stripTags(m[2]), snippet: snippets[i++] || '' });
  }
  return results;
}

/* ── DuckDuckGo HTML ──────────────────────────────────────────────────── */
async function ddgHtml(query, limit) {
  const res = await fetchWithTimeout(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { headers: HEADERS }, 10000
  );
  if (!res.ok) throw new Error(`DDG HTML ${res.status}`);
  const html = await res.text();

  const results = [];
  const re = /<a rel="nofollow" class="result__a" href="([^"]+)".*?>(.*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>(.*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null && results.length < limit) {
    const url = decodeURIComponent(
      m[1].replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, '').replace(/&rut=.*$/, '')
    );
    results.push({ url, title: stripTags(m[2]), snippet: stripTags(m[3]) });
  }
  return results;
}

/* ── Bing (very tolerant of bot UAs) ──────────────────────────────────── */
async function bing(query, limit) {
  const res = await fetchWithTimeout(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`,
    { headers: HEADERS }, 10000
  );
  if (!res.ok) throw new Error(`Bing ${res.status}`);
  const html = await res.text();

  const results = [];
  const re = /<li class="b_algo".*?<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a><\/h2>[\s\S]*?(?:<p[^>]*>(.*?)<\/p>)?/g;
  let m;
  while ((m = re.exec(html)) !== null && results.length < limit) {
    const url = m[1];
    if (!url.startsWith('http')) continue;
    results.push({ url, title: stripTags(m[2]), snippet: stripTags(m[3] || '') });
  }
  return results;
}

/* ── Wikipedia search API (official, free, always up) ─────────────────── */
async function wikipedia(query, limit) {
  const res = await fetchWithTimeout(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
    `&prop=snippet&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}`,
    { headers: HEADERS }, 10000
  );
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
  const data = await res.json();

  return (data?.query?.search || []).map(r => ({
    url:     `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    title:   r.title,
    snippet: stripTags(r.snippet),
  }));
}

const PROVIDERS = [ddgLite, ddgHtml, bing, wikipedia];

async function searchWeb(query, limit = 3) {
  const failures = [];
  for (const provider of PROVIDERS) {
    try {
      const results = await provider(query, limit);
      if (results.length > 0) return results;
    } catch (err) {
      failures.push(`${provider.name}: ${err.message}`);
    }
  }
  const err = new Error('All search providers failed');
  err.failures = failures;
  throw err;
}

module.exports = { searchWeb };
