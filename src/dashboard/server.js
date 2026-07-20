'use strict';

const { createApp } = require('./routes');
const { createBufferedLogger } = require('./bufferedLogger');

const PORT = Number.parseInt(process.env.DASHBOARD_PORT || '3847', 10);
// 0.0.0.0 = acessível via porta publicada no Docker; 127.0.0.1 só funciona dentro do container
const HOST = process.env.DASHBOARD_HOST || '0.0.0.0';

const logger = createBufferedLogger('info');
const app = createApp();

const server = app.listen(PORT, HOST, () => {
  logger.info(`Dashboard em http://${HOST}:${PORT}`);
  if ((process.env.DASHBOARD_TOKEN || '').trim()) {
    logger.info('Auth: X-Dashboard-Token obrigatório');
  } else {
    logger.warn('DASHBOARD_TOKEN vazio — API aberta no bind local');
  }
});

async function shutdown(signal) {
  logger.info(`Sinal ${signal} — encerrando dashboard`);
  const botRuntime = require('./botRuntime');
  await botRuntime.stop();
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
