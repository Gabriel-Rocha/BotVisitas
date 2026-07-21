'use strict';

const { pick } = require('../utils/random');
const { pickSessionPersona } = require('./devices');
const { applyProxyAuth } = require('./proxy');

async function createSession(browser, config, logger, activeProxy = null, device = null) {
  const page = await browser.newPage();

  if (activeProxy) {
    await applyProxyAuth(page, activeProxy);
  }

  let viewport;
  let userAgent;

  if (device?.profile) {
    const persona = pickSessionPersona(device.profile);
    viewport = persona.viewport;
    userAgent = persona.userAgent;
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

  await page.setViewport(viewport);
  await page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  await page.setDefaultTimeout(config.defaultTimeoutMs);
  await page.setUserAgent(userAgent);
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  });

  // Guarda na page para strategies (ex.: clickCenter) usarem o viewport real.
  page.__botViewport = {
    width: viewport.width,
    height: viewport.height,
  };
  page.__botDeviceType = device?.type || 'desktop';

  logger.debug(`device=${page.__botDeviceType} | UA: ${userAgent}`);

  return page;
}

async function recreateSession(browser, page, config, logger, activeProxy = null, device = null) {
  if (page && !page.isClosed()) {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
  return createSession(browser, config, logger, activeProxy, device);
}

module.exports = { createSession, recreateSession };
