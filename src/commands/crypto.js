const logger = require('../utils/logger');

const COMMON = { btc: 'bitcoin', eth: 'ethereum', sol: 'solana', xrp: 'ripple', ada: 'cardano', doge: 'dogecoin', dot: 'polkadot', avax: 'avalanche-2', matic: 'matic-network', link: 'chainlink' };

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
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`);
    if (!res.ok) throw new Error(`CoinGecko returned ${res.status}`);
    const data = await res.json();
    const coin = data[coinId];
    if (!coin) throw new Error(`Coin "${symbol}" not found`);

    const change = coin.usd_24h_change;
    const changeEmoji = change > 0 ? '📈' : change < 0 ? '📉' : '➖';
    const changeStr = change ? `${changeEmoji} ${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '';

    const cap = coin.usd_market_cap ? `💰 Market Cap: $${(coin.usd_market_cap / 1e9).toFixed(2)}B` : '';

    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    await ctx.replyWithHTML(
      `💰 <b>${symbol.toUpperCase()}</b>\n\n` +
      `💵 $${coin.usd.toLocaleString()}\n` +
      `${changeStr}\n${cap}`
    );

    logger.info('Crypto price fetched', { symbol, price: coin.usd });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    logger.error('Crypto error', { symbol, error: err.message });
    await ctx.reply(`❌ Could not fetch ${symbol.toUpperCase()}. Try a different name.\nExample: <code>/crypto bitcoin</code>`);
  }
};
