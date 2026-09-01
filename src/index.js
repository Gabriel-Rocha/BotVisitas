'use strict';

const { createBotSession } = require('./app/runBot');
const { createBufferedLogger } = require('./dashboard/bufferedLogger');
const { loadConfig } = require('./config');
const { sleep } = require('./utils/sleep');
const { installBenignPuppeteerHandlers } = require('./utils/puppeteerErrors');

async function main() {
  const config = loadConfig();
  const logger = createBufferedLogger(config.logLevel);
  const { loop } = createBotSession({ logger });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Sinal ${signal} recebido`);
    const watchdog = setTimeout(() => {
      logger.warn('Shutdown > 25s — saindo à força');
      process.exit(1);
    }, 25_000);
    watchdog.unref();
    await Promise.race([
      loop.stop(),
      sleep(20_000).then(() => logger.warn('loop.stop() demorou > 20s')),
    ]);
    clearTimeout(watchdog);
    process.exit(0);
  };

  installBenignPuppeteerHandlers(logger);
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await loop.run();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[FATAL]', err);
  process.exit(1);
});
