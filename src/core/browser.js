'use strict';

const fs = require('fs');
const { execSync, spawn } = require('child_process');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { getProxyLaunchArgs, getTuxlerLaunchArgs } = require('./proxy');
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

  const proxyArgs = config.tuxler?.enabled
    ? await getTuxlerLaunchArgs(logger, config)
    : getProxyLaunchArgs(activeProxy);

  const processLimit = Math.max(1, config.chromeProcessLimit || 1);
  const args = [
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-popup-blocking',
    '--disable-notifications',
    '--ignore-certificate-errors',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-extensions',
    '--disable-component-update',
    '--metrics-recording-only',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    `--renderer-process-limit=${processLimit}`,
    ...getStealthLaunchArgs({ lang: stealthOpts.lang }),
    ...proxyArgs,
  ];

  const options = {
    headless: config.headless ? 'new' : false,
    args,
    ignoreDefaultArgs: ['--enable-automation'],
    defaultViewport: null,
    ignoreHTTPSErrors: true,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
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

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5_000,
      });
      return String(out).includes(String(pid));
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessTree(pid, logger) {
  if (!pid || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /F /T /PID ${pid}`, {
          stdio: 'ignore',
          windowsHide: true,
          timeout: 10_000,
        });
      } catch {
        spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
          stdio: 'ignore',
          windowsHide: true,
        });
      }
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    }
    logger?.warn?.(`Processo Chromium ${pid} encerrado à força`);
  } catch (err) {
    logger?.debug?.('killProcessTree:', err.message);
  }
}

async function ensureProcessDead(pid, logger, { rounds = 8, gapMs = 200 } = {}) {
  if (!pid || pid <= 0) return;
  if (!isPidAlive(pid)) return;

  killProcessTree(pid, logger);
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((r) => setTimeout(r, gapMs));
    if (!isPidAlive(pid)) return;
    if (i === 3 || i === rounds - 1) killProcessTree(pid, logger);
  }
  if (isPidAlive(pid)) {
    logger?.warn?.(`Chromium pid ${pid} ainda vivo após taskkill — possível órfão de RAM`);
  }
}

async function closeBrowser(browser, logger, { forceMs = 6_000 } = {}) {
  if (!browser) return;
  const proc = typeof browser.process === 'function' ? browser.process() : null;
  const pid = proc?.pid;
  let forceTimer = null;
  let forced = false;

  try {
    await Promise.race([
      browser.close().catch((err) => {
        logger?.warn?.('browser.close():', err.message);
      }),
      new Promise((resolve) => {
        forceTimer = setTimeout(() => {
          forced = true;
          logger?.warn?.(`browser.close() > ${forceMs}ms — matando árvore de processos`);
          if (pid) killProcessTree(pid, logger);
          resolve();
        }, forceMs);
      }),
    ]);
  } catch (err) {
    logger?.warn?.('Falha ao encerrar browser:', err.message);
    if (pid) killProcessTree(pid, logger);
  } finally {
    if (forceTimer) clearTimeout(forceTimer);
    // Windows: close() “ok” ainda deixa renderers órfãos — sempre confirma morte do PID.
    if (pid) {
      await ensureProcessDead(pid, logger);
    }
    if (!forced) logger?.info?.('Browser encerrado');
  }
}

module.exports = {
  launchBrowser,
  closeBrowser,
  killProcessTree,
  ensureProcessDead,
  isPidAlive,
  resolveChromePath,
};
