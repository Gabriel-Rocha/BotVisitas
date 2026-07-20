'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_PATH = path.resolve(process.cwd(), '.env');

const EDITABLE_KEYS = [
  'STRATEGY',
  'CONCURRENCY',
  'INTERVAL_MIN_SEC',
  'INTERVAL_MAX_SEC',
  'BROWSER_RESTART_EVERY',
  'HEADLESS',
  'PROXY_ENABLED',
  'TARGET_URLS',
  'CLICK_SELECTOR',
  'INCLUDE_REFERRER',
];

function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return '';
  return fs.readFileSync(ENV_PATH, 'utf8');
}

function getSafeConfig() {
  dotenv.config({ path: ENV_PATH, override: true });

  const proxyList = process.env.PROXY_LIST || '';
  const proxyCount = proxyList
    ? proxyList.split(/[\n,]+/).filter((s) => s.trim()).length
    : 0;

  return {
    STRATEGY: process.env.STRATEGY || 'dryRun',
    CONCURRENCY: process.env.CONCURRENCY || '5',
    INTERVAL_MIN_SEC: process.env.INTERVAL_MIN_SEC || '60',
    INTERVAL_MAX_SEC: process.env.INTERVAL_MAX_SEC || '900',
    BROWSER_RESTART_EVERY: process.env.BROWSER_RESTART_EVERY || '20',
    HEADLESS: process.env.HEADLESS || 'true',
    PROXY_ENABLED: process.env.PROXY_ENABLED || 'false',
    TARGET_URLS: process.env.TARGET_URLS || '',
    CLICK_SELECTOR: process.env.CLICK_SELECTOR || '',
    INCLUDE_REFERRER: process.env.INCLUDE_REFERRER || 'true',
    PROXY_LIST_MASKED: proxyCount
      ? `${proxyCount} proxies configurados (ocultos)`
      : '(vazio)',
    PROXY_SERVER_SET: Boolean((process.env.PROXY_SERVER || '').trim()),
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
