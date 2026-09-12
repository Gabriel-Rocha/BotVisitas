'use strict';

const { createWorker } = require('./worker');
const { assignDeviceTypes, getProfile, summarizeDevices } = require('./devices');
const { sleep } = require('../utils/sleep');
const { createTuxlerLease, assertTuxlerReady, validateTuxlerActive } = require('./tuxler');
const {
  FREE_PLAN_MAX,
  resetTuxlerSocksCache,
  createHttpProxyLease,
  parseCountryList,
} = require('./proxy');
const { resetTuxlerNavGate, getTuxlerNavGate } = require('./navGate');
const { clearGeoCache } = require('./geo');
const { createMemoryWatch } = require('./memoryWatch');

function resolveConcurrency(config, strategy, logger) {
  const n = Math.max(1, Math.min(config.concurrency || 1, FREE_PLAN_MAX));
  const needsBrowser = strategy.requiresBrowser !== false;
  const httpProxyOn = Boolean(config.proxy?.enabled);
  const tuxlerOn = config.tuxler?.enabled;
  const rotMode = (config.tuxler?.rotateMode || 'skip').toLowerCase();

  if (needsBrowser && httpProxyOn) {
    logger.info(
      `Proxy HTTP: até ${n} workers com sticky exclusivo (sem SOCKS único do Tuxler).`
    );
    return n;
  }

  if (needsBrowser && tuxlerOn && rotMode !== 'skip' && n > 1) {
    logger.warn(
      'Tuxler com rotação automática: workers competem pelo mesmo IP — prefira skip ou CONCURRENCY=1.'
    );
  }

  if (needsBrowser && tuxlerOn && rotMode === 'skip' && n > 1) {
    logger.warn(
      `Tuxler: ${n} workers no MESMO SOCKS 23321. Para 12 IPs paralelos use PROXY_ENABLED=true + PROXY_LIST_URL.`
    );
  }

  return n;
}

function createPreviewGate(maxConcurrent = 2) {
  let active = 0;
  /** @type {Array<() => void>} */
  const waiters = [];
  return {
    acquire() {
      if (active < maxConcurrent) {
        active += 1;
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        waiters.push(() => {
          active += 1;
          resolve();
        });
      });
    },
    release() {
      active = Math.max(0, active - 1);
      const next = waiters.shift();
      if (next) next();
    },
  };
}

