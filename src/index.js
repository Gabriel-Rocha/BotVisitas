'use strict';

const { createBotSession } = require('./app/runBot');
const { createBufferedLogger } = require('./dashboard/bufferedLogger');
const { loadConfig } = require('./config');

async function main() {
  const config = loadConfig();
  const logger = createBufferedLogger(config.logLevel);
  const { loop } = createBotSession({ logger });

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
