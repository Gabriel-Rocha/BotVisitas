'use strict';

const { Pool } = require('pg');

let pool = null;
let available = false;
let lastError = null;

function getDatabaseUrl() {
  return (process.env.DATABASE_URL || '').trim() || null;
}

function isAvailable() {
  return available && Boolean(pool);
}

function getLastError() {
  return lastError;
}

function getPool() {
  return pool;
}

async function initPool() {
  const url = getDatabaseUrl();
  if (!url) {
    available = false;
    lastError = 'DATABASE_URL não configurada';
    pool = null;
    return { ok: false, reason: lastError };
  }

  if (pool) {
    return { ok: available, reason: lastError };
  }

  pool = new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err) => {
    lastError = err.message;
    available = false;
  });

  try {
    await pool.query('SELECT 1');
    available = true;
    lastError = null;
    return { ok: true };
  } catch (err) {
    available = false;
    lastError = err.message;
    try {
      await pool.end();
    } catch {
      // ignore
    }
    pool = null;
    return { ok: false, reason: lastError };
  }
}

async function query(text, params) {
  if (!isAvailable()) {
    throw new Error(lastError || 'Banco indisponível');
  }
  return pool.query(text, params);
}

async function healthCheck() {
  if (!getDatabaseUrl()) {
    return { ok: false, status: 'disabled', error: 'DATABASE_URL vazia' };
  }
  if (!pool) {
    const init = await initPool();
    if (!init.ok) {
      return { ok: false, status: 'down', error: init.reason };
    }
  }
  try {
    await pool.query('SELECT 1');
    available = true;
    lastError = null;
    return { ok: true, status: 'up' };
  } catch (err) {
    available = false;
    lastError = err.message;
    return { ok: false, status: 'down', error: err.message };
  }
}

async function closePool() {
  if (!pool) return;
  const p = pool;
  pool = null;
  available = false;
  await p.end().catch(() => {});
}

module.exports = {
  initPool,
  getPool,
  isAvailable,
  getLastError,
  getDatabaseUrl,
  query,
  healthCheck,
  closePool,
};
