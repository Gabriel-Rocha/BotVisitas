'use strict';

const { loadConfig } = require('./config');
const { createLogger } = require('./utils/logger');
const { resolveStrategy } = require('./strategies');
const { createLoop } = require('./core/loop');

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const strategy = resolveStrategy(config.strategy);

  logger.info('BotVisitas v2 — start');
  logger.info(`Node ${process.version} | platform=${process.platform} | arch=${process.arch}`);
  logger.info(`strategy=${config.strategy} | headless=${config.headless} | proxy=${config.proxy.enabled}`);

  const loop = createLoop({ config, strategy, logger });

  const shutdown = async (signal) => {
    logger.info(`Sinal ${signal} recebido`);
    await loop.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await loop.run();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[FATAL]', err);
  process.exit(1);
});
