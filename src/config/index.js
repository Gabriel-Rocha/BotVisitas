'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { parseProxyList, FREE_PLAN_MAX } = require('../core/proxy');

const ENV_PATH = path.resolve(process.cwd(), '.env');

/** Vars injetadas pelo Docker Compose não devem ser sobrescritas pelo .env montado. */
const PRESERVE_ENV_KEYS = [
  'DASHBOARD_HOST',
  'DASHBOARD_PORT',
  'CHROME_EXECUTABLE_PATH',
  'NODE_ENV',
  'DATABASE_URL',
];

/**
 * Relê o .env com override (p/ STRATEGY, TARGET_URLS, etc.).
 * Mantém chaves já definidas pelo Compose (ex.: DASHBOARD_HOST=0.0.0.0).
 */
function reloadEnv() {
  const preserved = {};
  for (const key of PRESERVE_ENV_KEYS) {
    if (process.env[key] !== undefined && process.env[key] !== '') {
      preserved[key] = process.env[key];
    }
  }
  // Lê o arquivo de forma explícita — evita valor antigo preso em process.env
  // quando o Compose injetou env_file e o .env no disco já mudou.
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
  reloadEnv();

  const userAgents = loadJson('user-agents.json');
  const referrers = loadJson('referrers.json');
  const deviceProfiles = loadJson('device-profiles.json');

  const config = {
    strategy: (process.env.STRATEGY || 'dryRun').trim(),
    headless: bool(process.env.HEADLESS, true),
    chromeExecutablePath: (process.env.CHROME_EXECUTABLE_PATH || '').trim() || null,

    navigationTimeoutMs: int(process.env.NAVIGATION_TIMEOUT_MS, 60_000),
    defaultTimeoutMs: int(process.env.DEFAULT_TIMEOUT_MS, 30_000),

    intervalMinSec: int(process.env.INTERVAL_MIN_SEC, 60),
    intervalMaxSec: int(process.env.INTERVAL_MAX_SEC, 900),
    browserRestartEvery: int(process.env.BROWSER_RESTART_EVERY, 20),
    concurrency: int(process.env.CONCURRENCY, 5),

    // vazio = todos desktop via CONCURRENCY | ex.: desktop:2,mobile:3,tablet:1
    deviceMix: (process.env.DEVICE_MIX || '').trim(),
    deviceProfiles,

    viewport: {
      width: int(process.env.VIEWPORT_WIDTH, 1920),
      height: int(process.env.VIEWPORT_HEIGHT, 1080),
    },

    targetUrls: parseUrls(process.env.TARGET_URLS),
    maxClicksPerPage: int(process.env.MAX_CLICKS_PER_PAGE, 15),
    browsePagesMin: int(process.env.BROWSE_PAGES_MIN, 1),
    browsePagesMax: int(process.env.BROWSE_PAGES_MAX, 3),
    includeReferrer: bool(process.env.INCLUDE_REFERRER, true),
    clickSelector: (process.env.CLICK_SELECTOR || '').trim() || null,

    proxy: {
      enabled: bool(process.env.PROXY_ENABLED, false),
      list: parseProxyList(process.env.PROXY_LIST || ''),
      server: (process.env.PROXY_SERVER || '').trim() || null,
      maxProxies: Math.min(int(process.env.PROXY_MAX, FREE_PLAN_MAX), FREE_PLAN_MAX),
      rotate: (process.env.PROXY_ROTATE || 'roundRobin').trim(),
      // true = recusa IPs marcados proxy/hosting (plano free Webshare quase todo falha)
      skipFlagged: bool(process.env.PROXY_SKIP_FLAGGED, false),
    },

    userAgents,
    referrers,

    // Ofuscação — visita deve parecer humana (ver docs/11-ofuscacao.md)
    stealth: {
      // Fallback quando STEALTH_GEO_TZ=false ou lookup falhar
      timezoneId: (process.env.STEALTH_TIMEZONE || 'America/Sao_Paulo').trim(),
      locale: (process.env.STEALTH_LOCALE || 'pt-BR').trim(),
      // true = timezone/locale pela região do IP (proxy.host ou egress)
      geoTz: bool(process.env.STEALTH_GEO_TZ, true),
    },

    logLevel: (process.env.LOG_LEVEL || 'info').trim(),
  };

  if (config.intervalMinSec > config.intervalMaxSec) {
    throw new Error('INTERVAL_MIN_SEC não pode ser maior que INTERVAL_MAX_SEC');
  }
  if (config.browsePagesMin > config.browsePagesMax) {
    throw new Error('BROWSE_PAGES_MIN não pode ser maior que BROWSE_PAGES_MAX');
  }

  return config;
}

module.exports = { loadConfig, reloadEnv, parseUrls, ENV_PATH };
