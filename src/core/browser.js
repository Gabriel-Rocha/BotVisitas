'use strict';

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { sessionPaths } = require('./identity');
const { getLaunchArgs, findChromeExecutable } = require('./stealth');
const { assertProxyReady } = require('./proxy');

puppeteer.use(StealthPlugin());

async function launchBrowser(config, logger, identity) {
  assertProxyReady(config.proxy, logger);

  const args = getLaunchArgs(config, identity, {
    attachProxy: Boolean(config.session.persist),
  });
  const executablePath = findChromeExecutable(config);
  const files = sessionPaths(config);

  const options = {
    headless: config.headless ? 'new' : false,
    args,
    ignoreDefaultArgs: ['--enable-automation'],
    defaultViewport: null,
    ignoreHTTPSErrors: true,
  };

  if (config.session.persist) {
    options.userDataDir = files.chromeProfile;
  }

  if (executablePath) {
    options.executablePath = executablePath;
    logger.info(`Usando Chrome do sistema: ${executablePath}`);
  } else {
    logger.info('Usando Chromium embutido do Puppeteer (TLS/JA3 mais fraco que Chrome real)');
  }

  options.env = {
    ...process.env,
    LANGUAGE: identity.locale || 'pt-BR',
  };

  const browser = await puppeteer.launch(options);
  logger.info('Browser iniciado');
  return browser;
}

async function closeBrowser(browser, logger) {
  if (!browser) return;
  try {
    await browser.close();
    logger.info('Browser encerrado');
  } catch (err) {
    logger.warn('Falha ao encerrar browser:', err.message);
  }
}

module.exports = { launchBrowser, closeBrowser };
