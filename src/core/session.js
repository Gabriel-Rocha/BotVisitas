'use strict';

const { pick } = require('../utils/random');
const { pickSessionPersona } = require('./devices');
const { applyProxyAuth } = require('./proxy');
const { resolveSessionLocale } = require('./geo');
const {
  applyPageStealth,
  applyLocaleHints,
  buildRealisticHeaders,
} = require('./stealth');

async function createSession(
  browser,
  config,
  logger,
  activeProxy = null,
  device = null,
  preResolvedLocale = null
) {
  const page = await browser.newPage();

  if (activeProxy) {
    await applyProxyAuth(page, activeProxy);
  }

  let viewport;
  let userAgent;
  let isMobile = false;

  if (device?.profile) {
    const persona = pickSessionPersona(device.profile);
    viewport = persona.viewport;
    userAgent = persona.userAgent;
    isMobile = Boolean(persona.isMobile);
  } else {
    viewport = {
      width: config.viewport.width,
      height: config.viewport.height,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    };
    userAgent = pick(config.userAgents);
  }

  const localeHints =
    preResolvedLocale ||
    (await resolveSessionLocale({
      proxy: activeProxy,
      fallbackTimezone: config.stealth?.timezoneId || 'America/Sao_Paulo',
      fallbackLocale: config.stealth?.locale || 'pt-BR',
      enabled: config.stealth?.geoTz !== false,
      logger,
    }));

  // Ofuscação: patches + timezone alinhado ao IP antes de qualquer navegação.
  await applyPageStealth(page, { languages: localeHints.languages });
  await applyLocaleHints(page, {
    timezoneId: localeHints.timezoneId,
    locale: localeHints.locale,
  });

  await page.setViewport(viewport);
  await page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  await page.setDefaultTimeout(config.defaultTimeoutMs);
  await page.setUserAgent(userAgent);
  await page.setExtraHTTPHeaders(
    buildRealisticHeaders(userAgent, {
      isMobile,
      acceptLanguage: localeHints.acceptLanguage,
    })
  );

  // Guarda na page para strategies / preview / debug.
  page.__botViewport = {
    width: viewport.width,
    height: viewport.height,
  };
  page.__botDeviceType = device?.type || 'desktop';
  page.__botTimezone = localeHints.timezoneId;
  page.__botLocale = localeHints.locale;
  page.__botGeo = {
    countryCode: localeHints.countryCode,
    ip: localeHints.ip,
    source: localeHints.source,
  };

  logger.debug(
    `device=${page.__botDeviceType} | tz=${localeHints.timezoneId} | locale=${localeHints.locale} | UA: ${userAgent}`
  );

  return page;
}

async function recreateSession(
  browser,
  page,
  config,
  logger,
  activeProxy = null,
  device = null,
  preResolvedLocale = null
) {
  if (page && !page.isClosed()) {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
  return createSession(browser, config, logger, activeProxy, device, preResolvedLocale);
}

module.exports = { createSession, recreateSession };
