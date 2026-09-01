'use strict';

const { pick } = require('../utils/random');
const { pickSessionPersona } = require('./devices');
const { resolveSessionLocale } = require('./geo');
const {
  applyPageStealth,
  applyLocaleHints,
  applyDeviceHints,
  buildRealisticHeaders,
} = require('./stealth');
const { applyBandwidthSaver } = require('./bandwidth');

function attachPopupGuard(page) {
  if (page.__botPopupGuard) return;
  page.__botPopupGuard = true;
  page.on('popup', (popup) => {
    // Fecha depois do stealth terminar o onPageCreated — close imediato crasha o Node.
    setTimeout(() => {
      popup.close().catch(() => {});
    }, 1_200);
  });
}

async function acquirePage(browser) {
  const pages = await browser.pages().catch(() => []);
  const reusable = pages.find((p) => p && !p.isClosed());
  if (reusable) return reusable;
  return browser.newPage();
}

async function closeExtraPages(browser, keep) {
  const pages = await browser.pages().catch(() => []);
  await Promise.all(
    pages
      .filter((p) => p && p !== keep && !p.isClosed())
      .map((p) => p.close().catch(() => {}))
  );
}

async function createSession(
  browser,
  config,
  logger,
  activeProxy = null,
  device = null,
  preResolvedLocale = null
) {
  const page = await acquirePage(browser);
  attachPopupGuard(page);

  let viewport;
  let userAgent;
  let isMobile = false;
  let hasTouch = false;

  if (device?.profile) {
    const persona = pickSessionPersona(device.profile);
    viewport = persona.viewport;
    userAgent = persona.userAgent;
    isMobile = Boolean(persona.isMobile);
    hasTouch = Boolean(persona.hasTouch);
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
  await applyDeviceHints(page, { isMobile, hasTouch, userAgent });
  await applyLocaleHints(page, {
    timezoneId: localeHints.timezoneId,
    locale: localeHints.locale,
  });

  const bwMode = config.bandwidthSaver || 'light';
  await applyBandwidthSaver(page, { mode: bwMode, logger });

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

  try {
    await page.bringToFront();
  } catch {
    // headless / target already focused
  }

  // Guarda na page para strategies / preview / debug.
  page.__botViewport = {
    width: viewport.width,
    height: viewport.height,
  };
  page.__botDeviceType = device?.type || 'desktop';
  page.__botHasTouch = hasTouch;
  page.__botIsMobile = isMobile;
  page.__botTimezone = localeHints.timezoneId;
  page.__botLocale = localeHints.locale;
  page.__botGeo = {
    countryCode: localeHints.countryCode,
    ip: localeHints.ip,
    source: localeHints.source,
  };

  logger.debug(
    `device=${page.__botDeviceType} | touch=${hasTouch} | tz=${localeHints.timezoneId} | locale=${localeHints.locale} | UA: ${userAgent}`
  );

  await closeExtraPages(browser, page);
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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return createSession(browser, config, logger, activeProxy, device, preResolvedLocale);
}

module.exports = { createSession, recreateSession };
