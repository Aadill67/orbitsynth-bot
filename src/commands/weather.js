const logger = require('../utils/logger');

const WEATHER_CODES = {
  0: '☀️ Clear', 1: '🌤️ Mainly clear', 2: '⛅ Partly cloudy', 3: '☁️ Overcast',
  45: '🌫️ Foggy', 48: '🌫️ Depositing rime fog',
  51: '🌦️ Light drizzle', 53: '🌦️ Moderate drizzle', 55: '🌦️ Dense drizzle',
  61: '🌧️ Slight rain', 63: '🌧️ Moderate rain', 65: '🌧️ Heavy rain',
  71: '🌨️ Slight snow', 73: '🌨️ Moderate snow', 75: '🌨️ Heavy snow',
  77: '❄️ Snow grains',
  80: '🌦️ Slight rain showers', 81: '🌦️ Moderate rain showers', 82: '🌦️ Violent rain showers',
  85: '🌨️ Slight snow showers', 86: '🌨️ Heavy snow showers',
  95: '⛈️ Thunderstorm', 96: '⛈️ Thunderstorm with slight hail', 99: '⛈️ Thunderstorm with heavy hail',
};

module.exports = async (ctx) => {
  const city = ctx.message.text.replace(/^\/weather\s*/i, '').trim();
  if (!city) {
    return ctx.replyWithHTML(
      '🌤️ <b>Weather</b>\n\n<code>/weather London</code>\n<code>/weather Tokyo</code>\n<code>/weather New York</code>'
    );
  }

  const waitMsg = await ctx.reply(`🌤️ Checking weather for ${city}...`);

  try {
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
    if (!geoRes.ok) throw new Error('Geocoding failed');
    const geoData = await geoRes.json();
    if (!geoData.results?.length) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      return ctx.reply(`❌ City "${city}" not found.`);
    }

    const { name, country, latitude, longitude, admin1 } = geoData.results[0];

    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`
    );
    if (!weatherRes.ok) throw new Error('Weather API failed');
    const weatherData = await weatherRes.json();
    const c = weatherData.current;

    const condition = WEATHER_CODES[c.weather_code] || `❓ Code ${c.weather_code}`;
    const location = admin1 ? `${name}, ${admin1}` : name;

    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    await ctx.replyWithHTML(
      `🌤️ <b>${location}, ${country}</b>\n\n` +
      `${condition}\n` +
      `🌡️ <b>${c.temperature_2m}°C</b> (feels like ${c.apparent_temperature}°C)\n` +
      `💧 Humidity: ${c.relative_humidity_2m}%\n` +
      `💨 Wind: ${c.wind_speed_10m} km/h`
    );

    logger.info('Weather fetched', { city: name, country, temp: c.temperature_2m });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    logger.error('Weather error', { city, error: err.message });
    await ctx.reply('❌ Failed to fetch weather. Try a different city name.');
  }
};
