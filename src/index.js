'use strict';

const { createBotSession } = require('./app/runBot');
const { createBufferedLogger } = require('./dashboard/bufferedLogger');
const { loadConfig } = require('./config');

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const strategy = resolveStrategy(config.strategy);

  logger.info('BotVisitas v2 — start');
  logger.info(`Node ${process.version} | platform=${process.platform} | arch=${process.arch}`);
  logger.info(
    `strategy=${config.strategy} | headless=${config.headless} | proxy=${config.proxy.enabled} | stealth=${config.stealth.enabled} | humanize=${config.stealth.humanize} | persist=${config.session.persist}`
  );

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
