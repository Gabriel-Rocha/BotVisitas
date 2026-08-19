'use strict';

const { initPool, healthCheck, closePool, isAvailable, getLastError } = require('./pool');
const { migrate } = require('./schema');
const runs = require('./runs');
const logQueue = require('./logQueue');

async function initDb(logger) {
  const log = logger || {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  const init = await initPool();
  if (!init.ok) {
    log.warn(`Postgres desligado/indisponível: ${init.reason} — histórico desabilitado`);
    return { ok: false, reason: init.reason };
  }

  try {
    const result = await migrate();
    log.info(`Postgres OK — schema pronto (runs crashed marcados: ${result.crashed || 0})`);
    return { ok: true, crashed: result.crashed || 0 };
  } catch (err) {
    log.error('Falha ao migrar schema Postgres:', err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = {
  initDb,
  healthCheck,
  closePool,
  isAvailable,
  getLastError,
  ...runs,
  logQueue,
};
