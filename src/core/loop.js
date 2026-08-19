'use strict';

const {
  buildProxyPool,
  createProxyLease,
  assertProxyReady,
  FREE_PLAN_MAX,
} = require('./proxy');
const { createWorker } = require('./worker');
const { assignDeviceTypes, getProfile, summarizeDevices } = require('./devices');
const { isFlaggedAnonymousIp, lookupGeoViaProxy, lookupGeo } = require('./geo');

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

/**
 * Remove IPs de datacenter/VPN/anon do pool. Esses disparam
 * "anonymous proxy detected" no site alvo — stealth de browser não resolve.
 */
async function selectUsableProxyPool(config, logger) {
  const { pool } = buildProxyPool(config.proxy);
  if (!pool.length) return { pool: [], usedDirect: false };

  if (!config.proxy.skipFlagged) {
    logger.warn(
      'PROXY_SKIP_FLAGGED=false — IPs de datacenter/anon vão para o alvo e costumam responder "anonymous proxy detected".'
    );
    return { pool, usedDirect: false };
  }

  const clean = [];
  for (const proxy of pool) {
    try {
      const geo = await lookupGeoViaProxy(proxy);
      if (isFlaggedAnonymousIp(geo)) {
        logger.warn(
          `Proxy ${proxy.label} descartado | egress=${geo.ip || '?'} | ` +
            `proxy=${Boolean(geo.isProxy)} hosting=${Boolean(geo.isHosting)}` +
            (geo.isp ? ` | isp=${geo.isp}` : '')
        );
        continue;
      }
      logger.info(
        `Proxy ${proxy.label} limpo | egress=${geo.ip || '?'} | cc=${geo.countryCode || '?'}`
      );
      clean.push(proxy);
    } catch (err) {
      logger.warn(`Proxy ${proxy.label} falhou no probe (${err.message}) — descartado`);
    }
  }

  if (clean.length) return { pool: clean, usedDirect: false };

  if (config.proxy.fallbackDirect) {
    try {
      const egress = await lookupGeo(null);
      if (isFlaggedAnonymousIp(egress)) {
        throw new Error(
          'Nenhum proxy limpo e o IP desta máquina também é datacenter/anon ' +
            `(${egress.ip || '?'} isp=${egress.isp || '?'}). ` +
            'Não vou acessar o alvo para não disparar "anonymous proxy detected". ' +
            'Troque PROXY_LIST por residencial/mobile.'
        );
      }
    } catch (err) {
      if (/Não vou acessar/.test(err.message)) throw err;
      logger.warn(`Probe do IP local falhou (${err.message}) — seguindo direto com cautela`);
    }
    logger.warn(
      'Nenhum proxy limpo no pool — conexão direta (sem proxy) para não disparar "anonymous proxy detected".'
    );
    return { pool: [], usedDirect: true };
  }

  throw new Error(
    'Nenhum proxy limpo no pool (todos datacenter/anon ou probe falhou). ' +
      'Use residencial/mobile ou PROXY_FALLBACK_DIRECT=true. Ver docs/09-proxies-webshare.md'
  );
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

    let effectiveProxyOn = Boolean(config.proxy?.enabled);
    if (config.proxy?.enabled && strategy.requiresBrowser !== false) {
      const selected = await selectUsableProxyPool(config, logger);
      if (selected.usedDirect) {
        effectiveProxyOn = false;
        proxyLease = null;
      } else {
        proxyLease = createProxyLease(selected.pool);
        const capped = Math.min(types.length, selected.pool.length, FREE_PLAN_MAX);
        if (capped < types.length) {
          logger.warn(
            `Workers reduzidos de ${types.length} para ${capped} após filtrar proxies anônimos.`
          );
          types.length = capped;
        }
      }
    } else if (config.proxy?.enabled) {
      const { pool } = buildProxyPool(config.proxy);
      proxyLease = createProxyLease(pool);
    }

    if (!effectiveProxyOn && strategy.requiresBrowser !== false && types.length > 1) {
      logger.warn('Sem proxy limpo — 1 worker (mesmo IP).');
      types.length = 1;
    }

    deviceSummary = summarizeDevices(types);

    const mixLabel = Object.entries(deviceSummary)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');

    logger.info(
      `Pool de workers | concurrency=${types.length} | devices={${mixLabel}} | strategy=${strategy.name} | proxy=${Boolean(proxyLease)}`
    );

    for (let i = 0; i < types.length; i += 1) {
      const { type, profile } = getProfile(config.deviceProfiles, types[i]);
      workers.push(
        createWorker({
          workerId: i,
          config,
          strategy,
          logger,
          proxyLease,
          deviceType: type,
          deviceProfile: profile,
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

module.exports = { createLoop, resolveConcurrency, selectUsableProxyPool };
