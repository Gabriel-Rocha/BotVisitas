'use strict';

const { createApp } = require('./routes');
const { createBufferedLogger } = require('./bufferedLogger');
const { initDb, closePool, logQueue } = require('../db');
const { sleep } = require('../utils/sleep');
// Garante reload do .env antes de ler DATABASE_URL
require('../config');

const PORT = Number.parseInt(process.env.DASHBOARD_PORT || '3847', 10);
const MAX_PORT_TRIES = 20;
// 0.0.0.0 = acessível via porta publicada no Docker; 127.0.0.1 só funciona dentro do container
const HOST = process.env.DASHBOARD_HOST || '0.0.0.0';

const logger = createBufferedLogger('info');
const app = createApp();

let server = null;
let shuttingDown = false;

function publicDashboardUrl(host, port) {
  const openHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  return `http://${openHost}:${port}`;
}

function hardExit(code, reason) {
  logger.warn(reason);
  setTimeout(() => process.exit(code), 300).unref();
}

function listen(port, attemptsLeft) {
  const s = app.listen(port, HOST);
  s.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      const next = port + 1;
      logger.warn(`Porta ${port} ocupada — tentando ${next}`);
      listen(next, attemptsLeft - 1);
      return;
    }
    logger.error(`Não foi possível escutar em ${HOST}:${port}: ${err.message}`);
    process.exit(1);
  });
  s.once('listening', () => {
    server = s;
    const addr = s.address();
    const used = addr && typeof addr === 'object' ? addr.port : port;
    logger.info(`Rodando nesse link aqui: ${publicDashboardUrl(HOST, used)}`);
    if ((process.env.DASHBOARD_TOKEN || '').trim()) {
      logger.info('Auth: X-Dashboard-Token obrigatório');
    } else {
      logger.warn('DASHBOARD_TOKEN vazio — API aberta no bind local');
    }
  });
}

async function boot() {
  await initDb(logger);
  listen(PORT, MAX_PORT_TRIES);
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Sinal ${signal} — encerrando dashboard`);

  const watchdog = setTimeout(() => {
    hardExit(1, 'Shutdown demorou > 25s — encerramento forçado');
  }, 25_000);
  watchdog.unref();

  try {
    const botRuntime = require('./botRuntime');
    await Promise.race([
      botRuntime.stop(),
      sleep(20_000).then(() => {
        logger.warn('botRuntime.stop() demorou > 20s — continuando shutdown');
      }),
    ]);
    await logQueue.flush().catch(() => {});
    await closePool();
  } catch (err) {
    logger.error('Erro no shutdown:', err.message);
  } finally {
    clearTimeout(watchdog);
    if (server) {
      server.close(() => process.exit(0));
      hardExit(0, 'server.close() lento — saindo');
    } else {
      process.exit(0);
    }
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

boot().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[FATAL] dashboard boot', err);
  process.exit(1);
});
