'use strict';

const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { getProxyLaunchArgs } = require('./proxy');
const { getStealthLaunchArgs } = require('./stealth');

puppeteer.use(StealthPlugin());

const SYSTEM_CHROME_CANDIDATES = [
  process.env.CHROME_EXECUTABLE_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
].filter(Boolean);

function resolveChromePath(configured) {
  const candidates = [configured, ...SYSTEM_CHROME_CANDIDATES].filter(Boolean);
  for (const candidate of candidates) {
    const p = String(candidate).trim();
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * @param {object} config
 * @param {object} logger
 * @param {object|null} [forcedProxy] — proxy já adquirido pelo worker (lease exclusivo)
 * @param {{ lang?: string }} [stealthOpts]
 */
async function launchBrowser(config, logger, forcedProxy = null, stealthOpts = {}) {
  const activeProxy = forcedProxy || null;
  if (activeProxy) {
    logger.info(`Proxy selecionado: ${activeProxy.label}`);
  }

  const args = [
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-popup-blocking',
    '--disable-notifications',
    '--ignore-certificate-errors',
    ...getStealthLaunchArgs({ lang: stealthOpts.lang }),
    ...getProxyLaunchArgs(activeProxy),
  ];

  const options = {
    headless: config.headless ? 'new' : false,
    args,
    ignoreDefaultArgs: ['--enable-automation'],
    defaultViewport: null,
  };

  const chromePath = resolveChromePath(config.chromeExecutablePath);
  if (chromePath) {
    options.executablePath = chromePath;
    logger.info(`Usando browser do sistema: ${chromePath}`);
  } else {
    logger.warn(
      'Nenhum Chromium do sistema encontrado — tentando o embutido do Puppeteer (pode falhar no Docker).'
    );
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

module.exports = { launchBrowser, closeBrowser, resolveChromePath };
