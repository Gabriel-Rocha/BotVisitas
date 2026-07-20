'use strict';

const { pick } = require('../utils/random');
const { applyProxyAuth } = require('./proxy');

async function createSession(browser, config, logger, activeProxy = null) {
  const page = await browser.newPage();

  if (activeProxy) {
    await applyProxyAuth(page, activeProxy);
  }

  await page.setViewport(config.viewport);
  await page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  await page.setDefaultTimeout(config.defaultTimeoutMs);

  const userAgent = pick(config.userAgents);
  await page.setUserAgent(userAgent);
  logger.debug('UA:', userAgent);

  return page;
}

async function recreateSession(browser, page, config, logger, activeProxy = null) {
  if (page && !page.isClosed()) {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
  return createSession(browser, config, logger, activeProxy);
}

module.exports = { createSession, recreateSession };
