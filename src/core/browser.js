'use strict';

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { getProxyLaunchArgs } = require('./proxy');

puppeteer.use(StealthPlugin());

/**
 * @param {object} config
 * @param {object} logger
 * @param {object|null} [forcedProxy] — proxy já adquirido pelo worker (lease exclusivo)
 */
async function launchBrowser(config, logger, forcedProxy = null) {
  const activeProxy = forcedProxy || null;
  if (activeProxy) {
    logger.info(`Proxy selecionado: ${activeProxy.label}`);
  }

  const args = [
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-popup-blocking',
    '--disable-notifications',
    '--ignore-certificate-errors',
    ...getProxyLaunchArgs(activeProxy),
  ];

  const options = {
    headless: config.headless ? 'new' : false,
    args,
    ignoreDefaultArgs: ['--enable-automation'],
  };

  if (config.chromeExecutablePath) {
    options.executablePath = config.chromeExecutablePath;
    logger.info(`Usando browser do sistema: ${config.chromeExecutablePath}`);
  } else {
    logger.info('Usando Chromium embutido do Puppeteer');
  }

  const browser = await puppeteer.launch(options);
  logger.info('Browser iniciado');
  return { browser, activeProxy };
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
