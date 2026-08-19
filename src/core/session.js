'use strict';

const { authenticateProxy } = require('./proxy');
const { restoreCookies } = require('./identity');
const { applyFingerprint, applyCdpOverrides, extraHttpHeaders } = require('./stealth');

async function createSession(browser, config, logger, identity) {
  const page = await browser.newPage();
  const vp = identity?.viewport || config.viewport;

  await page.setViewport({
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: vp.deviceScaleFactor || 1,
    hasTouch: false,
    isMobile: false,
    isLandscape: vp.width >= vp.height,
  });
  await page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  await page.setDefaultTimeout(config.defaultTimeoutMs);
  await page.setCacheEnabled(true);

  if (identity) {
    await authenticateProxy(page, identity.proxy);
    if (config.stealth.enabled) {
      await applyFingerprint(page, identity);
      await applyCdpOverrides(page, identity);
      await page.setExtraHTTPHeaders(extraHttpHeaders(identity));
    } else if (identity.userAgent) {
      await page.setUserAgent(identity.userAgent);
    }
    await restoreCookies(page, config, logger);
    logger.info(
      `Sessão | perfil=${identity.profileId} | UA Chrome/${identity.chromeMajor} | tz=${identity.timezone}`
    );
  }

  return page;
}

async function recreateSession(browser, page, config, logger, identity) {
  if (page && !page.isClosed()) {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
  return createSession(browser, config, logger, identity);
}

module.exports = { createSession, recreateSession };
