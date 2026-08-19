'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { parseProxyList } = require('../core/proxy');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function float(value, fallback) {
  const n = Number.parseFloat(value);
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
  const browserProfiles = loadJson('browser-profiles.json');

  const proxyServers = [
    ...parseProxyList(process.env.PROXY_SERVER),
    ...parseProxyList(process.env.PROXY_SERVERS),
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  const sessionDir = (process.env.SESSION_DIR || 'logs/browser-session').trim();

  const config = {
    strategy: (process.env.STRATEGY || 'directLink').trim(),
    headless: bool(process.env.HEADLESS, true),
    chromeExecutablePath: (process.env.CHROME_EXECUTABLE_PATH || '').trim() || null,
    chromeAutodetect: bool(process.env.CHROME_AUTODETECT, true),

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
      servers: proxyServers,
    },

    stealth: {
      enabled: bool(process.env.STEALTH, true),
      humanize: bool(process.env.HUMANIZE, true),
      locale: (process.env.STEALTH_LOCALE || 'pt-BR').trim(),
      timezone: (process.env.STEALTH_TIMEZONE || 'America/Sao_Paulo').trim(),
      gapMinMs: int(process.env.STEALTH_GAP_MIN_MS, 4000),
      gapMaxMs: int(process.env.STEALTH_GAP_MAX_MS, 22000),
      dwellMinMs: int(process.env.DWELL_MIN_MS, 900),
      dwellMaxMs: int(process.env.DWELL_MAX_MS, 4200),
      geo: {
        latitude: float(process.env.GEO_LAT, -23.5505),
        longitude: float(process.env.GEO_LON, -46.6333),
      },
    },

    session: {
      persist: bool(process.env.SESSION_PERSIST, true),
      dir: path.resolve(process.cwd(), sessionDir),
    },

    userAgents,
    referrers,
    browserProfiles,

    logLevel: (process.env.LOG_LEVEL || 'info').trim(),
  };

  if (config.intervalMinSec > config.intervalMaxSec) {
    throw new Error('INTERVAL_MIN_SEC não pode ser maior que INTERVAL_MAX_SEC');
  }
  if (config.stealth.gapMinMs > config.stealth.gapMaxMs) {
    throw new Error('STEALTH_GAP_MIN_MS não pode ser maior que STEALTH_GAP_MAX_MS');
  }
  if (config.stealth.dwellMinMs > config.stealth.dwellMaxMs) {
    throw new Error('DWELL_MIN_MS não pode ser maior que DWELL_MAX_MS');
  }

  return config;
}

module.exports = { loadConfig };
