'use strict';

const { createWorker } = require('./worker');
const { assignDeviceTypes, getProfile, summarizeDevices } = require('./devices');
const { sleep } = require('../utils/sleep');
const { createTuxlerLease, assertTuxlerReady, validateTuxlerActive, validateTuxlerSystem } = require('./tuxler');
const { FREE_PLAN_MAX, resetTuxlerSocksCache } = require('./proxy');
const { clearGeoCache } = require('./geo');
const { createMemoryWatch } = require('./memoryWatch');
const { getCurrentPublicIp } = require('./ip');
const { createVisitGate } = require('./visitGate');

function resolveConcurrency(config, strategy, logger) {
  const egress = String(config.egress || 'tuxler-system').toLowerCase();
  const hardCap = egress === 'native' ? 6 : FREE_PLAN_MAX;
  const n = Math.max(1, Math.min(config.concurrency || 1, hardCap));
  const needsBrowser = strategy.requiresBrowser !== false;

  if (needsBrowser && egress === 'native') {
    logger.info(
      `EGRESS=native | ${n} worker(s) pela placa de rede (ASN da operadora). Teto CONCURRENCY=6.`
    );
  }

  if (needsBrowser && egress === 'tuxler-system') {
    logger.info(
      `EGRESS=tuxler-system | ${n} worker(s) herdam proxy do Windows (estilo v1). ` +
        `VISIT_SERIAL=${Boolean(config.visitSerial)} gap=${config.visitGapMinSec}-${config.visitGapMaxSec}s.`
    );
  }

  if (needsBrowser && egress === 'tuxler') {
    const rotMode = (config.tuxler?.rotateMode || 'skip').toLowerCase();
    if (rotMode === 'skip') {
      logger.info(
        `EGRESS=tuxler skip: ${n} workers (SOCKS explícito; mesmo IP VPN).`
      );
    } else {
      logger.warn(
        'EGRESS=tuxler com rotação automática: workers competem pelo mesmo túnel SOCKS.'
      );
    }
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
  const visitGate = createVisitGate({ config, logger });
  let recycleInFlight = null;
  const memoryWatch = createMemoryWatch({
    logger,
    warnPct: config.memoryWarnPct ?? 0.82,
    criticalPct: config.memoryCriticalPct ?? 0.9,
    intervalMs: 20_000,
    onCritical: () => recycleAllBrowsers('watchdog-ram'),
  });

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
    const egress = String(config.egress || 'tuxler-system').toLowerCase();

    if (egress === 'tuxler') {
      assertTuxlerReady(config, logger);
    }

    const fallbackConcurrency = resolveConcurrency(config, strategy, logger);

    const { types, slots } = assignDeviceTypes({
      workerSlotsRaw: config.workerSlots,
      deviceMixRaw: config.deviceMix,
      concurrency: fallbackConcurrency,
      maxWorkers: egress === 'native' ? 6 : undefined,
      logger,
    });

    deviceSummary = summarizeDevices(types);

    if (egress === 'tuxler' && strategy.requiresBrowser !== false) {
      resetTuxlerSocksCache();
      clearGeoCache();
      await validateTuxlerActive(config, logger, { strategy });
      proxyLease = createTuxlerLease(config, logger);
      const rotMode = (config.tuxler?.rotateMode || 'skip').toLowerCase();
      if (rotMode === 'skip') {
        logger.info('Tuxler SOCKS: mantenha o app conectado');
      } else {
        logger.info('Tuxler: rotação automática no acquire/restart do browser');
      }
    } else if (egress === 'tuxler-system') {
      proxyLease = null;
      if (strategy.requiresBrowser !== false) {
        await validateTuxlerSystem(config, logger, { strategy });
      }
    } else if (egress === 'native') {
      proxyLease = null;
      try {
        const ip = await getCurrentPublicIp({ force: true });
        logger.info(`EGRESS=native | IP público ${ip} (placa de rede — sem SOCKS)`);
      } catch (err) {
        logger.warn(`EGRESS=native | não foi possível ler IP público: ${err.message}`);
      }
    }

    const cadence = visitGate.snapshot();
    logger.info(
      `Cadência | serial=${Boolean(config.visitSerial)} | gap=${config.visitGapMinSec}-${config.visitGapMaxSec}s | ` +
        `burst a cada ${config.burstEveryHits} | soft=${config.hitSoftCapDay}/+${config.hitSoftPauseHours}h | hard=${config.hitHardCapDay} | ` +
        `hoje=${cadence.hitsToday}`
    );

    deviceSummary = summarizeDevices(types);

    const mixLabel = Object.entries(deviceSummary)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');

    logger.info(
      `Pool de workers | concurrency=${types.length} | devices={${mixLabel}} | strategy=${strategy.name} | egress=${egress} | restartEvery=${config.browserRestartEvery || 0}`
    );
    if (process.platform === 'win32') {
      logger.info(
        'Overnight Windows: pause atualizações ativas (Configurações → Windows Update → Pausar) para o PC não reiniciar sozinho.'
      );
    }
    memoryWatch.start();

    for (let i = 0; i < types.length; i += 1) {
      const { type, profile } = getProfile(config.deviceProfiles, types[i]);
      workers.push(
        createWorker({
          workerId: i,
          config,
          strategy,
          logger,
          proxyLease,
          visitGate,
          deviceType: type,
          deviceProfile: profile,
          preferredCountry: slots[i]?.country || null,
        })
      );
    }

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
    const cadence = visitGate.snapshot();
    return {
      concurrency: workers.length,
      egress: config.egress || 'tuxler-system',
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      ok: parts.reduce((s, p) => s + p.ok, 0),
      offers: parts.reduce((s, p) => s + (p.offers || 0), 0),
      intermediate: parts.reduce((s, p) => s + (p.intermediate || 0), 0),
      errors: parts.reduce((s, p) => s + p.errors, 0),
      clicks: parts.reduce((s, p) => s + (p.clicks || 0), 0),
      iterations: parts.reduce((s, p) => s + p.iterations, 0),
      browserRestarts: parts.reduce((s, p) => s + (p.browserRestarts || 0), 0),
      devices: deviceSummary,
      memory: memoryWatch.getSnapshot(),
      cadence,
      visitQuality: aggregateVisitQuality(parts, cadence),
      workers: parts,
    };
  }

  function aggregateVisitQuality(parts, cadence) {
    let withCookies = 0;
    let withoutCallback = 0;
    let sessions = 0;
    let publicIp = null;
    let privacyType = null;
    const sessionMs = [];
    for (const p of parts) {
      const vq = p.visitQuality || {};
      sessions += vq.sessions || 0;
      withCookies += vq.withCookies || 0;
      withoutCallback += vq.withoutCallback || 0;
      if (vq.publicIp) publicIp = vq.publicIp;
      if (vq.privacyType) privacyType = vq.privacyType;
      if (Array.isArray(vq.sessionMs)) sessionMs.push(...vq.sessionMs);
    }
    sessionMs.sort((a, b) => a - b);
    const p95 =
      sessionMs.length > 0
        ? sessionMs[Math.min(sessionMs.length - 1, Math.floor(sessionMs.length * 0.95))]
        : null;
    return {
      sessions,
      cookieRate: sessions ? Math.round((withCookies / sessions) * 1000) / 10 : 0,
      noCallbackRate: sessions ? Math.round((withoutCallback / sessions) * 1000) / 10 : 0,
      hitsToday: cadence?.hitsToday ?? 0,
      hitCap: config.hitSoftCapDay ?? 1000,
      hardCap: config.hitHardCapDay ?? 2500,
      softPauseUntil: cadence?.softPauseUntil || null,
      publicIp,
      privacyType,
      sessionMsP95: p95,
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