function createLoop({ config, strategy, logger }) {
  const workers = [];
  let proxyLease = null;
  let stopping = false;
  const startedAt = Date.now();
  let deviceSummary = {};
  const previewGate = createPreviewGate(2);
  let recycleInFlight = null;
  const memoryWatch = createMemoryWatch({
    logger,
    warnPct: config.memoryWarnPct ?? 0.82,
    criticalPct: config.memoryCriticalPct ?? 0.9,
    intervalMs: 20_000,
    onCritical: () => recycleAllBrowsers('watchdog-ram'),
  });

  let stallTimer = null;

  /** Vigia workers sem iteração — um await pendurado não pode custar horas de run. */
  function startStallWatch() {
    const maxMs = Math.max(60, Number(config.workerStallSec) || 300) * 1000;
    stallTimer = setInterval(() => {
      if (stopping) return;
      for (const worker of workers) {
        Promise.resolve(worker.kickIfStalled(maxMs)).catch((err) => {
          logger.warn(`Watchdog de travamento falhou em w${worker.workerId}:`, err.message);
        });
      }
    }, 30_000);
    stallTimer.unref?.();
  }

  async function recycleAllBrowsers(reason = 'watchdog-ram') {
    if (stopping || !workers.length) return;
    if (recycleInFlight) return recycleInFlight;
    recycleInFlight = (async () => {
      logger.warn(`Reciclando ${workers.length} Chromium(s) — ${reason}`);
      for (const worker of workers) {
        try {
          await worker.forceRecycleBrowser(reason);
        } catch (err) {
          logger.warn(`Falha ao reciclar w${worker.workerId}:`, err.message);
        }
        await sleep(400);
      }
    })().finally(() => {
      recycleInFlight = null;
    });
    return recycleInFlight;
  }

  async function run() {
    assertTuxlerReady(config, logger);

    const fallbackConcurrency = resolveConcurrency(config, strategy, logger);

    const { types, slots } = assignDeviceTypes({
      workerSlotsRaw: config.workerSlots,
      deviceMixRaw: config.deviceMix,
      concurrency: fallbackConcurrency,
      maxWorkers: undefined,
      logger,
    });

    deviceSummary = summarizeDevices(types);

    if (config.proxy?.enabled && strategy.requiresBrowser !== false) {
      clearGeoCache();
      proxyLease = await createHttpProxyLease(config, logger);
      const poolSize = proxyLease.size || 0;
      if (types.length > poolSize) {
        logger.warn(
          `CONCURRENCY=${types.length} > PROXY_MAX/pool=${poolSize} — truncando workers ao pool`
        );
        types.length = poolSize;
        deviceSummary = summarizeDevices(types);
      }
    } else if (config.tuxler?.enabled && strategy.requiresBrowser !== false) {
      resetTuxlerSocksCache();
      resetTuxlerNavGate();
      clearGeoCache();
      await validateTuxlerActive(config, logger, { strategy });
      proxyLease = createTuxlerLease(config, logger);
      const rotMode = (config.tuxler?.rotateMode || 'skip').toLowerCase();
      if (rotMode === 'skip') {
        logger.info('Tuxler: egress fixo — mantenha o app conectado; workers paralelos nos links');
      } else {
        logger.info('Tuxler: rotação automática no acquire/restart do browser');
      }
    }

    deviceSummary = summarizeDevices(types);

    // Nav gate só no Tuxler (SOCKS único). Proxy HTTP = 1 túnel por worker.
    const usingTuxler = Boolean(config.tuxler?.enabled && proxyLease);
    const configuredSlots = Number(config.tuxler?.navSlots) || 0;
    const navSlots = usingTuxler
      ? configuredSlots > 0
        ? configuredSlots
        : Math.min(4, types.length)
      : types.length;
    if (config.tuxler) config.tuxler.navSlots = navSlots;
    if (usingTuxler) {
      resetTuxlerNavGate();
      getTuxlerNavGate(navSlots);
      if (configuredSlots === 0 && types.length > 4) {
        logger.warn(
          `Tuxler: limitando gotos simultâneos a ${navSlots} (SOCKS único). ` +
            'Para 12 navegando juntos: PROXY_ENABLED=true + PROXY_LIST_URL / PROXY_SERVER.'
          );
      }
    }

    const mixLabel = Object.entries(deviceSummary)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');

    logger.info(
      `Pool de workers | concurrency=${types.length} | devices={${mixLabel}} | strategy=${strategy.name} | ` +
        `proxyHttp=${Boolean(config.proxy?.enabled && proxyLease)} | tuxler=${usingTuxler} | ` +
        `restartEvery=${config.browserRestartEvery || 0} | navSlots=${navSlots}`
    );
    if (process.platform === 'win32') {
      logger.info(
        'Overnight Windows: pause atualizações ativas (Configurações → Windows Update → Pausar) para o PC não reiniciar sozinho.'
      );
    }
    memoryWatch.start();

    const countryCycle = parseCountryList(config.workerCountries || '');
    for (let i = 0; i < types.length; i += 1) {
      const { type, profile } = getProfile(config.deviceProfiles, types[i]);
      const preferredCountry =
        slots[i]?.country ||
        (countryCycle.length ? countryCycle[i % countryCycle.length] : null);
      workers.push(
        createWorker({
          workerId: i,
          config,
          strategy,
          logger,
          proxyLease,
          deviceType: type,
          deviceProfile: profile,
          preferredCountry,
        })
      );
    }

    startStallWatch();

    const staggerMs = Math.max(
      0,
      Number.parseInt(process.env.WORKER_STAGGER_MS || '800', 10) || 0
    );
    if (staggerMs > 0 && workers.length > 1) {
      logger.info(`Start escalonado: +${staggerMs}ms entre workers (${workers.length} total)`);
    }
    const running = [];
    for (let i = 0; i < workers.length; i += 1) {
      running.push(workers[i].run());
      if (staggerMs > 0 && i < workers.length - 1) {
        await sleep(staggerMs);
      }
    }
    await Promise.all(running);
  }

  async function stop() {
    if (stopping) return;
    stopping = true;
    memoryWatch.stop();
    if (stallTimer) clearInterval(stallTimer);
    logger.info('Encerrando workers...', JSON.stringify(getStats()));
    await Promise.race([
      Promise.all(workers.map((w) => w.stop())),
      sleep(15_000).then(() => {
        logger.warn('Stop forçado após 15s — alguns workers podem ainda encerrar');
      }),
    ]);
  }

  function getStats() {
    const parts = workers.map((w) => w.getStats());
    return {
      concurrency: workers.length,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      ok: parts.reduce((s, p) => s + p.ok, 0),
      offers: parts.reduce((s, p) => s + (p.offers || 0), 0),
      intermediate: parts.reduce((s, p) => s + (p.intermediate || 0), 0),
      errors: parts.reduce((s, p) => s + p.errors, 0),
      clicks: parts.reduce((s, p) => s + (p.clicks || 0), 0),
      adClicks: parts.reduce((s, p) => s + (p.adClicks || 0), 0),
      siteClicks: parts.reduce((s, p) => s + (p.siteClicks || 0), 0),
      externalClicks: parts.reduce((s, p) => s + (p.externalClicks || 0), 0),
      iterations: parts.reduce((s, p) => s + p.iterations, 0),
      browserRestarts: parts.reduce((s, p) => s + (p.browserRestarts || 0), 0),
      devices: deviceSummary,
      memory: memoryWatch.getSnapshot(),
      workers: parts,
    };
  }

  async function captureWorkerPreview(workerId) {
    const worker = workers.find((item) => item.workerId === workerId);
    if (!worker) throw new Error(`Worker w${workerId} não encontrado`);
    await previewGate.acquire();
    try {
      return await worker.capturePreview();
    } finally {
      previewGate.release();
    }
  }

  return { run, stop, getStats, captureWorkerPreview };
}

module.exports = { createLoop, resolveConcurrency };
