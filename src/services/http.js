/**
 * fetch() wrapper with an AbortController timeout.
 * Aborts and re-throws a `TimeoutError` if the request takes too long,
 * so no handler ever hangs forever.
 */
class TimeoutError extends Error {
  constructor(url, ms) {
    super(`Request timed out after ${ms}ms: ${url}`);
    this.name = 'TimeoutError';
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new TimeoutError(url, timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Sleep helper used across services for retry backoff. */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const dns = require('dns').promises;

/** IP ranges that are never safe to fetch from a server (RFC 1918 / special). */
const BLOCKED_NETS = [
  '127.0.0.0/8',    // loopback
  '10.0.0.0/8',     // private
  '172.16.0.0/12',  // private
  '192.168.0.0/16', // private
  '169.254.0.0/16', // link-local (cloud metadata)
  '::1/128',        // IPv6 loopback
  'fc00::/7',       // IPv6 unique local
  'fe80::/10',      // IPv6 link-local
  '0.0.0.0/8',      // "this" network
  '100.64.0.0/10',  // carrier-grade NAT
];

function ipToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return parts.reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0;
}

function ipv6InCidr(ip, cidr, bits) {
  const group = BigInt('0x' + ip.split(':').map(g => g || '0').join('').padStart(32, '0'));
  const shift = BigInt(128 - bits);
  const cidrBig = BigInt('0x' + cidr.split(':').map(g => g || '0').join('').padStart(32, '0'));
  return (group >> shift) === (cidrBig >> shift);
}

function isPrivateIp(ip) {
  if (ip.includes(':')) {
    for (const cidr of BLOCKED_NETS) {
      if (!cidr.includes('/')) continue;
      const [net, bits] = cidr.split('/');
      if (net.includes(':') && ipv6InCidr(ip, net, Number(bits))) return true;
    }
    return false;
  }
  const int = ipToInt(ip);
  if (int === null) return false;
  for (const cidr of BLOCKED_NETS) {
    if (cidr.includes(':')) continue;
    const [net, masks] = cidr.split('/');
    const maskInt = (0xffffffff << (32 - Number(masks))) >>> 0;
    const netInt = ipToInt(net);
    if ((int & maskInt) === (netInt & maskInt)) return true;
  }
  return false;
}

/**
 * SSRF guard: resolves the host and refuses private/link-local/cloud-metadata
 * addresses. Use before fetching any user-supplied URL server-side.
 * Throws a plain Error (not reaching out) when the target is unsafe.
 */
async function assertSafeUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed');
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new Error('Domain could not be resolved');
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error('This URL points to a private/internal address and is not allowed');
    }
  }
  return u;
}

module.exports = { fetchWithTimeout, sleep, TimeoutError, assertSafeUrl, isPrivateIp };
