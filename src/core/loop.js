'use strict';

const { launchBrowser, closeBrowser } = require('./browser');
const { createSession, recreateSession } = require('./session');
const {
  loadOrCreateBaseIdentity,
  finalizeIdentity,
  saveIdentity,
  persistCookies,
} = require('./identity');
const { computeGapMs } = require('./stealth');
const { sleep } = require('../utils/sleep');

function createLoop({ config, strategy, logger }) {
  const needsBrowser = strategy.requiresBrowser !== false;

  const stats = {
    startedAt: Date.now(),
    iterations: 0,
    ok: 0,
    errors: 0,
  };

  let browser = null;
  let page = null;
  let identity = null;
  let stopping = false;

  async function ensureBrowser() {
    if (!needsBrowser) return;
    if (browser && browser.isConnected()) return;
    await closeBrowser(browser, logger);
    identity = loadOrCreateBaseIdentity(config, logger);
    browser = await launchBrowser(config, logger, identity);
    const version = await browser.version();
    identity = finalizeIdentity(identity, version);
    saveIdentity(config, identity);
    logger.debug(`Chrome reportado: ${version}`);
    page = await createSession(browser, config, logger, identity);
  }

  async function maybeRestartBrowser() {
    if (!needsBrowser) return;
    const every = config.browserRestartEvery;
    if (!every || every <= 0) return;
    if (stats.iterations === 0 || stats.iterations % every !== 0) return;

    logger.info(`Restart periódico do browser (#${stats.iterations})`);
    await persistCookies(page, config, logger);
    await closeBrowser(browser, logger);
    browser = null;
    page = null;
    await ensureBrowser();
  }

  async function tick() {
    await ensureBrowser();

    const result = await strategy.run(page, { config, logger, identity });
    if (result?.ok) stats.ok += 1;
    else stats.errors += 1;

    stats.iterations += 1;
    await persistCookies(page, config, logger);
    await maybeRestartBrowser();
  }

  async function run() {
    logger.info(
      `Loop iniciado | strategy=${strategy.name} | browser=${needsBrowser ? 'sim' : 'não'} | stealth=${config.stealth.enabled}`
    );

    while (!stopping) {
      try {
        await tick();
      } catch (err) {
        stats.errors += 1;
        logger.error('Erro na iteração:', err.message);
        logger.debug(err.stack);

        if (needsBrowser) {
          try {
            page = await recreateSession(browser, page, config, logger, identity);
          } catch {
            await closeBrowser(browser, logger);
            browser = null;
            page = null;
          }
        }
      }

      if (stopping) break;

      const waitMs = computeGapMs(config);
      if (waitMs > 0) {
        logger.info(`Aguardando ${(waitMs / 1000).toFixed(1)}s até a próxima iteração...`);
        await sleep(waitMs);
      }
    }
  }

  async function stop() {
    stopping = true;
    logger.info('Encerrando loop...', JSON.stringify(getStats()));
    if (needsBrowser) {
      await persistCookies(page, config, logger);
      await closeBrowser(browser, logger);
    }
    browser = null;
    page = null;
  }

  function getStats() {
    return {
      ...stats,
      uptimeSec: Math.round((Date.now() - stats.startedAt) / 1000),
    };
  }

  return { run, stop, getStats };
}

module.exports = { createLoop };
