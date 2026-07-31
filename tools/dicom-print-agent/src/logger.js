// ═══════════════════════════════════════════════════════════════════════════════
// Ozzyl HMS — DICOM Print Agent: Logger
// ═══════════════════════════════════════════════════════════════════════════════

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { config } = require('./config');

// Ensure log directory exists
if (!fs.existsSync(config.logPath)) {
  fs.mkdirSync(config.logPath, { recursive: true });
}

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${message}${metaStr}`;
    })
  ),
  transports: [
    // Console output with colors
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] ${level}: ${message}`;
        })
      ),
    }),
    // Daily rotating log file
    new winston.transports.File({
      filename: path.join(config.logPath, 'agent.log'),
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 10,
    }),
    // Separate error log
    new winston.transports.File({
      filename: path.join(config.logPath, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

module.exports = logger;
