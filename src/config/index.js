'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function loadJson(relativePath) {
  const full = path.join(__dirname, '..', 'data', relativePath);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function parseUrls(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadConfig() {
  const userAgents = loadJson('user-agents.json');
  const referrers = loadJson('referrers.json');

  const config = {
    strategy: (process.env.STRATEGY || 'directLink').trim(),
    headless: bool(process.env.HEADLESS, true),
    chromeExecutablePath: (process.env.CHROME_EXECUTABLE_PATH || '').trim() || null,

    navigationTimeoutMs: int(process.env.NAVIGATION_TIMEOUT_MS, 60_000),
    defaultTimeoutMs: int(process.env.DEFAULT_TIMEOUT_MS, 30_000),

    intervalMinSec: int(process.env.INTERVAL_MIN_SEC, 0),
    intervalMaxSec: int(process.env.INTERVAL_MAX_SEC, 0),
    browserRestartEvery: int(process.env.BROWSER_RESTART_EVERY, 0),

    viewport: {
      width: int(process.env.VIEWPORT_WIDTH, 1920),
      height: int(process.env.VIEWPORT_HEIGHT, 1080),
    },

    targetUrls: parseUrls(process.env.TARGET_URLS),
    maxClicksPerPage: int(process.env.MAX_CLICKS_PER_PAGE, 0),
    includeReferrer: bool(process.env.INCLUDE_REFERRER, true),

    proxy: {
      enabled: bool(process.env.PROXY_ENABLED, false),
      server: (process.env.PROXY_SERVER || '').trim() || null,
    },

    userAgents,
    referrers,

    logLevel: (process.env.LOG_LEVEL || 'info').trim(),
  };

  if (config.intervalMinSec > config.intervalMaxSec) {
    throw new Error('INTERVAL_MIN_SEC não pode ser maior que INTERVAL_MAX_SEC');
  }

  return config;
}

module.exports = { loadConfig };
