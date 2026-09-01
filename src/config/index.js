'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { parseCountryList, FREE_PLAN_MAX } = require('../core/proxy');
const { parseWorkerSlots } = require('../core/devices');

const ENV_PATH = path.resolve(process.cwd(), '.env');

/** Vars injetadas pelo Docker Compose não devem ser sobrescritas pelo .env montado. */
const PRESERVE_ENV_KEYS = [
  'DASHBOARD_HOST',
  'DASHBOARD_PORT',
  'CHROME_EXECUTABLE_PATH',
  'NODE_ENV',
  'DATABASE_URL',
];

function reloadEnv() {
  const preserved = {};
  for (const key of PRESERVE_ENV_KEYS) {
    if (process.env[key] !== undefined && process.env[key] !== '') {
      preserved[key] = process.env[key];
    }
  }
  if (fs.existsSync(ENV_PATH)) {
    const parsed = dotenv.parse(fs.readFileSync(ENV_PATH, 'utf8'));
    Object.assign(process.env, parsed);
  } else {
    dotenv.config({ path: ENV_PATH, override: true });
  }
  Object.assign(process.env, preserved);
}

reloadEnv();

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function float(value, fallback) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function loadJson(relativePath) {
  const full = path.join(__dirname, '..', 'data', relativePath);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function loadConfig() {
  reloadEnv();

  const userAgents = loadJson('user-agents.json');
  const referrers = loadJson('referrers.json');
  const deviceProfiles = loadJson('device-profiles.json');

  const config = {
    strategy: (process.env.STRATEGY || 'dryRun').trim(),
    headless: bool(process.env.HEADLESS, true),
    chromeExecutablePath: (process.env.CHROME_EXECUTABLE_PATH || '').trim() || null,

    navigationTimeoutMs: int(process.env.NAVIGATION_TIMEOUT_MS, 30_000),
    defaultTimeoutMs: int(process.env.DEFAULT_TIMEOUT_MS, 30_000),

    intervalMinSec: int(process.env.INTERVAL_MIN_SEC, 5),
    intervalMaxSec: int(process.env.INTERVAL_MAX_SEC, 12),
    browserRestartEvery: int(process.env.BROWSER_RESTART_EVERY, 25),
    chromeProcessLimit: int(process.env.CHROME_PROCESS_LIMIT, 1),
    memoryWarnPct: float(process.env.MEMORY_WARN_PCT, 0.82),
    memoryCriticalPct: float(process.env.MEMORY_CRITICAL_PCT, 0.9),
    concurrency: int(process.env.CONCURRENCY, 5),

    deviceMix: (process.env.DEVICE_MIX || '').trim(),
    workerSlots: (process.env.WORKER_SLOTS || '').trim(),
    deviceProfiles,

    viewport: {
      width: int(process.env.VIEWPORT_WIDTH, 1920),
      height: int(process.env.VIEWPORT_HEIGHT, 1080),
    },

    // URLs vêm só do painel (runtime); não leia TARGET_URLS do .env
    targetUrls: [],
    maxClicksPerPage: int(process.env.MAX_CLICKS_PER_PAGE, 3),
    browsePagesMin: int(process.env.BROWSE_PAGES_MIN, 0),
    browsePagesMax: int(process.env.BROWSE_PAGES_MAX, 0),
    includeReferrer: bool(process.env.INCLUDE_REFERRER, true),
    clickSelector: (process.env.CLICK_SELECTOR || '').trim() || null,
    engageEnabled: bool(process.env.ENGAGE_ENABLED, true),
    engageClicksMin: int(process.env.ENGAGE_CLICKS_MIN, 1),
    engageClicksMax: int(process.env.ENGAGE_CLICKS_MAX, 3),
    engageMaxMs: int(process.env.ENGAGE_MAX_MS, 25_000),
    engageRequireUrlChange: bool(process.env.ENGAGE_REQUIRE_URL_CHANGE, false),
    clickMode: (process.env.CLICK_MODE || 'legacy').trim().toLowerCase(),

    visitMaxSec: int(process.env.VISIT_MAX_SEC, 60),

    // Tempo lendo a página antes/depois do clique (modo rápido = menos segundos)
    dwellMinSec: int(process.env.BROWSE_DWELL_MIN_SEC, 5),
    dwellMaxSec: int(process.env.BROWSE_DWELL_MAX_SEC, 9),
    dwellTailMinSec: int(process.env.BROWSE_DWELL_TAIL_MIN_SEC, 3),
    dwellTailMaxSec: int(process.env.BROWSE_DWELL_TAIL_MAX_SEC, 6),

    bandwidthSaver: (() => {
      const raw = (process.env.BANDWIDTH_SAVER || 'light').trim().toLowerCase();
      if (['off', 'false', '0'].includes(raw)) return 'off';
      if (['aggressive', 'max', 'high'].includes(raw)) return 'aggressive';
      return 'light';
    })(),

    tuxler: {
      enabled: bool(process.env.TUXLER_ENABLED, process.platform === 'win32'),
      exePath: (process.env.TUXLER_EXE || '').trim() || null,
      helperExePath: (process.env.TUXLER_HELPER_EXE || '').trim() || null,
      rotateTimeoutMs: int(process.env.TUXLER_ROTATE_TIMEOUT_MS, 15_000),
      rotateMode: (process.env.TUXLER_ROTATE_MODE || 'skip').trim().toLowerCase(),
      socksWaitMs: int(process.env.TUXLER_SOCKS_WAIT_MS, 20_000),
      socksHost: (process.env.TUXLER_SOCKS_HOST || '').trim() || null,
      socksPort: int(process.env.TUXLER_SOCKS_PORT, 0) || null,
      requireActive: bool(process.env.TUXLER_REQUIRE_ACTIVE, true),
      clickRelX: float(process.env.TUXLER_CLICK_X, 0.5),
      clickRelY: float(process.env.TUXLER_CLICK_Y, 0.68),
      activateRelX: float(process.env.TUXLER_ACTIVATE_X, 0.5),
      activateRelY: float(process.env.TUXLER_ACTIVATE_Y, 0.58),
    },

    // Países ISO-2 por worker (Tuxler rotação via WORKER_SLOTS / PROXY_COUNTRIES)
    workerCountries: (
      process.env.PROXY_COUNTRIES ||
      process.env.WORKER_COUNTRIES ||
      ''
    ).trim(),

    visitRetryOnDeadEnd: bool(process.env.VISIT_RETRY_ON_DEAD_END, true),

    userAgents,
    referrers,

    stealth: {
      timezoneId: (process.env.STEALTH_TIMEZONE || 'UTC').trim(),
      locale: (process.env.STEALTH_LOCALE || 'en-US').trim(),
      geoTz: bool(process.env.STEALTH_GEO_TZ, true),
    },

    logLevel: (process.env.LOG_LEVEL || 'info').trim(),
  };

  const slots = parseWorkerSlots(config.workerSlots);
  if (slots.length) {
    config.concurrency = Math.min(slots.length, FREE_PLAN_MAX);
    const fallback = parseCountryList(config.workerCountries);
    const geos = fallback.length ? fallback : ['au', 'de', 'us'];
    config.workerCountries = slots
      .map((slot, i) => slot.country || geos[i % geos.length])
      .join(',');
  }

  if (config.intervalMinSec > config.intervalMaxSec) {
    throw new Error('INTERVAL_MIN_SEC não pode ser maior que INTERVAL_MAX_SEC');
  }
  if (config.browsePagesMin > config.browsePagesMax) {
    throw new Error('BROWSE_PAGES_MIN não pode ser maior que BROWSE_PAGES_MAX');
  }

  return config;
}

module.exports = { loadConfig, reloadEnv, ENV_PATH };
