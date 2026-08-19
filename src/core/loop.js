'use strict';

const {
  buildProxyPool,
  createProxyLease,
  assertProxyReady,
  FREE_PLAN_MAX,
} = require('./proxy');
const { createWorker } = require('./worker');
const { assignDeviceTypes, getProfile, summarizeDevices } = require('./devices');

/**
 * Resolve quantos workers subir (quando DEVICE_MIX não define a contagem).
 * - dryRun sem proxy: CONCURRENCY livre (default 5)
 * - directLink sem proxy: força 1 (mesmo IP sem ganho)
 * - com proxy: min(CONCURRENCY, poolSize, 10)
 */
function resolveConcurrency(config, strategy, logger) {
  let n = Math.max(1, config.concurrency || 1);
  const needsBrowser = strategy.requiresBrowser !== false;
  const proxyOn = config.proxy?.enabled;

  if (needsBrowser && !proxyOn) {
    if (n > 1) {
      logger.warn(
        'CONCURRENCY>1 sem PROXY_ENABLED — forçando 1 worker (mesmo IP sem ganho).'
      );
    }
    return 1;
  }

  if (proxyOn) {
    const { pool } = buildProxyPool(config.proxy);
    const capped = Math.min(n, pool.length, FREE_PLAN_MAX);
    if (capped < n) {
      logger.warn(
        `CONCURRENCY=${n} reduzido para ${capped} (pool=${pool.length}, max=${FREE_PLAN_MAX}).`
      );
    }
    return Math.max(1, capped);
  }

  return n;
}

function resolveProxyCap(config, strategy) {
  const needsBrowser = strategy.requiresBrowser !== false;
  const proxyOn = config.proxy?.enabled;

  if (needsBrowser && !proxyOn) return 1;

  if (proxyOn) {
    const { pool } = buildProxyPool(config.proxy);
    return Math.min(pool.length, FREE_PLAN_MAX);
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
      `Pool de workers | concurrency=${types.length} | devices={${mixLabel}} | strategy=${strategy.name} | proxy=${Boolean(proxyLease)}`
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

    await Promise.all(workers.map((w) => w.run()));
  }

  async function stop() {
    if (stopping) return;
    stopping = true;
    logger.info('Encerrando workers...', JSON.stringify(getStats()));
    await Promise.all(workers.map((w) => w.stop()));
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
