const db = require('../services/database');
const User = require('../models/User');
const logger = require('../utils/logger');
const weatherCtx = require('../services/weatherContext');
const { weatherKeyboard } = require('../utils/keyboards');

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

async function getCoords(city) {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
  );
  if (!res.ok) throw new Error('Geocoding failed');
  const data = await res.json();
  if (!data.results?.length) return null;
  return data.results[0];
}

function formatCurrent(c, name, country, admin1) {
  const location = admin1 ? `${name}, ${admin1}` : name;
  const cond = WEATHER_CODES[c.weather_code] || `❓ Code ${c.weather_code}`;
  return `🌤️ <b>${location}, ${country}</b>\n\n` +
    `${cond}\n` +
    `🌡️ <b>${c.temperature_2m}°C</b> (feels like ${c.apparent_temperature}°C)\n` +
    `💧 Humidity: ${c.relative_humidity_2m}%\n` +
    `💨 Wind: ${c.wind_speed_10m} km/h`;
}

function formatWeek(daily, name, country, admin1) {
  const location = admin1 ? `${name}, ${admin1}` : name;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let text = `📅 <b>7-Day Forecast — ${location}, ${country}</b>\n\n`;
  for (let i = 0; i < daily.time.length; i++) {
    const d = new Date(daily.time[i] + 'T12:00:00');
    const day = dayNames[d.getDay()];
    const cond = WEATHER_CODES[daily.weather_code[i]] || `❓ ${daily.weather_code[i]}`;
    const hi = daily.temperature_2m_max[i];
    const lo = daily.temperature_2m_min[i];
    text += `<b>${day}</b> ${cond}  🌡️ ${lo}–${hi}°C\n`;
  }
  return text;
}

module.exports = async (ctx) => {
  const userId = ctx.from.id;
  let city = ctx.message.text.replace(/^\/weather\s*/i, '').trim();

  if (!city && db.isConnected()) {
    try {
      const user = await User.findOne({ telegramId: userId });
      if (user?.defaultCity) city = user.defaultCity;
    } catch {}
  }

  if (!city) {
    return ctx.replyWithHTML(
      '🌤️ <b>Weather</b>\n\n<code>/weather London</code>\n<code>/weather Tokyo</code>\n\nYour default city will be saved automatically!'
    );
  }

  const waitMsg = await ctx.reply(`🌤️ Checking weather for ${city}...`);

  try {
    const geo = await getCoords(city);
    if (!geo) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      return ctx.reply(`❌ City "${city}" not found.`);
    }

    const { name, country, latitude, longitude, admin1 } = geo;

    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=7&timezone=auto`
    );
    if (!weatherRes.ok) throw new Error('Weather API failed');
    const weatherData = await weatherRes.json();

    const todayText = formatCurrent(weatherData.current, name, country, admin1);

    if (db.isConnected()) {
      try {
        await User.updateOne(
          { telegramId: userId },
          { $set: { defaultCity: name } },
          { upsert: true }
        );
      } catch {}
    }

    weatherCtx.set(userId, { weatherData, name, country, admin1 });

    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    await ctx.replyWithHTML(todayText, weatherKeyboard());

    logger.info('Weather fetched', { city: name, country, temp: weatherData.current.temperature_2m });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    logger.error('Weather error', { city, error: err.message });
    await ctx.reply('❌ Failed to fetch weather. Try a different city name.');
  }
};
