'use strict';

const { authenticateProxy } = require('./proxy');
const { restoreCookies } = require('./identity');
const { applyFingerprint, applyCdpOverrides, extraHttpHeaders } = require('./stealth');

async function createSession(source, config, logger, identity) {
  const page = await source.newPage();
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
    if (config.session.persist) {
      await restoreCookies(page, config, logger);
    }
    logger.info(
      `Sessão | perfil=${identity.profileId} | UA Chrome/${identity.chromeMajor} | tz=${identity.timezone}`
    );
  }

  return page;
}

async function createVisitorContext(browser, identity) {
  const options = {};
  if (identity?.proxy) {
    options.proxyServer = identity.proxy.arg;
  }
  return browser.createIncognitoBrowserContext(options);
}

async function closePage(page) {
  if (!page || page.isClosed()) return;
  try {
    await page.close();
  } catch {
    // ignore
  }
}

async function closeContext(context) {
  if (!context) return;
  try {
    await context.close();
  } catch {
    // ignore
  }
}

module.exports = { createSession, createVisitorContext, closePage, closeContext };
