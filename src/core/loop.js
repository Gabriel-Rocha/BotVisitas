'use strict';

const { launchBrowser, closeBrowser } = require('./browser');
const { createSession, recreateSession } = require('./session');
const { randomInt } = require('../utils/random');
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
  let stopping = false;

  async function ensureBrowser() {
    if (!needsBrowser) return;
    if (browser && browser.isConnected()) return;
    await closeBrowser(browser, logger);
    browser = await launchBrowser(config, logger);
    page = await createSession(browser, config, logger);
  }

  async function maybeRestartBrowser() {
    if (!needsBrowser) return;
    const every = config.browserRestartEvery;
    if (!every || every <= 0) return;
    if (stats.iterations === 0 || stats.iterations % every !== 0) return;

    logger.info(`Restart periódico do browser (#${stats.iterations})`);
    await closeBrowser(browser, logger);
    browser = null;
    page = null;
    await ensureBrowser();
  }

  async function tick() {
    await ensureBrowser();

    const result = await strategy.run(page, { config, logger });
    if (result?.ok) stats.ok += 1;
    else stats.errors += 1;

    stats.iterations += 1;
    await maybeRestartBrowser();
  }

  async function run() {
    logger.info(
      `Loop iniciado | strategy=${strategy.name} | browser=${needsBrowser ? 'sim' : 'não'}`
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
            page = await recreateSession(browser, page, config, logger);
          } catch {
            await closeBrowser(browser, logger);
            browser = null;
            page = null;
          }
        }
      }

      if (stopping) break;

      const waitSec = randomInt(config.intervalMinSec, config.intervalMaxSec);
      if (waitSec > 0) {
        logger.info(`Aguardando ${waitSec}s até a próxima iteração...`);
        await sleep(waitSec * 1000);
      }
    }
  }

  async function stop() {
    stopping = true;
    logger.info('Encerrando loop...', JSON.stringify(getStats()));
    if (needsBrowser) {
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
