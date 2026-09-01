'use strict';

const { createBotSession, publicStatusSnapshot } = require('../app/runBot');
const { createBufferedLogger } = require('./bufferedLogger');
const { loadConfig } = require('../config');
const { getSafeConfig } = require('./configStore');
const { resolveStrategy } = require('../strategies');
const { validateTuxlerActive } = require('../core/tuxler');
const logBuffer = require('./logBuffer');
const { sleep } = require('../utils/sleep');
const {
  createRun,
  finishRun,
  insertSnapshot,
  isAvailable,
  logQueue,
} = require('../db');

let running = false;
let loop = null;
let config = null;
let runPromise = null;
let logger = createBufferedLogger('info');

// Links colados no painel — valem só em runtime, nunca são gravados no .env.
let runtimeTargetUrls = [];

let currentRunId = null;
let snapshotTimer = null;

/** Aceita array (JSON) ou string (textarea) separada por vírgula/quebra de linha. */
function normalizeUrls(raw) {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function snapshotIntervalMs() {
  const sec = Number.parseInt(process.env.SNAPSHOT_INTERVAL_SEC || '10', 10);
  const n = Number.isFinite(sec) && sec > 0 ? sec : 10;
  return Math.max(3, n) * 1000;
}

function stopSnapshotTimer() {
  if (snapshotTimer) {
    clearInterval(snapshotTimer);
    snapshotTimer = null;
  }
}

async function captureSnapshot() {
  if (!currentRunId || !isAvailable()) return;
  try {
    const payload = getStatus();
    await insertSnapshot(currentRunId, payload);
  } catch (err) {
    logger.debug('Snapshot falhou:', err.message);
  }
}

function startSnapshotTimer() {
  stopSnapshotTimer();
  if (!currentRunId || !isAvailable()) return;
  snapshotTimer = setInterval(() => {
    captureSnapshot().catch(() => {});
  }, snapshotIntervalMs());
  // Primeiro snapshot logo após o start
  captureSnapshot().catch(() => {});
}

async function persistFinish(status, errorMessage = null) {
  stopSnapshotTimer();
  const runId = currentRunId;
  if (!runId) return;

  const stats = loop ? loop.getStats() : null;
  try {
    await captureSnapshot();
  } catch {
    // ignore
  }

  try {
    await finishRun(runId, {
      status,
      okTotal: stats?.ok || 0,
      errorsTotal: stats?.errors || 0,
      iterationsTotal: stats?.iterations || 0,
      errorMessage,
    });
  } catch (err) {
    logger.warn('Falha ao finalizar run no banco:', err.message);
  }

  await logQueue.flush().catch(() => {});
  logQueue.setCurrentRunId(null);
  currentRunId = null;
}

// Liga o ring buffer ao Postgres (best-effort, assíncrono).
logBuffer.setPersistHook((entry) => {
  logQueue.enqueueLog(entry);
});

async function start(options = {}) {
  if (running) {
    return { ok: false, error: 'Bot já está em execução' };
  }

  if (options && Object.prototype.hasOwnProperty.call(options, 'targetUrls')) {
    runtimeTargetUrls = normalizeUrls(options.targetUrls);
  }

  const previewConfig = loadConfig();
  if (
    previewConfig.strategy === 'directLink' &&
    !runtimeTargetUrls.length
  ) {
    return {
      ok: false,
      error: 'Cole pelo menos um link de destino no painel antes de iniciar.',
    };
  }

  config = previewConfig;
  logger = createBufferedLogger(config.logLevel);

  if (config.tuxler?.enabled && config.strategy !== 'dryRun') {
    try {
      const strategy = resolveStrategy(config.strategy);
      await validateTuxlerActive(config, logger, { strategy });
    } catch (err) {
      logger.error('Start bloqueado — Tuxler inativo:', err.message);
      return { ok: false, error: err.message };
    }
  }

  let session;
  try {
    session = createBotSession({
      logger,
      overrides: { targetUrls: runtimeTargetUrls },
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  loop = session.loop;
  config = session.config;
  running = true;

  currentRunId = null;
  if (isAvailable()) {
    try {
      const safe = getSafeConfig();
      // Remove qualquer indício de lista/credencial de proxy.
      const configSafe = {
        STRATEGY: safe.STRATEGY,
        CONCURRENCY: safe.CONCURRENCY,
        DEVICE_MIX: safe.DEVICE_MIX,
        WORKER_SLOTS: safe.WORKER_SLOTS,
        PROXY_COUNTRIES: safe.PROXY_COUNTRIES,
        INTERVAL_MIN_SEC: safe.INTERVAL_MIN_SEC,
        INTERVAL_MAX_SEC: safe.INTERVAL_MAX_SEC,
        BROWSER_RESTART_EVERY: safe.BROWSER_RESTART_EVERY,
        HEADLESS: safe.HEADLESS,
        TUXLER_ENABLED: safe.TUXLER_ENABLED,
        BROWSE_PAGES_MIN: safe.BROWSE_PAGES_MIN,
        BROWSE_PAGES_MAX: safe.BROWSE_PAGES_MAX,
        INCLUDE_REFERRER: safe.INCLUDE_REFERRER,
      };
      const row = await createRun({
        source: 'dashboard',
        strategy: config.strategy,
        concurrency: config.concurrency,
        deviceMix: config.deviceMix || '',
        proxyEnabled: Boolean(config.tuxler?.enabled),
        tuxlerEnabled: Boolean(config.tuxler?.enabled),
        targetSource: config.targetSource || 'none',
        targetUrls: config.targetUrls || [],
        configSafe,
      });
      currentRunId = row?.id || null;
      logQueue.setCurrentRunId(currentRunId);
      startSnapshotTimer();
    } catch (err) {
      logger.warn('Não foi possível criar run no banco:', err.message);
      currentRunId = null;
    }
  }

  runPromise = session.loop
    .run()
    .catch(async (err) => {
      logger.error('Loop encerrou com erro:', err.message);
      await persistFinish('error', err.message);
      running = false;
      loop = null;
    });

  logger.info(
    `Runtime: bot iniciado via dashboard${currentRunId ? ` | runId=${currentRunId}` : ''}`
  );
  return { ok: true, runId: currentRunId };
}

async function stop() {
  if (!running || !loop) {
    running = false;
    if (currentRunId) {
      await persistFinish('stopped');
    }
    return { ok: true, skipped: true };
  }

  await loop.stop();
  running = false;
  await persistFinish('stopped');
  loop = null;
  if (runPromise) {
    await Promise.race([
      runPromise.catch(() => {}),
      sleep(5_000).then(() => {
        logger.warn('Workers ainda ativos após 5s — seguindo shutdown');
      }),
    ]);
    runPromise = null;
  }
  logger.info('Runtime: bot parado via dashboard');
  return { ok: true };
}

async function restart(options = {}) {
  await stop();
  return start(options);
}

function getStatus() {
  const base = config || loadConfig();
  const snapshot = publicStatusSnapshot(base, loop, running);
  snapshot.runId = currentRunId;

  if (!running) {
    snapshot.targetUrls = runtimeTargetUrls;
    snapshot.targetSource = runtimeTargetUrls.length ? 'frontend' : 'none';
  }

  return snapshot;
}

function isRunning() {
  return running;
}

function getCurrentRunId() {
  return currentRunId;
}

async function captureWorkerPreview(workerId) {
  if (!running || !loop) {
    throw new Error('Bot não está em execução');
  }
  return loop.captureWorkerPreview(workerId);
}

module.exports = {
  start,
  stop,
  restart,
  getStatus,
  isRunning,
  getCurrentRunId,
  captureWorkerPreview,
};
