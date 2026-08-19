'use strict';

const fs = require('fs');
const path = require('path');
const { pick } = require('../utils/random');
const { parseProxyServer } = require('./proxy');

function sessionPaths(config) {
  const dir = config.session.dir;
  return {
    dir,
    identity: path.join(dir, 'identity.json'),
    cookies: path.join(dir, 'cookies.json'),
    chromeProfile: path.join(dir, 'chrome-profile'),
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseChromeVersion(browserVersion) {
  const m = String(browserVersion || '').match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
  if (!m) {
    return { major: '131', full: '131.0.0.0' };
  }
  return { major: m[1], full: `${m[1]}.${m[2]}.${m[3]}.${m[4]}` };
}

function buildUserAgent(profile, chrome) {
  const full = chrome.full;
  if (profile.uaPlatform === 'macOS') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${full} Safari/537.36`;
  }
  if (profile.uaPlatform === 'Linux') {
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${full} Safari/537.36`;
  }
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${full} Safari/537.36`;
}

function buildSecChUa(major) {
  return `"Not)A;Brand";v="99", "Google Chrome";v="${major}", "Chromium";v="${major}"`;
}

let proxyCursor = 0;

function pickProxy(config) {
  if (!config.proxy.enabled || !config.proxy.servers.length) return null;
  const list = config.proxy.servers;
  const raw = list[proxyCursor % list.length];
  proxyCursor += 1;
  return parseProxyServer(raw);
}

function applyLocaleOverrides(profile, config) {
  const language = config.stealth.locale || profile.language;
  const languages = profile.languages[0] === language
    ? profile.languages
    : [language, ...profile.languages.filter((l) => l !== language)];
  return {
    ...profile,
    language,
    languages,
    locale: language,
    timezone: config.stealth.timezone || profile.timezone,
  };
}

function createBaseIdentity(config) {
  const template = applyLocaleOverrides(pick(config.browserProfiles), config);
  const proxy = pickProxy(config);

  return {
    profileId: template.id,
    platform: template.platform,
    uaPlatform: template.uaPlatform,
    platformVersion: template.platformVersion,
    vendor: template.vendor,
    language: template.language,
    languages: template.languages,
    locale: template.locale,
    timezone: template.timezone,
    viewport: template.viewport,
    screen: template.screen,
    hardwareConcurrency: template.hardwareConcurrency,
    deviceMemory: template.deviceMemory,
    maxTouchPoints: template.maxTouchPoints,
    webgl: template.webgl,
    geolocation: {
      latitude: config.stealth.geo.latitude,
      longitude: config.stealth.geo.longitude,
    },
    proxy,
    userAgent: null,
    secChUa: null,
    chromeMajor: null,
    chromeFull: null,
    createdAt: new Date().toISOString(),
  };
}

function finalizeIdentity(identity, browserVersion) {
  const chrome = parseChromeVersion(browserVersion);
  identity.chromeMajor = chrome.major;
  identity.chromeFull = chrome.full;
  identity.userAgent = buildUserAgent(identity, chrome);
  identity.secChUa = buildSecChUa(chrome.major);
  identity.updatedAt = new Date().toISOString();
  return identity;
}

function nextVisitor(config, browserVersion, logger) {
  const identity = finalizeIdentity(createBaseIdentity(config), browserVersion);
  const proxyLabel = identity.proxy ? identity.proxy.arg : 'direct';
  logger.info(`Visitante novo | perfil=${identity.profileId} | proxy=${proxyLabel}`);
  return identity;
}

function loadOrCreateBaseIdentity(config, logger) {
  const files = sessionPaths(config);

  if (config.session.persist && fs.existsSync(files.identity)) {
    try {
      const saved = JSON.parse(fs.readFileSync(files.identity, 'utf8'));
      if (saved?.profileId && saved.viewport) {
        if (!config.proxy.enabled) {
          saved.proxy = null;
        } else if (saved.proxy?.raw) {
          saved.proxy = parseProxyServer(saved.proxy.raw);
        } else {
          saved.proxy = pickProxy(config);
        }
        logger.info(`Identidade reutilizada: ${saved.profileId}`);
        return saved;
      }
    } catch (err) {
      logger.warn('Identidade salva ilegível, gerando nova:', err.message);
    }
  }

  const identity = createBaseIdentity(config);
  logger.info(`Nova identidade: ${identity.profileId}`);
  return identity;
}

function saveIdentity(config, identity) {
  if (!config.session.persist) return;
  const files = sessionPaths(config);
  ensureDir(files.dir);
  const serializable = {
    ...identity,
    proxy: identity.proxy ? { raw: identity.proxy.raw } : null,
  };
  fs.writeFileSync(files.identity, JSON.stringify(serializable, null, 2));
}

async function restoreCookies(page, config, logger) {
  if (!config.session.persist) return 0;
  const files = sessionPaths(config);
  if (!fs.existsSync(files.cookies)) return 0;
  try {
    const cookies = JSON.parse(fs.readFileSync(files.cookies, 'utf8'));
    if (!Array.isArray(cookies) || cookies.length === 0) return 0;
    await page.setCookie(...cookies);
    logger.debug(`Cookies restaurados: ${cookies.length}`);
    return cookies.length;
  } catch (err) {
    logger.warn('Falha ao restaurar cookies:', err.message);
    return 0;
  }
}

async function persistCookies(page, config, logger) {
  if (!config.session.persist) return;
  if (!page || page.isClosed()) return;
  const files = sessionPaths(config);
  try {
    const cookies = await page.cookies();
    ensureDir(files.dir);
    fs.writeFileSync(files.cookies, JSON.stringify(cookies, null, 2));
    logger.debug(`Cookies salvos: ${cookies.length}`);
  } catch (err) {
    logger.debug('Não foi possível salvar cookies:', err.message);
  }
}

module.exports = {
  sessionPaths,
  parseChromeVersion,
  buildUserAgent,
  buildSecChUa,
  createBaseIdentity,
  finalizeIdentity,
  loadOrCreateBaseIdentity,
  saveIdentity,
  nextVisitor,
  restoreCookies,
  persistCookies,
};
