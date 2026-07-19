'use strict';

const { pick } = require('../utils/random');

async function createSession(browser, config, logger) {
  const page = await browser.newPage();

  await page.setViewport(config.viewport);
  await page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  await page.setDefaultTimeout(config.defaultTimeoutMs);

  const userAgent = pick(config.userAgents);
  await page.setUserAgent(userAgent);
  logger.debug('UA:', userAgent);

  return page;
}

async function recreateSession(browser, page, config, logger) {
  if (page && !page.isClosed()) {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
  return createSession(browser, config, logger);
}

module.exports = { createSession, recreateSession };
