const { Markup } = require('telegraf');

/* ── Main navigation menu ───────────────────────────────────────────── */
const mainMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('🤖 AI Chat',          'menu_chat'),
      Markup.button.callback('📊 My Stats',          'menu_stats'),
    ],
    [
      Markup.button.callback('🎨 Generate Image',   'menu_imagine'),
      Markup.button.callback('🖼️ Analyze Photo',    'menu_photo'),
    ],
    [
      Markup.button.callback('🌤️ Weather',          'menu_weather'),
      Markup.button.callback('💰 Crypto',            'menu_crypto'),
    ],
    [
      Markup.button.callback('🌐 Translate',        'menu_translate'),
      Markup.button.callback('🔍 Search',           'menu_search'),
    ],
    [
      Markup.button.callback('🎬 YouTube Summary',  'menu_youtube'),
      Markup.button.callback('⏰ Reminders',         'menu_remind'),
    ],
    [
      Markup.button.callback('⚙️ Settings',          'menu_settings'),
      Markup.button.callback('❓ Help',               'menu_help'),
    ],
    [
      Markup.button.callback('🗑️ Clear History',    'menu_clear'),
    ],
  ]);

/* ── AI personality selector ────────────────────────────────────────── */
const PERSONALITIES = [
  { id: 'default',  label: 'Default 🤖'  },
  { id: 'concise',  label: 'Concise ⚡'   },
  { id: 'detailed', label: 'Detailed 📚'  },
  { id: 'friendly', label: 'Friendly 😊'  },
];

const personalityKeyboard = (current = 'default') => {
  const rows = [];
  for (let i = 0; i < PERSONALITIES.length; i += 2) {
    rows.push(
      PERSONALITIES.slice(i, i + 2).map(opt =>
        Markup.button.callback(
          `${current === opt.id ? '✅ ' : ''}${opt.label}`,
          `set_personality_${opt.id}`
        )
      )
    );
  }
  rows.push([Markup.button.callback('◀️ Back to Menu', 'menu_back')]);
  return Markup.inlineKeyboard(rows);
};

/* ── Confirmation dialog ─────────────────────────────────────────────── */
const confirmClearKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Yes, clear it', 'confirm_clear'),
      Markup.button.callback('❌ Cancel',         'cancel_action'),
    ],
  ]);

/* ── Single back button ──────────────────────────────────────────────── */
const backKeyboard = () =>
  Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Menu', 'menu_back')]]);

/* ── Weather Today/Week toggle ───────────────────────────────────────── */
const weatherKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('☀️ Today', 'weather_today'),
      Markup.button.callback('📅 Week', 'weather_week'),
    ],
  ]);

/* ── Settings submenu ──────────────────────────────────────────────────── */
const settingsKeyboard = (currentTtl) => {
  const ttlLabel = currentTtl === 1800000 ? '30m'
    : currentTtl === 3600000 ? '1h'
    : currentTtl === 21600000 ? '6h'
    : currentTtl === 86400000 ? '24h' : '1h';
  return Markup.inlineKeyboard([
    [Markup.button.callback('🧠 AI Personality', 'menu_personality')],
    [Markup.button.callback(`⏱️ Session TTL (${ttlLabel})`, 'menu_ttl')],
    [Markup.button.callback('◀️ Back to Menu', 'menu_back')],
  ]);
};

const TTL_OPTIONS = [
  { ms: 1800000,  label: '30 min' },
  { ms: 3600000,  label: '1 hour' },
  { ms: 21600000, label: '6 hours' },
  { ms: 86400000, label: '24 hours' },
];

const ttlKeyboard = (current = 3600000) =>
  Markup.inlineKeyboard([
    ...TTL_OPTIONS.map(o => [
      Markup.button.callback(
        `${current === o.ms ? '✅ ' : ''}${o.label}`,
        `set_ttl_${o.ms}`
      ),
    ]),
    [Markup.button.callback('◀️ Back to Settings', 'menu_settings')],
  ]);

module.exports = {
  mainMenuKeyboard,
  personalityKeyboard,
  confirmClearKeyboard,
  backKeyboard,
  weatherKeyboard,
  settingsKeyboard,
  ttlKeyboard,
};
