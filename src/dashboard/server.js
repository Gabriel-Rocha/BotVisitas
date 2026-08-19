'use strict';

const { createApp } = require('./routes');
const { createBufferedLogger } = require('./bufferedLogger');
const { initDb, closePool, logQueue } = require('../db');
// Garante reload do .env antes de ler DATABASE_URL
require('../config');

const PORT = Number.parseInt(process.env.DASHBOARD_PORT || '3847', 10);
// 0.0.0.0 = acessível via porta publicada no Docker; 127.0.0.1 só funciona dentro do container
const HOST = process.env.DASHBOARD_HOST || '0.0.0.0';

const logger = createBufferedLogger('info');
const app = createApp();

let server = null;

async function boot() {
  await initDb(logger);
  server = app.listen(PORT, HOST, () => {
    logger.info(`Dashboard em http://${HOST}:${PORT}`);
    if ((process.env.DASHBOARD_TOKEN || '').trim()) {
      logger.info('Auth: X-Dashboard-Token obrigatório');
    } else {
      logger.warn('DASHBOARD_TOKEN vazio — API aberta no bind local');
    }
  });
}

async function shutdown(signal) {
  logger.info(`Sinal ${signal} — encerrando dashboard`);
  const botRuntime = require('./botRuntime');
  await botRuntime.stop();
  await logQueue.flush().catch(() => {});
  await closePool();
  if (server) {
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

boot().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[FATAL] dashboard boot', err);
  process.exit(1);
});
