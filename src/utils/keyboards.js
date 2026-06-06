const { Markup } = require('telegraf');

/* ── Main navigation menu ───────────────────────────────────────────── */
const mainMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('🤖 AI Chat',          'menu_chat'),
      Markup.button.callback('📊 My Stats',          'menu_stats'),
    ],
    [
      Markup.button.callback('🎨 Generate Image',   'menu_imagine'),  // NEW
      Markup.button.callback('🖼️ Analyze Photo',    'menu_photo'),    // NEW
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

module.exports = {
  mainMenuKeyboard,
  personalityKeyboard,
  confirmClearKeyboard,
  backKeyboard,
};
