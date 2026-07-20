'use strict';

const {
  buildProxyPool,
  createProxyLease,
  assertProxyReady,
  FREE_PLAN_MAX,
} = require('./proxy');
const { createWorker } = require('./worker');

/**
 * Resolve quantos workers subir.
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

function createLoop({ config, strategy, logger }) {
  const workers = [];
  let proxyLease = null;
  let stopping = false;
  const startedAt = Date.now();

  async function run() {
    assertProxyReady(config.proxy, logger);

    const concurrency = resolveConcurrency(config, strategy, logger);

    if (config.proxy?.enabled) {
      const { pool } = buildProxyPool(config.proxy);
      proxyLease = createProxyLease(pool);
    }

    logger.info(
      `Pool de workers | concurrency=${concurrency} | strategy=${strategy.name} | proxy=${Boolean(proxyLease)}`
    );

    for (let i = 0; i < concurrency; i += 1) {
      workers.push(
        createWorker({
          workerId: i,
          config,
          strategy,
          logger,
          proxyLease,
        })
      );
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
      workers: parts,
    };
  }

  return { run, stop, getStats };
}

module.exports = { createLoop, resolveConcurrency };
