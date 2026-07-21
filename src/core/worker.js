'use strict';

const { launchBrowser, closeBrowser } = require('./browser');
const { createSession, recreateSession } = require('./session');
const { randomInt } = require('../utils/random');
const { sleep } = require('../utils/sleep');

/**
 * Um worker = 1 Chromium (+ 1 proxy exclusivo se houver lease) + 1 perfil de device.
 */
function createWorker({
  workerId,
  config,
  strategy,
  logger,
  proxyLease = null,
  deviceType = 'desktop',
  deviceProfile = null,
}) {
  const needsBrowser = strategy.requiresBrowser !== false;
  const prefix = `[w${workerId}]`;
  const device = deviceProfile ? { type: deviceType, profile: deviceProfile } : null;

  const stats = {
    workerId,
    deviceType,
    startedAt: Date.now(),
    iterations: 0,
    ok: 0,
    errors: 0,
    proxyLabel: null,
  };

  let browser = null;
  let page = null;
  let activeProxy = null;
  let stopping = false;

  function log(level, ...args) {
    logger[level](prefix, ...args);
  }

  async function acquireProxy() {
    if (!proxyLease) return null;
    const proxy = proxyLease.acquire();
    stats.proxyLabel = proxy.label;
    log('info', `Proxy adquirido: ${proxy.label}`);
    return proxy;
  }

  function releaseProxy() {
    if (!proxyLease || !activeProxy) return;
    proxyLease.release(activeProxy);
    log('info', `Proxy liberado: ${activeProxy.label}`);
    activeProxy = null;
    stats.proxyLabel = null;
  }

  async function ensureBrowser() {
    if (!needsBrowser) return;
    if (browser && browser.isConnected()) return;

    await closeBrowser(browser, {
      info: (...a) => log('info', ...a),
      warn: (...a) => log('warn', ...a),
    });

    if (!activeProxy && proxyLease) {
      activeProxy = await acquireProxy();
    }

    const launched = await launchBrowser(config, {
      info: (...a) => log('info', ...a),
      warn: (...a) => log('warn', ...a),
      debug: (...a) => log('debug', ...a),
    }, activeProxy);

    browser = launched.browser;
    page = await createSession(browser, config, {
      info: (...a) => log('info', ...a),
      warn: (...a) => log('warn', ...a),
      debug: (...a) => log('debug', ...a),
    }, activeProxy, device);
  }

  async function restartBrowserWithNewProxy() {
    if (!needsBrowser) return;

    log('info', `Restart periódico (#${stats.iterations})`);
    await closeBrowser(browser, {
      info: (...a) => log('info', ...a),
      warn: (...a) => log('warn', ...a),
    });
    browser = null;
    page = null;

    releaseProxy();

    if (proxyLease) {
      try {
        activeProxy = await acquireProxy();
      } catch (err) {
        log('warn', 'Sem proxy livre no restart — aguardando e tentando de novo:', err.message);
        await sleep(2000);
        activeProxy = await acquireProxy();
      }
    }

    await ensureBrowser();
  }

  async function maybeRestartBrowser() {
    if (!needsBrowser) return;
    const every = config.browserRestartEvery;
    if (!every || every <= 0) return;
    if (stats.iterations === 0 || stats.iterations % every !== 0) return;
    await restartBrowserWithNewProxy();
  }

  async function tick() {
    await ensureBrowser();

    const result = await strategy.run(page, {
      config,
      logger: {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
        error: (...a) => log('error', ...a),
        debug: (...a) => log('debug', ...a),
      },
    });

    if (result?.ok) stats.ok += 1;
    else stats.errors += 1;

    stats.iterations += 1;
    await maybeRestartBrowser();
  }

  async function run() {
    log(
      'info',
      `Worker start | device=${deviceType} | strategy=${strategy.name} | browser=${needsBrowser ? 'sim' : 'não'}`
    );

    while (!stopping) {
      try {
        await tick();
      } catch (err) {
        stats.errors += 1;
        log('error', 'Erro na iteração:', err.message);
        log('debug', err.stack);

        if (needsBrowser) {
          try {
            page = await recreateSession(browser, page, config, {
              info: (...a) => log('info', ...a),
              debug: (...a) => log('debug', ...a),
            }, activeProxy, device);
          } catch {
            await closeBrowser(browser, {
              info: (...a) => log('info', ...a),
              warn: (...a) => log('warn', ...a),
            });
            browser = null;
            page = null;
            releaseProxy();
          }
        }
      }

      if (stopping) break;

      const waitSec = randomInt(config.intervalMinSec, config.intervalMaxSec);
      log('info', `Aguardando ${waitSec}s...`);
      await sleep(waitSec * 1000);
    }
  }

  async function stop() {
    stopping = true;
    log('info', 'Encerrando...', JSON.stringify(getStats()));
    if (needsBrowser) {
      await closeBrowser(browser, {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
      });
    }
    browser = null;
    page = null;
    releaseProxy();
  }

  function getStats() {
    return {
      ...stats,
      uptimeSec: Math.round((Date.now() - stats.startedAt) / 1000),
    };
  }

  return { workerId, run, stop, getStats };
}

module.exports = { createWorker };
