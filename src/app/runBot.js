'use strict';

const { loadConfig } = require('../config');
const { resolveStrategy } = require('../strategies');
const { createLoop } = require('../core/loop');
const { buildProxyPool } = require('../core/proxy');
const { createBufferedLogger } = require('../dashboard/bufferedLogger');

/**
 * Cria e sobe o loop do bot (sem handlers de sinal / process.exit).
 * Usado pelo CLI e pelo dashboard runtime.
 */
function createBotSession({ logger, overrides = {} } = {}) {
  const config = loadConfig();

  // Links colados no painel valem só para esta execução (não vão pro .env).
  // Vazio/ausente = usa TARGET_URLS do .env como fallback.
  if (Array.isArray(overrides.targetUrls) && overrides.targetUrls.length) {
    config.targetUrls = overrides.targetUrls;
    config.targetSource = 'frontend';
  } else {
    config.targetSource = config.targetUrls.length ? 'env' : 'none';
  }

  const log = logger || createBufferedLogger(config.logLevel);
  const strategy = resolveStrategy(config.strategy);

  log.info('BotVisitas — session start');
  log.info(
    `strategy=${config.strategy} | headless=${config.headless} | proxy=${config.proxy.enabled} | concurrency=${config.concurrency}`
  );
  if (config.deviceMix) {
    log.info(`DEVICE_MIX=${config.deviceMix}`);
  }
  log.info(
    `TARGET_URLS [${config.targetSource}] (${config.targetUrls.length}): ${
      config.targetUrls.length ? config.targetUrls.join(' | ') : '(vazio)'
    }`
  );

  if (config.strategy === 'directLink') {
    log.warn('Direct Link ativo — use apenas contra infra que você controla.');
  }

  const loop = createLoop({ config, strategy, logger: log });

  return { config, strategy, logger: log, loop };
}

function publicStatusSnapshot(config, loop, running) {
  const stats = loop ? loop.getStats() : null;
  const proxyPool = config.proxy?.enabled
    ? buildProxyPool(config.proxy).pool.map((p) => p.label)
    : [];

  return {
    running: Boolean(running),
    strategy: config.strategy,
    headless: config.headless,
    concurrency: config.concurrency,
    deviceMix: config.deviceMix || '',
    proxyEnabled: Boolean(config.proxy?.enabled),
    proxyPoolSize: proxyPool.length,
    proxyLabels: proxyPool,
    targetUrls: config.targetUrls || [],
    targetSource: config.targetSource || (config.targetUrls?.length ? 'env' : 'none'),
    stats: stats
      ? {
          ok: stats.ok,
          errors: stats.errors,
          iterations: stats.iterations,
          uptimeSec: stats.uptimeSec,
          concurrency: stats.concurrency,
          devices: stats.devices || {},
          workers: (stats.workers || []).map((w) => ({
            workerId: w.workerId,
            deviceType: w.deviceType || 'desktop',
            ok: w.ok,
            errors: w.errors,
            iterations: w.iterations,
            proxyLabel: w.proxyLabel,
            uptimeSec: w.uptimeSec,
          })),
        }
      : null,
  };
}

module.exports = { createBotSession, publicStatusSnapshot };
