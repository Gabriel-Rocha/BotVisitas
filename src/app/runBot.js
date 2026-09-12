'use strict';

const { loadConfig } = require('../config');
const { resolveStrategy } = require('../strategies');
const { createLoop } = require('../core/loop');
const { createBufferedLogger } = require('../dashboard/bufferedLogger');

/**
 * Cria e sobe o loop do bot (sem handlers de sinal / process.exit).
 * Usado pelo CLI e pelo dashboard runtime.
 */
function createBotSession({ logger, overrides = {} } = {}) {
  const config = loadConfig();
  const strategy = resolveStrategy(config.strategy);

  const portalUrls = Array.isArray(overrides.targetUrls)
    ? overrides.targetUrls.map((s) => String(s).trim()).filter(Boolean)
    : [];

  if (strategy.name === 'directLink') {
    if (!portalUrls.length) {
      throw new Error(
        'Cole os links de destino no painel e clique Start (URLs não vêm do .env).'
      );
    }
    config.targetUrls = portalUrls;
    config.targetSource = 'frontend';
  } else {
    config.targetUrls = portalUrls;
    config.targetSource = portalUrls.length ? 'frontend' : 'none';
  }

  const log = logger || createBufferedLogger(config.logLevel);

  log.info('BotVisitas — session start');
  log.info(
    `strategy=${config.strategy} | headless=${config.headless} | tuxler=${Boolean(config.tuxler?.enabled)} | concurrency=${config.concurrency}`
  );
  if (config.deviceMix) {
    log.info(`DEVICE_MIX=${config.deviceMix}`);
  }
  log.info(
    `Links [${config.targetSource}] (${config.targetUrls.length}): ${
      config.targetUrls.length ? config.targetUrls.join(' | ') : '(nenhum — dryRun OK)'}`
  );

  const loop = createLoop({ config, strategy, logger: log });

  return { config, strategy, logger: log, loop };
}

function publicStatusSnapshot(config, loop, running) {
  const stats = loop ? loop.getStats() : null;

  return {
    running: Boolean(running),
    strategy: config.strategy,
    headless: config.headless,
    concurrency: config.concurrency,
    deviceMix: config.deviceMix || '',
    tuxlerEnabled: Boolean(config.tuxler?.enabled),
    targetUrls: config.targetUrls || [],
    targetSource: config.targetSource || 'none',
    stats: stats
      ? {
          ok: stats.ok,
          offers: stats.offers || 0,
          intermediate: stats.intermediate || 0,
          errors: stats.errors,
          iterations: stats.iterations,
          clicks: stats.clicks || 0,
          adClicks: stats.adClicks || 0,
          siteClicks: stats.siteClicks || 0,
          externalClicks: stats.externalClicks || 0,
          browserRestarts: stats.browserRestarts || 0,
          uptimeSec: stats.uptimeSec,
          concurrency: stats.concurrency,
          devices: stats.devices || {},
          memory: stats.memory || null,
          workers: (stats.workers || []).map((w) => ({
            workerId: w.workerId,
            deviceType: w.deviceType || 'desktop',
            ok: w.ok,
            offers: w.offers || 0,
            intermediate: w.intermediate || 0,
            errors: w.errors,
            iterations: w.iterations,
            clicks: w.clicks || 0,
            adClicks: w.adClicks || 0,
            siteClicks: w.siteClicks || 0,
            proxyLabel: w.proxyLabel,
            uptimeSec: w.uptimeSec,
            currentUrl: w.currentUrl,
            pageTitle: w.pageTitle,
            previewCapturedAt: w.previewCapturedAt,
          })),
        }
      : null,
  };
}

module.exports = { createBotSession, publicStatusSnapshot };
