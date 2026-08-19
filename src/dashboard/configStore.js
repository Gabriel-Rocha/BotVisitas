'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_PATH = path.resolve(process.cwd(), '.env');

const EDITABLE_KEYS = [
  'STRATEGY',
  'CONCURRENCY',
  'DEVICE_MIX',
  'INTERVAL_MIN_SEC',
  'INTERVAL_MAX_SEC',
  'BROWSER_RESTART_EVERY',
  'HEADLESS',
  'PROXY_ENABLED',
  'TARGET_URLS',
  'BROWSE_PAGES_MIN',
  'BROWSE_PAGES_MAX',
  'INCLUDE_REFERRER',
];

function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return '';
  return fs.readFileSync(ENV_PATH, 'utf8');
}

function parseEnvFileOnly() {
  if (!fs.existsSync(ENV_PATH)) return {};
  return dotenv.parse(fs.readFileSync(ENV_PATH, 'utf8'));
}

function getSafeConfig() {
  // Fonte de verdade = arquivo montado (não process.env residual do Compose).
  const fileEnv = parseEnvFileOnly();
  dotenv.config({ path: ENV_PATH, override: true });

  const get = (key, fallback = '') =>
    fileEnv[key] !== undefined && fileEnv[key] !== ''
      ? fileEnv[key]
      : process.env[key] || fallback;

  const proxyList = get('PROXY_LIST', '');
  const proxyCount = proxyList
    ? proxyList.split(/[\n,]+/).filter((s) => s.trim()).length
    : 0;

  return {
    STRATEGY: get('STRATEGY', 'dryRun'),
    CONCURRENCY: get('CONCURRENCY', '5'),
    DEVICE_MIX: get('DEVICE_MIX', ''),
    INTERVAL_MIN_SEC: get('INTERVAL_MIN_SEC', '60'),
    INTERVAL_MAX_SEC: get('INTERVAL_MAX_SEC', '900'),
    BROWSER_RESTART_EVERY: get('BROWSER_RESTART_EVERY', '20'),
    HEADLESS: get('HEADLESS', 'true'),
    PROXY_ENABLED: get('PROXY_ENABLED', 'false'),
    TARGET_URLS: get('TARGET_URLS', ''),
    BROWSE_PAGES_MIN: get('BROWSE_PAGES_MIN', '1'),
    BROWSE_PAGES_MAX: get('BROWSE_PAGES_MAX', '3'),
    INCLUDE_REFERRER: get('INCLUDE_REFERRER', 'true'),
    PROXY_LIST_MASKED: proxyCount
      ? `${proxyCount} proxies configurados (ocultos)`
      : '(vazio)',
    PROXY_SERVER_SET: Boolean(get('PROXY_SERVER', '').trim()),
  };
}

function upsertEnvKey(content, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) {
    return content.replace(re, line);
  }
  const trimmed = content.replace(/\s*$/, '');
  return `${trimmed}\n${line}\n`;
}

function updateSafeConfig(patch) {
  if (!patch || typeof patch !== 'object') {
    throw new Error('Body inválido');
  }

  let content = readEnvFile();
  if (!content) {
    content = '# Gerado pelo dashboard\n';
  }

  const applied = {};
  for (const key of EDITABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      const raw = patch[key];
      const value = raw === null || raw === undefined ? '' : String(raw);
      content = upsertEnvKey(content, key, value);
      applied[key] = value;
      process.env[key] = value;
    }
  }

  fs.writeFileSync(ENV_PATH, content, 'utf8');
  dotenv.config({ path: ENV_PATH, override: true });

  return { applied, config: getSafeConfig() };
}

module.exports = {
  EDITABLE_KEYS,
  getSafeConfig,
  updateSafeConfig,
  ENV_PATH,
};
