'use strict';

const { createBotSession, publicStatusSnapshot } = require('../app/runBot');
const { createBufferedLogger } = require('./bufferedLogger');
const { loadConfig } = require('../config');

let running = false;
let loop = null;
let config = null;
let runPromise = null;
let logger = createBufferedLogger('info');

async function start() {
  if (running) {
    return { ok: false, error: 'Bot já está em execução' };
  }

  config = loadConfig();
  logger = createBufferedLogger(config.logLevel);
  const session = createBotSession({ logger });
  loop = session.loop;
  config = session.config;
  running = true;

  runPromise = session.loop.run().catch((err) => {
    logger.error('Loop encerrou com erro:', err.message);
    running = false;
    loop = null;
  });

  logger.info('Runtime: bot iniciado via dashboard');
  return { ok: true };
}

async function stop() {
  if (!running || !loop) {
    running = false;
    return { ok: true, skipped: true };
  }

  await loop.stop();
  running = false;
  loop = null;
  if (runPromise) {
    await runPromise.catch(() => {});
    runPromise = null;
  }
  logger.info('Runtime: bot parado via dashboard');
  return { ok: true };
}

async function restart() {
  await stop();
  return start();
}

function getStatus() {
  const cfg = config || loadConfig();
  return publicStatusSnapshot(cfg, loop, running);
}

function isRunning() {
  return running;
}

module.exports = {
  start,
  stop,
  restart,
  getStatus,
  isRunning,
};
