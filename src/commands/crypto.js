const logger = require('../utils/logger');
const { fetchWithTimeout } = require('../services/http');

/* ── CoinGecko ids ──────────────────────────────────────────────────── */
const COMMON = { btc: 'bitcoin', eth: 'ethereum', sol: 'solana', xrp: 'ripple', ada: 'cardano', doge: 'dogecoin', dot: 'polkadot', avax: 'avalanche-2', matic: 'matic-network', link: 'chainlink' };

/* ── CoinCap ids ────────────────────────────────────────────────────── */
const COINCAP_IDS = { bitcoin: 'bitcoin', ethereum: 'ethereum', solana: 'solana', ripple: 'xrp', cardano: 'cardano', dogecoin: 'dogecoin', polkadot: 'polkadot', 'avalanche-2': 'avalanche', 'matic-network': 'matic-network', chainlink: 'chainlink' };

/* ── Binance pairs (only for majors) ────────────────────────────────── */
const BINANCE_PAIRS = { btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT', xrp: 'XRPUSDT', ada: 'ADAUSDT', doge: 'DOGEUSDT', dot: 'DOTUSDT' };

/* ── CoinPaprika ids (fallback — free, no key, works on Render) ───── */
const PAPRIKA_IDS = { bitcoin: 'btc-bitcoin', ethereum: 'eth-ethereum', solana: 'sol-solana', ripple: 'xrp-xrp', cardano: 'ada-cardano', dogecoin: 'doge-dogecoin', polkadot: 'dot-polkadot', 'avalanche-2': 'avax-avalanche', 'matic-network': 'matic-polygon', chainlink: 'link-chainlink' };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fromCoinGecko(coinId) {
  const res = await fetchWithTimeout(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
    {}, 12000
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json();
  const coin = data[coinId];
  if (!coin?.usd) throw new Error('Coin not found on CoinGecko');
  return {
    price: coin.usd,
    change: coin.usd_24h_change ?? null,
    marketCap: coin.usd_market_cap ?? null,
  };
}

async function fromCoinCap(coinId) {
  const id = COINCAP_IDS[coinId] ?? coinId;
  const res = await fetchWithTimeout(
    `https://api.coincap.io/v2/assets/${id}`,
    {}, 12000
  );
  if (!res.ok) throw new Error(`CoinCap ${res.status}`);
  const data = await res.json();
  const asset = data?.data;
  if (!asset) throw new Error('Coin not found on CoinCap');
  return {
    price: parseFloat(asset.priceUsd),
    change: asset.changePercent24Hr != null ? parseFloat(asset.changePercent24Hr) : null,
    marketCap: asset.marketCapUsd != null ? parseFloat(asset.marketCapUsd) : null,
  };
}

async function fromBinance(symbol) {
  const res = await fetchWithTimeout(
    `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`,
    {}, 12000
  );
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const data = await res.json();
  return {
    price: parseFloat(data.lastPrice),
    change: data.priceChangePercent != null ? parseFloat(data.priceChangePercent) : null,
    marketCap: null, // Binance public API has no market cap
  };
}

async function fromCoinPaprika(coinId) {
  const id = PAPRIKA_IDS[coinId] ?? coinId;
  const res = await fetchWithTimeout(
    `https://api.coinpaprika.com/v1/tickers/${id}`,
    {}, 12000
  );
  if (!res.ok) throw new Error(`CoinPaprika ${res.status}`);
  const data = await res.json();
  const usd = data?.quotes?.USD;
  if (!usd) throw new Error('Coin not found on CoinPaprika');
  return {
    price: usd.price,
    change: usd.percent_change_24h ?? null,
    marketCap: usd.market_cap ?? null,
  };
}

module.exports = async (ctx) => {
  const text = ctx.message.text.replace(/^\/(crypto|btc|eth|sol|xrp|ada|doge)\s*/i, '').trim();
  const cmd = ctx.message.text.split(' ')[0].toLowerCase().replace('/', '');

  let symbol = cmd === 'crypto' ? text : cmd;
  if (!symbol) {
    return ctx.replyWithHTML(
      '💰 <b>Crypto Prices</b>\n\n<code>/btc</code> <code>/eth</code> <code>/sol</code>\n<code>/crypto bitcoin</code>\n<code>/crypto ethereum</code>'
    );
  }

  const coinId = COMMON[symbol.toLowerCase()] || symbol.toLowerCase();
  const waitMsg = await ctx.reply(`💰 Fetching ${symbol.toUpperCase()} price...`);

  try {
    let result = null;
    const errors = [];

    // 1) Binance — fastest & most reliable for the big coins
    if (BINANCE_PAIRS[symbol.toLowerCase()]) {
      try { result = await fromBinance(BINANCE_PAIRS[symbol.toLowerCase()]); }
      catch (e) { errors.push(e.message); }
    }

    // 2) CoinGecko
    if (!result) {
      try { result = await fromCoinGecko(coinId); }
      catch (e) { errors.push(e.message); }
    }

    // 3) CoinCap
    if (!result) {
      try { result = await fromCoinCap(coinId); }
      catch (e) { errors.push(e.message); }
    }

    // 4) CoinPaprika — free, no API key, works on Render
    if (!result) {
      try { result = await fromCoinPaprika(coinId); }
      catch (e) { errors.push(e.message); }
    }

    if (!result) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      logger.warn('All crypto providers failed', { symbol, errors });
      return ctx.replyWithHTML(`❌ Could not fetch ${symbol.toUpperCase()}. Try a different name.\nExample: <code>/crypto bitcoin</code>`);
    }

    const change = result.change;
    const hasChange = change != null && !isNaN(change);
    // Treat values that round to zero as no-change so we never show "-0.00%".
    const effective = hasChange && Math.abs(change) < 0.005 ? 0 : change;
    const emoji = hasChange && effective > 0 ? '📈' : hasChange && effective < 0 ? '📉' : '➖';
    const changeStr = hasChange
      ? `${emoji} ${effective >= 0 ? '+' : ''}${effective.toFixed(2)}%`
      : '';

    const cap = result.marketCap ? `💰 Market Cap: $${(result.marketCap / 1e9).toFixed(2)}B` : '';

    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    await ctx.replyWithHTML(
      `💰 <b>${symbol.toUpperCase()}</b>\n\n` +
      `💵 $${result.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}\n` +
      `${changeStr}\n${cap}`
    );

    logger.info('Crypto price fetched', { symbol, price: result.price, errors: errors.length });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    logger.error('Crypto error', { symbol, error: err.message });
    await ctx.replyWithHTML(`❌ Could not fetch ${symbol.toUpperCase()}. Try a different name.\nExample: <code>/crypto bitcoin</code>`);
  }
};
