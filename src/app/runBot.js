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
function createBotSession({ logger } = {}) {
  const config = loadConfig();
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
    `TARGET_URLS (${config.targetUrls.length}): ${
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
