'use strict';

const { launchBrowser, closeBrowser, killProcessTree } = require('./browser');
const { createSession, recreateSession } = require('./session');
const { resolveSessionLocale } = require('./geo');
const { randomInt } = require('../utils/random');
const { sleep, sleepInterruptible, isAbortError } = require('../utils/sleep');
const { isTransientProxyError } = require('../utils/netErrors');
const { TuxlerInactiveError } = require('./tuxler');
const { waitForTuxlerSocks, resetTuxlerSocksCache } = require('./proxy');

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
    lastProgressAt: Date.now(),
    clicks: 0,
    // Cliques verificados por destino — CTR de ad não se mistura com link do site.
    adClicks: 0,
    siteClicks: 0,
    externalClicks: 0,
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
  /** Mutex: evita double-close / Chromium órfão sob watchdog + tick. */
  let recycling = null;
  /** Conta visitas neste Chromium (ok + erro) p/ BROWSER_RESTART_EVERY. */
  let visitsSinceBrowserStart = 0;

  function log(level, ...args) {
    logger[level](prefix, ...args);
  }

  async function acquireProxy() {
    if (!proxyLease) return null;
    const proxy = await proxyLease.acquire(preferredCountry);
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

  async function acquireUsableProxy() {
    if (!proxyLease) return null;
    activeProxy = await acquireProxy();
    const hints = await resolveLocaleForProxy(activeProxy);
    return { proxy: activeProxy, hints };
  }

  async function resolveLocaleForProxy(proxy) {
    const hints = await resolveSessionLocale({
      egressGeo: proxy?.geo || null,
      // HTTP/SOCKS: passa o endpoint completo (auth) para medir egress via proxy.
      proxy: proxy?.isTuxler
        ? null
        : proxy
          ? {
              host: proxy.host,
              port: proxy.port,
              username: proxy.username,
              password: proxy.password,
              label: proxy.label,
              protocol: proxy.protocol,
            }
          : null,
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
    // Label do slot é só hint do .env; mostra a geo real do egress.
    if (proxy && hints.countryCode) {
      stats.proxyLabel = `${proxy.host}:${proxy.port} (${String(hints.countryCode).toLowerCase()})`;
    }
    return hints;
  }

  async function ensureBrowser() {
    if (!needsBrowser) return;
    if (recycling) await recycling;
    await startBrowser();
  }

  /**
   * Sobe Chromium + sessão. Não espera `recycling`: é chamada de dentro dele,
   * e aguardar ali travava o worker para sempre (deadlock circular).
   */
  async function startBrowser() {
    if (!needsBrowser) return;
    if (browser && browser.isConnected()) return;

    log('info', 'Subindo Chromium...');

    await closeBrowser(browser, {
      info: (...a) => log('info', ...a),
      warn: (...a) => log('warn', ...a),
    });
    browser = null;
    page = null;

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
      activeProxy,
      { lang: localeHints.locale }
    );

    browser = launched.browser;
    visitsSinceBrowserStart = 0;
    page = await createSession(
      browser,
      config,
      {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
        debug: (...a) => log('debug', ...a),
      },
      activeProxy,
      device,
      localeHints
    );
  }

  async function recycleBrowser(reason = 'periódico') {
    if (!needsBrowser) return;
    if (recycling) return recycling;

    recycling = (async () => {
      log('info', `Reciclando Chromium (${reason}) #${stats.iterations}`);
      const closing = browser;
      browser = null;
      page = null;
      lastPreview = null;
      await closeBrowser(closing, {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
        debug: (...a) => log('debug', ...a),
      });

      const forceRotate = reason === 'empty-page';
      const tuxlerSkip =
        config.tuxler?.enabled && (config.tuxler?.rotateMode || 'skip') === 'skip';
      const keepHttpSticky = Boolean(config.proxy?.enabled) && !forceRotate;
      if (proxyLease && ((!tuxlerSkip && !keepHttpSticky) || forceRotate)) {
        releaseProxy();
        try {
          await acquireUsableProxy();
        } catch (err) {
          log('warn', 'Falha ao rotacionar proxy no restart — tentando de novo:', err.message);
          await sleep(2000);
          await acquireUsableProxy();
        }
      }

      stats.browserRestarts += 1;
      if (!stopping) {
        try {
          await startBrowser();
        } catch (err) {
          log('warn', `Relançar Chromium falhou (${err.message}) — nova tentativa na próxima visita`);
          browser = null;
          page = null;
        }
      }
    })().finally(() => {
      recycling = null;
    });

    return recycling;
  }

  async function restartBrowserWithNewProxy() {
    await recycleBrowser('periódico');
  }

  async function maybeRestartBrowser() {
    if (!needsBrowser || stopping) return;
    const base = Number(config.browserRestartEvery) || 0;
    if (!base || base <= 0) return;
    // Jitter por worker — evita 12 Chromiums reiniciando juntos (parece “travado”).
    const every = base + (workerId % 7);
    if (visitsSinceBrowserStart < every) return;
    await recycleBrowser('periódico');
  }

  /**
   * Watchdog RAM: aborta a visita e mata o Chromium na hora
   * (antes só setava flag e esperava o fim da visita = RAM seguia subindo).
   */
  async function forceRecycleBrowser(reason = 'watchdog-ram') {
    if (!needsBrowser) return;
    recycleRequested = null;
    abortController?.abort();
    if (page && !page.isClosed()) {
      try {
        await page.stopLoading();
      } catch {
        // ignore
      }
    }
    await recycleBrowser(reason);
  }

  async function afterVisitHousekeeping() {
    if (recycling) await recycling;
    visitsSinceBrowserStart += 1;
    if (recycleRequested) {
      const reason = recycleRequested;
      recycleRequested = null;
      await recycleBrowser(reason);
      return;
    }
    await maybeRestartBrowser();
  }

  async function releaseTuxlerTurn() {
    if (!proxyLease) return;
    await closeBrowser(browser, {
      info: (...a) => log('info', ...a),
      warn: (...a) => log('warn', ...a),
    });
    browser = null;
    page = null;
    sessionLocale = null;
    releaseProxy();
  }

  async function recoverPage(reason) {
    if (!browser || !browser.isConnected()) {
      log('warn', `${reason} — Chromium morto, reciclando (sem soltar Tuxler)`);
      await recycleBrowser(reason);
      return;
    }
    const sessionLog = {
      info: (...a) => log('info', ...a),
      debug: (...a) => log('debug', ...a),
    };
    try {
      page = await recreateSession(
        browser,
        page,
        config,
        sessionLog,
        activeProxy,
        device,
        sessionLocale
      );
    } catch (err) {
      log('warn', `recreateSession falhou (${err.message}) — nova aba no mesmo Chromium`);
      try {
        page = await createSession(
          browser,
          config,
          sessionLog,
          activeProxy,
          device,
          sessionLocale
        );
      } catch (err2) {
        log('warn', `Nova aba falhou (${err2.message}) — reciclando Chromium`);
        await recycleBrowser(reason);
      }
    }
  }

  async function waitForTuxlerRecovery(reason) {
    if (!config.tuxler?.enabled) return;
    const waitMs = config.tuxler?.socksWaitMs ?? 20_000;
    log('warn', `${reason} — aguardando SOCKS Tuxler`);
    resetTuxlerSocksCache();
    await waitForTuxlerSocks({
      config,
      logger: {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
      },
      maxWaitMs: waitMs,
    });
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
    } catch (err) {
      abortController?.abort();
      if (page && !page.isClosed()) {
        try {
          await page.stopLoading();
        } catch {
          // ignore
        }
      }
      if (err.code === 'VISIT_TIMEOUT') {
        await Promise.race([runPromise.catch(() => {}), sleep(1_500)]);
      }
      throw err;
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
      const visitClicks =
        result.meta?.verifiedClicks ??
        result.meta?.clickCount ??
        0;
      stats.clicks += visitClicks;
      const targets = result.meta?.clickTargets || {};
      stats.adClicks += targets.ad || 0;
      stats.siteClicks += targets.internal || 0;
      stats.externalClicks += targets.external || 0;
      if (visitClicks > 0) {
        log(
          'info',
          `Cliques VERIFICADOS na visita: ${visitClicks} ` +
            `(anúncio=${targets.ad || 0} site=${targets.internal || 0} externo=${targets.external || 0}) | ` +
            `total worker: ${stats.clicks} (anúncio ${stats.adClicks})`
        );
      } else if ((result.meta?.clickCount || 0) > 0) {
        log(
          'warn',
          `Cliques disparados=${result.meta.clickCount} mas 0 verificados (CPM provavelmente não conta)`
        );
      }
    } else {
      // intermediate / dead-end: não infla OK (impressões do painel)
      if (result && result.quality === 'intermediate') {
        stats.intermediate += 1;
        log('warn', 'Visita intermediate — não conta como OK/impressão');
      } else {
        stats.errors += 1;
      }
    }

    stats.iterations += 1;
    stats.lastProgressAt = Date.now();

    // Smartlink blank no Webshare: troca IP agora (senão fica “parado” no mesmo proxy morto).
    if (
      needsBrowser &&
      result?.meta?.emptyUi &&
      config.proxy?.enabled &&
      proxyLease
    ) {
      log('warn', 'Página vazia — trocando proxy sticky');
      await recycleBrowser('empty-page');
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
      visitsSinceBrowserStart += 1;
      await releaseTuxlerTurn();
    } else {
      await afterVisitHousekeeping();
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
        if (stopping) break;

        // Abort do watchdog-ram NÃO encerra o worker (antes matava o loop).
        if (isAbortError(err)) {
          log('warn', 'Visita interrompida (recycle/watchdog) — reabrindo se preciso');
          if (recycling) await recycling;
          else if (needsBrowser && (!browser || !browser.isConnected())) {
            try {
              await ensureBrowser();
            } catch (e) {
              log('warn', 'Reabrir após abort falhou:', e.message);
            }
          }
          if (needsBrowser && !stopping) await afterVisitHousekeeping();
        } else if (err.code === 'VISIT_TIMEOUT' || err.code === 'NAV_GATE_TIMEOUT') {
          stats.errors += 1;
          stats.iterations += 1;
          stats.lastProgressAt = Date.now();
          log(
            'warn',
            err.code === 'NAV_GATE_TIMEOUT'
              ? 'SOCKS saturado (nav gate) — próximo link'
              : 'Iteração estourou VISIT_MAX_SEC — próximo link'
          );
          await recoverPage(err.code === 'NAV_GATE_TIMEOUT' ? 'nav-gate' : 'visita-timeout');
          if (!stopping) await afterVisitHousekeeping();
        } else if (
          err instanceof TuxlerInactiveError ||
          err.code === 'TUXLER_SOCKS_OFFLINE' ||
          err.code === 'TUXLER_INACTIVE'
        ) {
          stats.errors += 1;
          log('error', 'Erro na iteração:', err.message);
          await waitForTuxlerRecovery(err.message);
        } else {
          stats.errors += 1;
          log('error', 'Erro na iteração:', err.message);
          log('debug', err.stack);

          if (needsBrowser) {
            const tuxlerSkip =
              config.tuxler?.enabled && (config.tuxler?.rotateMode || 'skip') === 'skip';
            const rotateProxy =
              Boolean(proxyLease) && isTransientProxyError(err) && !tuxlerSkip;
            try {
              // Watchdog / recycle já matou o Chromium no meio da visita.
              if (!browser || !browser.isConnected()) {
                await ensureBrowser();
              } else if (rotateProxy) {
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
              if (tuxlerSkip) await recycleBrowser('sessão-morta');
              else await releaseTuxlerTurn();
            }
            // Erros também contam p/ restart — antes o Chromium vivia forever no catch.
            if (!stopping) await afterVisitHousekeeping();
          }
        }
      }

      if (stopping) break;

      // Novo controller: abort do recycle não pode matar o sleep entre visitas.
      abortController = new AbortController();
      const waitSec = randomInt(config.intervalMinSec, config.intervalMaxSec);
      log('info', `Aguardando ${waitSec}s...`);
      try {
        await sleepInterruptible(waitSec * 1000, {
          shouldStop: () => stopping,
          signal: abortController?.signal,
        });
      } catch (err) {
        if (stopping || (isAbortError(err) && stopping)) break;
        if (isAbortError(err)) {
          abortController = new AbortController();
          continue;
        }
        break;
      }
    }
  }

  async function stop() {
    stopping = true;
    abortController?.abort();
    log('info', 'Encerrando...', JSON.stringify(getStats()));
    // Solta navegação pendente antes do close — evita "workers ainda ativos" no shutdown.
    if (page && !page.isClosed()) {
      try {
        await page.stopLoading();
      } catch {
        // ignore
      }
    }
    if (needsBrowser) {
      await closeBrowser(
        browser,
        {
          info: (...a) => log('info', ...a),
          warn: (...a) => log('warn', ...a),
          debug: (...a) => log('debug', ...a),
        },
        { forceMs: 2_500 }
      );
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
    let currentUrl = null;
    try {
      if (page && !page.isClosed()) currentUrl = page.url();
    } catch {
      currentUrl = null;
    }
    return {
      ...stats,
      uptimeSec: Math.round((Date.now() - stats.startedAt) / 1000),
      currentUrl,
      previewCapturedAt: lastPreview?.capturedAt || null,
      pageTitle: lastPreview?.title || '',
    };
  }

  /**
   * Destrava worker parado (nenhuma iteração há `maxMs`): aborta a visita, mata
   * o Chromium no PID e solta o mutex de recycle. Sem isso, um await pendurado
   * congela o worker até o operador reiniciar tudo.
   */
  async function kickIfStalled(maxMs) {
    if (!needsBrowser || stopping) return false;
    const idleMs = Date.now() - (stats.lastProgressAt || stats.startedAt);
    if (idleMs < maxMs) return false;

    log('warn', `Travado há ${Math.round(idleMs / 1000)}s sem iteração — forçando reinício`);
    try {
      abortController?.abort();
    } catch {
      // ignore
    }
    const pid = browser?.process?.()?.pid;
    if (pid) killProcessTree(pid, { warn: (...a) => log('warn', ...a) });
    browser = null;
    page = null;
    recycling = null;
    stats.lastProgressAt = Date.now();
    return true;
  }

  return {
    workerId,
    run,
    stop,
    getStats,
    capturePreview,
    forceRecycleBrowser,
    kickIfStalled,
  };
}

module.exports = { createWorker };
