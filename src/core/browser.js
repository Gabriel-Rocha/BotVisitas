'use strict';

const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { getProxyLaunchArgs, getTuxlerLaunchArgs } = require('./proxy');
const { getStealthLaunchArgs } = require('./stealth');
const { sleep } = require('../utils/sleep');

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

  const proxyArgs = config.tuxler?.enabled
    ? await getTuxlerLaunchArgs(logger, config)
    : getProxyLaunchArgs(activeProxy);

  const args = [
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-popup-blocking',
    '--disable-notifications',
    '--ignore-certificate-errors',
    ...getStealthLaunchArgs({ lang: stealthOpts.lang }),
    ...proxyArgs,
  ];

  const options = {
    headless: config.headless ? 'new' : false,
    args,
    ignoreDefaultArgs: ['--enable-automation'],
    defaultViewport: null,
    // Necessário com vários proxies HTTP (CONNECT / cert / handshake).
    ignoreHTTPSErrors: true,
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

function killProcessTree(pid, logger) {
  if (!pid || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      process.kill(pid, 'SIGKILL');
    }
    logger?.warn?.(`Processo Chromium ${pid} encerrado à força`);
  } catch (err) {
    logger?.debug?.('killProcessTree:', err.message);
  }
}

async function closeBrowser(browser, logger, { forceMs = 8_000 } = {}) {
  if (!browser) return;
  const proc = typeof browser.process === 'function' ? browser.process() : null;
  const pid = proc?.pid;

  try {
    await Promise.race([
      browser.close(),
      sleep(forceMs).then(() => {
        logger.warn(`browser.close() > ${forceMs}ms — matando árvore de processos`);
        if (pid) killProcessTree(pid, logger);
      }),
    ]);
    logger.info('Browser encerrado');
  } catch (err) {
    logger.warn('Falha ao encerrar browser:', err.message);
    if (pid) killProcessTree(pid, logger);
  }
}
module.exports = { launchBrowser, closeBrowser, killProcessTree, resolveChromePath };