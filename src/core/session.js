'use strict';

const { pick } = require('../utils/random');
const { resolveSessionLocale } = require('./geo');
const {
  applyPageStealth,
  applyLocaleHints,
  applyDeviceHints,
  buildRealisticHeaders,
} = require('./stealth');
const { applyBandwidthSaver } = require('./bandwidth');

/**
 * @param {object} browser
 * @param {object} config
 * @param {object} logger
 * @param {object|null} activeProxy
 * @param {object|null} device
 * @param {object|null} preResolvedLocale
 * @param {object|null} persona — viewport/UA fixos do worker (não sortear aqui)
 * @param {{ x: number, y: number }|null} screenOffset — fixo por worker
 */
async function createSession(
  browser,
  config,
  logger,
  activeProxy = null,
  device = null,
  preResolvedLocale = null,
  persona = null,
  screenOffset = null
) {
  const pages = await browser.pages().catch(() => []);
  for (const extra of pages) {
    try {
      const extraUrl = extra.url();
      if (extraUrl === 'about:blank' && pages.length === 1) {
        await extra.close().catch(() => {});
      } else if (extraUrl !== 'about:blank') {
        await extra.close().catch(() => {});
      }
    } catch {
      // popup órfão
    }
  }

  const page = await browser.newPage();

  const lingerMs = Math.max(1000, config.popupLingerMs ?? 15_000);
  const popupMeta = { openedAt: 0, closedAt: 0, lingerMs: 0 };
  page.__botPopupMeta = popupMeta;

  page.on('popup', async (popup) => {
    const openedAt = Date.now();
    popupMeta.openedAt = openedAt;
    try {
      await applyBandwidthSaver(popup, {
        mode: config.bandwidthSaver === 'off' ? 'light' : config.bandwidthSaver || 'light',
        logger,
      });
    } catch {
      // ignore
    }

    let lastRequestAt = Date.now();
    const onReq = () => {
      lastRequestAt = Date.now();
    };
    try {
      popup.on('request', onReq);
    } catch {
      // ignore
    }

    const poll = setInterval(() => {
      const closed = typeof popup.isClosed === 'function' ? popup.isClosed() : false;
      if (closed) {
        clearInterval(poll);
        return;
      }
      if (Date.now() - lastRequestAt >= lingerMs) {
        clearInterval(poll);
        popupMeta.closedAt = Date.now();
        popupMeta.lingerMs = popupMeta.closedAt - openedAt;
        popup.close().catch(() => {});
      }
    }, 1000);

    // Hard cap: 3× linger
    setTimeout(() => {
      clearInterval(poll);
      const closed = typeof popup.isClosed === 'function' ? popup.isClosed() : false;
      if (!closed) {
        popupMeta.closedAt = Date.now();
        popupMeta.lingerMs = popupMeta.closedAt - openedAt;
        popup.close().catch(() => {});
      }
    }, lingerMs * 3).unref?.();
  });

  let viewport;
  let userAgent;
  let isMobile = false;
  let hasTouch = false;

  if (persona?.viewport && persona?.userAgent) {
    viewport = persona.viewport;
    userAgent = persona.userAgent;
    isMobile = Boolean(persona.isMobile);
    hasTouch = Boolean(persona.hasTouch);
  } else if (device?.profile) {
    // Fallback legado — não deve ocorrer se createWorker passou persona
    logger.warn('createSession sem persona fixa — usando viewport/UA do perfil (não ideal)');
    const vp = device.profile.viewports?.[0];
    viewport = {
      width: vp?.width || config.viewport.width,
      height: vp?.height || config.viewport.height,
      deviceScaleFactor: vp?.deviceScaleFactor || 1,
      isMobile: Boolean(device.profile.isMobile),
      hasTouch: Boolean(device.profile.hasTouch),
    };
    userAgent = device.profile.userAgents?.[0] || pick(config.userAgents);
    isMobile = Boolean(device.profile.isMobile);
    hasTouch = Boolean(device.profile.hasTouch);
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

  // Override manual de TZ desalinhado do IP → warning
  if (
    localeHints.countryCode &&
    process.env.STEALTH_TIMEZONE &&
    localeHints.timezoneId &&
    process.env.STEALTH_TIMEZONE !== localeHints.timezoneId &&
    localeHints.source &&
    !String(localeHints.source).includes('fallback')
  ) {
    logger.warn(
      `STEALTH_TIMEZONE=${process.env.STEALTH_TIMEZONE} ≠ geo do IP (${localeHints.timezoneId} / ${localeHints.countryCode}) — risco de mismatch`
    );
  }

  await applyPageStealth(page, {
    languages: localeHints.languages,
    screenOffset: screenOffset || { x: 12, y: 28 },
  });
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

  // Cookies pré-existentes (perfil persistente)
  let cookiesPresent = false;
  let nCookies = 0;
  try {
    const cookies = await page.cookies();
    nCookies = cookies.length;
    cookiesPresent = nCookies > 0;
  } catch {
    // ignore
  }

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
  page.__botCookiesPresent = cookiesPresent;
  page.__botNCookies = nCookies;
  page.__botPersonaHash = persona?.hash || null;

  logger.debug(
    `device=${page.__botDeviceType} | touch=${hasTouch} | tz=${localeHints.timezoneId} | locale=${localeHints.locale} | cookies=${nCookies} | UA: ${userAgent}`
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
  preResolvedLocale = null,
  persona = null,
  screenOffset = null
) {
  if (page && !page.isClosed()) {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
  return createSession(
    browser,
    config,
    logger,
    activeProxy,
    device,
    preResolvedLocale,
    persona,
    screenOffset
  );
}

module.exports = { createSession, recreateSession };
