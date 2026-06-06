const { createLogger, format, transports } = require('winston');
const { combine, timestamp, colorize, printf, json, errors } = format;
const fs = require('fs');

// Ensure logs/ directory exists at startup
if (!fs.existsSync('logs')) fs.mkdirSync('logs', { recursive: true });

/* ── Console format (human-readable, colorized) ─────────────────────── */
const consoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  printf(({ level, message, timestamp: ts, ...meta }) => {
    const metaStr = Object.keys(meta).length > 0
      ? `  ${JSON.stringify(meta)}`
      : '';
    return `${ts} ${level}: ${message}${metaStr}`;
  })
);

/* ── File format (machine-readable JSON) ────────────────────────────── */
const fileFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    new transports.Console({ format: consoleFormat }),
    new transports.File({ filename: 'logs/error.log', level: 'error', format: fileFormat }),
    new transports.File({ filename: 'logs/app.log',   format: fileFormat }),
  ],
});

module.exports = logger;
