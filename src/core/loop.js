'use strict';

const { launchBrowser, closeBrowser } = require('./browser');
const { createSession, createVisitorContext, closePage, closeContext } = require('./session');
const {
  createBaseIdentity,
  loadOrCreateBaseIdentity,
  finalizeIdentity,
  saveIdentity,
  persistCookies,
  nextVisitor,
} = require('./identity');
const { computeGapMs } = require('./stealth');
const { sleep } = require('../utils/sleep');

function createLoop({ config, strategy, logger }) {
  const needsBrowser = strategy.requiresBrowser !== false;
  const rotate = !config.session.persist;

  const stats = {
    startedAt: Date.now(),
    iterations: 0,
    ok: 0,
    errors: 0,
  };

  let browser = null;
  let context = null;
  let page = null;
  let identity = null;
  let chromeVersion = null;
  let stopping = false;

  async function teardownBrowser() {
    await closePage(page);
    page = null;
    await closeContext(context);
    context = null;
    await closeBrowser(browser, logger);
    browser = null;
    chromeVersion = null;
    identity = null;
  }

  async function ensureBrowser() {
    if (!needsBrowser) return;
    if (browser && browser.isConnected()) return;
    await teardownBrowser();
    const launchIdentity = createBaseIdentity(config);
    browser = await launchBrowser(config, logger, launchIdentity);
    chromeVersion = await browser.version();
    logger.debug(`Chrome reportado: ${chromeVersion}`);
  }

  async function openVisit() {
    await ensureBrowser();
    if (!needsBrowser) return;

    if (!rotate) {
      if (page && !page.isClosed()) return;
      identity = loadOrCreateBaseIdentity(config, logger);
      identity = finalizeIdentity(identity, chromeVersion);
      saveIdentity(config, identity);
      page = await createSession(browser, config, logger, identity);
      return;
    }

    identity = nextVisitor(config, chromeVersion, logger);
    context = await createVisitorContext(browser, identity);
    page = await createSession(context, config, logger, identity);
  }

  async function finishVisit() {
    if (!needsBrowser) return;
    if (!rotate) {
      await persistCookies(page, config, logger);
      return;
    }
    await closePage(page);
    page = null;
    await closeContext(context);
    context = null;
    identity = null;
  }

  async function maybeRestartBrowser() {
    if (!needsBrowser) return;
    const every = config.browserRestartEvery;
    if (!every || every <= 0) return;
    if (stats.iterations === 0 || stats.iterations % every !== 0) return;

    logger.info(`Restart periódico do browser (#${stats.iterations})`);
    await teardownBrowser();
  }

  async function tick() {
    await openVisit();
    try {
      const result = await strategy.run(page, { config, logger, identity });
      if (result?.ok) stats.ok += 1;
      else stats.errors += 1;
    } catch (err) {
      stats.errors += 1;
      logger.error('Erro na iteração:', err.message);
      logger.debug(err.stack);
    } finally {
      stats.iterations += 1;
      await finishVisit();
    }
    await maybeRestartBrowser();
  }

  return null; // sem cap
}

function createLoop({ config, strategy, logger }) {
  const workers = [];
  let proxyLease = null;
  let stopping = false;
  const startedAt = Date.now();
  let deviceSummary = {};

  async function run() {
    assertProxyReady(config.proxy, logger);

    const proxyCap = resolveProxyCap(config, strategy);
    const fallbackConcurrency = resolveConcurrency(config, strategy, logger);

    const { types, fromMix } = assignDeviceTypes({
      deviceMixRaw: config.deviceMix,
      concurrency: fallbackConcurrency,
      maxWorkers: proxyCap != null ? proxyCap : undefined,
      logger,
    });

    // Sem mix: resolveConcurrency já aplicou caps.
    // Com mix: assignDeviceTypes já truncou ao proxyCap.
    if (!fromMix && types.length !== fallbackConcurrency) {
      // não deve acontecer
    }

    deviceSummary = summarizeDevices(types);

    if (config.proxy?.enabled) {
      const { pool } = buildProxyPool(config.proxy);
      proxyLease = createProxyLease(pool);
    }

    const mixLabel = Object.entries(deviceSummary)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');

    logger.info(
      `Loop iniciado | strategy=${strategy.name} | browser=${needsBrowser ? 'sim' : 'não'} | stealth=${config.stealth.enabled} | visitantes=${rotate ? 'novos a cada visita' : 'sessão persistente'}`
    );

    while (!stopping) {
      try {
        await tick();
      } catch (err) {
        stats.errors += 1;
        logger.error('Falha ao preparar visita:', err.message);
        logger.debug(err.stack);
        await teardownBrowser();
      }

      if (stopping) break;

      const waitMs = computeGapMs(config);
      if (waitMs > 0) {
        logger.info(`Aguardando ${(waitMs / 1000).toFixed(1)}s até a próxima iteração...`);
        await sleep(waitMs);
      }
    }

    await Promise.all(workers.map((w) => w.run()));
  }

  async function stop() {
    if (stopping) return;
    stopping = true;
    logger.info('Encerrando loop...', JSON.stringify(getStats()));
    if (needsBrowser) {
      if (!rotate) await persistCookies(page, config, logger);
      await teardownBrowser();
    }
  }

  function getStats() {
    const parts = workers.map((w) => w.getStats());
    return {
      concurrency: workers.length,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      ok: parts.reduce((s, p) => s + p.ok, 0),
      errors: parts.reduce((s, p) => s + p.errors, 0),
      iterations: parts.reduce((s, p) => s + p.iterations, 0),
      devices: deviceSummary,
      workers: parts,
    };
  }

  async function captureWorkerPreview(workerId) {
    const worker = workers.find((item) => item.workerId === workerId);
    if (!worker) throw new Error(`Worker w${workerId} não encontrado`);
    return worker.capturePreview();
  }

  return { run, stop, getStats, captureWorkerPreview };
}

module.exports = { createLoop, resolveConcurrency };
