'use strict';

const { launchBrowser, closeBrowser } = require('./browser');
const { createSession, recreateSession } = require('./session');
const { resolveSessionLocale } = require('./geo');
const { randomInt } = require('../utils/random');
const { sleep, sleepInterruptible, isAbortError } = require('../utils/sleep');
const { isTransientProxyError } = require('../utils/netErrors');

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
  preferredCountry = null,
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
    offers: 0,
    intermediate: 0,
    errors: 0,
    clicks: 0,
    browserRestarts: 0,
    proxyLabel: null,
    timezoneId: null,
    locale: null,
    geoCountry: null,
  };

  let browser = null;
  let page = null;
  let activeProxy = null;
  let sessionLocale = null;
  let stopping = false;
  let abortController = null;
  let captureInProgress = null;
  let lastPreview = null;
  let recycleRequested = null;

  function log(level, ...args) {
    logger[level](prefix, ...args);
  }

  async function acquireProxy() {
    if (!proxyLease) return null;
    const proxy = await proxyLease.acquire(preferredCountry);
    stats.proxyLabel = proxy.label;
    log('info', `Tuxler adquirido: ${proxy.label}`);
    return proxy;
  }

  function releaseProxy() {
    if (!proxyLease || !activeProxy) return;
    proxyLease.release(activeProxy);
    log('info', `Tuxler liberado: ${activeProxy.label}`);
    activeProxy = null;
    stats.proxyLabel = null;
  }

  async function acquireUsableProxy() {
    if (!proxyLease) return null;
    activeProxy = await acquireProxy();
    const hints = await resolveLocaleForProxy(activeProxy);
    return { proxy: activeProxy, hints };
  }

  async function resolveLocaleForProxy(proxy) {
    const hints = await resolveSessionLocale({
      egressGeo: proxy?.geo || null,
      proxy: proxy?.ip ? { host: proxy.ip, label: proxy.label } : null,
      fallbackTimezone: config.stealth?.timezoneId || 'UTC',
      fallbackLocale: config.stealth?.locale || 'en-US',
      enabled: config.stealth?.geoTz !== false,
      logger: {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
        debug: (...a) => log('debug', ...a),
      },
    });
    sessionLocale = hints;
    stats.timezoneId = hints.timezoneId;
    stats.locale = hints.locale;
    stats.geoCountry = hints.countryCode;
    return hints;
  }

  async function ensureBrowser() {
    if (!needsBrowser) return;
    if (browser && browser.isConnected()) return;

    log('info', 'Subindo Chromium...');

    await closeBrowser(browser, {
      info: (...a) => log('info', ...a),
      warn: (...a) => log('warn', ...a),
    });

    let localeHints;
    if (!activeProxy && proxyLease) {
      const acquired = await acquireUsableProxy();
      localeHints = acquired.hints;
    } else {
      localeHints = await resolveLocaleForProxy(activeProxy);
    }

    const launched = await launchBrowser(
      config,
      {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
        debug: (...a) => log('debug', ...a),
      },
      null,
      { lang: localeHints.locale }
    );

    browser = launched.browser;
    page = await createSession(
      browser,
      config,
      {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
        debug: (...a) => log('debug', ...a),
      },
      null,
      device,
      localeHints
    );
  }

  async function recycleBrowser(reason = 'periódico') {
    if (!needsBrowser) return;

    log('info', `Reciclando Chromium (${reason}) #${stats.iterations}`);
    await closeBrowser(browser, {
      info: (...a) => log('info', ...a),
      warn: (...a) => log('warn', ...a),
      debug: (...a) => log('debug', ...a),
    });
    browser = null;
    page = null;
    lastPreview = null;

    const tuxlerSkip =
      config.tuxler?.enabled && (config.tuxler?.rotateMode || 'skip') === 'skip';
    if (proxyLease && !tuxlerSkip) {
      releaseProxy();
      try {
        await acquireUsableProxy();
      } catch (err) {
        log('warn', 'Falha ao rotacionar Tuxler no restart — tentando de novo:', err.message);
        await sleep(2000);
        await acquireUsableProxy();
      }
    }

    stats.browserRestarts += 1;
    await ensureBrowser();
  }

  async function restartBrowserWithNewProxy() {
    await recycleBrowser('periódico');
  }

  async function maybeRestartBrowser() {
    if (!needsBrowser) return;
    const every = config.browserRestartEvery;
    if (!every || every <= 0) return;
    if (stats.iterations === 0 || stats.iterations % every !== 0) return;
    await recycleBrowser('periódico');
  }

  async function forceRecycleBrowser(reason = 'watchdog-ram') {
    if (!needsBrowser) return;
    recycleRequested = reason;
    if (!page || page.isClosed()) {
      recycleRequested = null;
      await recycleBrowser(reason);
    }
  }

  async function releaseTuxlerTurn() {
    if (!config.tuxler?.enabled || !proxyLease) return;
    await closeBrowser(browser, {
      info: (...a) => log('info', ...a),
      warn: (...a) => log('warn', ...a),
    });
    browser = null;
    page = null;
    sessionLocale = null;
    releaseProxy();
  }

  function visitContext() {
    return {
      shouldStop: () => stopping,
      signal: abortController?.signal,
    };
  }

  async function runStrategyWithCap() {
    const ctx = visitContext();
    const runPromise = strategy.run(page, {
      config,
      logger: {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
        error: (...a) => log('error', ...a),
        debug: (...a) => log('debug', ...a),
      },
      ...ctx,
    });

    const maxSec = config.visitMaxSec || 0;
    if (!maxSec || maxSec <= 0) return runPromise;

    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`Visita abortada (${maxSec}s)`);
        err.code = 'VISIT_TIMEOUT';
        reject(err);
      }, maxSec * 1000);
    });

    try {
      return await Promise.race([runPromise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function tick() {
    if (stopping) return;
    abortController = new AbortController();
    await ensureBrowser();

    const result = await runStrategyWithCap();

    if (result?.ok) {
      stats.ok += 1;
      const q = result.quality || 'offer';
      if (q === 'intermediate') stats.intermediate += 1;
      else stats.offers += 1;
      const visitClicks = result.meta?.clickCount ?? result.meta?.verifiedClicks ?? 0;
      stats.clicks += visitClicks;
      if (visitClicks > 0) {
        log('info', `Cliques na visita: ${visitClicks} (total worker: ${stats.clicks})`);
      }
    } else {
      stats.errors += 1;
    }

    stats.iterations += 1;

    if (recycleRequested) {
      const reason = recycleRequested;
      recycleRequested = null;
      await recycleBrowser(reason);
      return;
    }

    // Fila só quando Tuxler rotaciona IP entre workers (restart/coords).
    const tuxlerRotates = (config.tuxler?.rotateMode || 'skip').toLowerCase() !== 'skip';
    const tuxlerTurnQueue = Boolean(
      config.tuxler?.enabled &&
        proxyLease &&
        tuxlerRotates &&
        (config.concurrency || 1) > 1
    );
    if (tuxlerTurnQueue) {
      await releaseTuxlerTurn();
    } else {
      await maybeRestartBrowser();
    }
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
        if (stopping || isAbortError(err)) {
          break;
        }
        stats.errors += 1;
        log('error', 'Erro na iteração:', err.message);
        log('debug', err.stack);

        if (err.code === 'VISIT_TIMEOUT') {
          stats.iterations += 1;
          log('warn', 'Iteração estourou VISIT_MAX_SEC — próximo link');
          try {
            page = await recreateSession(
              browser,
              page,
              config,
              {
                info: (...a) => log('info', ...a),
                debug: (...a) => log('debug', ...a),
              },
              activeProxy,
              device,
              sessionLocale
            );
          } catch {
            await releaseTuxlerTurn();
          }
          continue;
        }

        if (needsBrowser) {
          const tuxlerSkip =
            config.tuxler?.enabled && (config.tuxler?.rotateMode || 'skip') === 'skip';
          const rotateProxy =
            Boolean(proxyLease) && isTransientProxyError(err) && !tuxlerSkip;
          try {
            if (rotateProxy) {
              log('warn', 'Erro de túnel/proxy — trocando sticky e reiniciando browser');
              await releaseTuxlerTurn();
              await ensureBrowser();
            } else if (isTransientProxyError(err)) {
              log('warn', 'Erro de rede/proxy — recriando sessão (Tuxler skip, sem rotação)');
              page = await recreateSession(
                browser,
                page,
                config,
                {
                  info: (...a) => log('info', ...a),
                  debug: (...a) => log('debug', ...a),
                },
                activeProxy,
                device,
                sessionLocale
              );
            } else {
              page = await recreateSession(
                browser,
                page,
                config,
                {
                  info: (...a) => log('info', ...a),
                  debug: (...a) => log('debug', ...a),
                },
                activeProxy,
                device,
                sessionLocale
              );
            }
          } catch {
            await releaseTuxlerTurn();
          }
        }
      }

      if (stopping) break;

      const waitSec = randomInt(config.intervalMinSec, config.intervalMaxSec);
      log('info', `Aguardando ${waitSec}s...`);
      try {
        await sleepInterruptible(waitSec * 1000, {
          shouldStop: () => stopping,
          signal: abortController?.signal,
        });
      } catch {
        break;
      }
    }
  }

  async function stop() {
    stopping = true;
    abortController?.abort();
    log('info', 'Encerrando...', JSON.stringify(getStats()));
    if (needsBrowser) {
      await closeBrowser(browser, {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
        debug: (...a) => log('debug', ...a),
      });
    }
    browser = null;
    page = null;
    releaseProxy();
  }

  async function capturePreview() {
    if (!needsBrowser || !page || page.isClosed()) {
      throw new Error('Worker sem página ativa para visualizar');
    }
    if (captureInProgress) return captureInProgress;

    captureInProgress = (async () => {
      let image;
      try {
        image = await page.screenshot({
          type: 'jpeg',
          quality: 58,
          fullPage: false,
          captureBeyondViewport: false,
          timeout: 12_000,
        });
      } catch (err) {
        const msg = String(err?.message || err);
        if (lastPreview?.image) {
          log('debug', `Preview indisponível (${msg}) — reutilizando última captura`);
          return {
            image: lastPreview.image,
            capturedAt: lastPreview.capturedAt,
            title: lastPreview.title,
            url: lastPreview.url,
            stale: true,
          };
        }
        throw new Error(
          msg.includes('timeout') || msg.includes('Timeout')
            ? 'Captura expirou (página navegando?)'
            : msg
        );
      }
      let title = '';
      try {
        title = await page.title();
      } catch {
        // A navegação pode trocar o contexto logo após a captura.
      }
      lastPreview = {
        capturedAt: new Date().toISOString(),
        title,
        url: page.url(),
        image,
      };
      return { image, ...lastPreview };
    })();

    try {
      return await captureInProgress;
    } finally {
      captureInProgress = null;
    }
  }

  function getStats() {
    return {
      ...stats,
      uptimeSec: Math.round((Date.now() - stats.startedAt) / 1000),
      currentUrl: page && !page.isClosed() ? page.url() : null,
      previewCapturedAt: lastPreview?.capturedAt || null,
      pageTitle: lastPreview?.title || '',
    };
  }

  return { workerId, run, stop, getStats, capturePreview, forceRecycleBrowser };
}

module.exports = { createWorker };
