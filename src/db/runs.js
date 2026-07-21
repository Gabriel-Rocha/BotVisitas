'use strict';

const { query, isAvailable } = require('./pool');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(id) {
  if (!UUID_RE.test(String(id || ''))) {
    const err = new Error('run id inválido');
    err.code = 'VALIDATION';
    throw err;
  }
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function createRun({
  source = 'dashboard',
  strategy,
  concurrency,
  deviceMix = '',
  proxyEnabled = false,
  targetSource = 'none',
  targetUrls = [],
  configSafe = {},
}) {
  if (!isAvailable()) return null;
  const result = await query(
    `INSERT INTO bot_runs (
       source, status, strategy, concurrency, device_mix, proxy_enabled,
       target_source, target_urls, config_safe
     ) VALUES ($1, 'running', $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING *`,
    [
      source,
      strategy,
      concurrency ?? null,
      deviceMix || null,
      Boolean(proxyEnabled),
      targetSource || 'none',
      Array.isArray(targetUrls) ? targetUrls : [],
      JSON.stringify(configSafe || {}),
    ]
  );
  return result.rows[0] || null;
}

async function finishRun(runId, {
  status = 'stopped',
  okTotal = 0,
  errorsTotal = 0,
  iterationsTotal = 0,
  errorMessage = null,
} = {}) {
  if (!isAvailable() || !runId) return null;
  assertUuid(runId);
  const result = await query(
    `UPDATE bot_runs
     SET status = $2,
         ended_at = now(),
         ok_total = $3,
         errors_total = $4,
         iterations_total = $5,
         error_message = $6
     WHERE id = $1
     RETURNING *`,
    [runId, status, okTotal, errorsTotal, iterationsTotal, errorMessage]
  );
  return result.rows[0] || null;
}

async function insertSnapshot(runId, payload) {
  if (!isAvailable() || !runId) return null;
  assertUuid(runId);
  const result = await query(
    `INSERT INTO run_snapshots (run_id, payload)
     VALUES ($1, $2::jsonb)
     RETURNING id, run_id, captured_at`,
    [runId, JSON.stringify(payload || {})]
  );
  return result.rows[0] || null;
}

async function insertLogBatch(entries) {
  if (!isAvailable() || !entries?.length) return 0;
  const values = [];
  const params = [];
  let i = 1;
  for (const entry of entries) {
    values.push(`($${i++}, $${i++}, $${i++}, $${i++}::timestamptz)`);
    params.push(entry.runId || null, entry.level, entry.message, entry.ts);
  }
  await query(
    `INSERT INTO run_logs (run_id, level, message, ts) VALUES ${values.join(', ')}`,
    params
  );
  return entries.length;
}

async function listRuns({ limit = 20, offset = 0, status = null } = {}) {
  if (!isAvailable()) return { items: [], total: 0 };
  const lim = clampInt(limit, 20, 1, 100);
  const off = clampInt(offset, 0, 0, 100_000);
  const params = [];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE status = $${params.length}`;
  }
  const count = await query(`SELECT COUNT(*)::int AS total FROM bot_runs ${where}`, params);
  params.push(lim, off);
  const result = await query(
    `SELECT id, source, status, strategy, concurrency, device_mix, proxy_enabled,
            target_source, target_urls, started_at, ended_at,
            ok_total, errors_total, iterations_total, error_message
     FROM bot_runs
     ${where}
     ORDER BY started_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { items: result.rows, total: count.rows[0]?.total || 0 };
}

async function getRun(runId) {
  if (!isAvailable()) return null;
  assertUuid(runId);
  const result = await query(`SELECT * FROM bot_runs WHERE id = $1`, [runId]);
  return result.rows[0] || null;
}

async function listRunLogs(runId, { limit = 200, before = null, level = null } = {}) {
  if (!isAvailable()) return [];
  assertUuid(runId);
  const lim = clampInt(limit, 200, 1, 500);
  const params = [runId];
  const clauses = ['run_id = $1'];
  if (before) {
    params.push(before);
    clauses.push(`ts < $${params.length}::timestamptz`);
  }
  if (level) {
    params.push(level);
    clauses.push(`level = $${params.length}`);
  }
  params.push(lim);
  const result = await query(
    `SELECT id, run_id, level, message, ts
     FROM run_logs
     WHERE ${clauses.join(' AND ')}
     ORDER BY ts DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

async function listRunSnapshots(runId, { limit = 200 } = {}) {
  if (!isAvailable()) return [];
  assertUuid(runId);
  const lim = clampInt(limit, 200, 1, 1000);
  const result = await query(
    `SELECT id, run_id, captured_at, payload
     FROM run_snapshots
     WHERE run_id = $1
     ORDER BY captured_at ASC
     LIMIT $2`,
    [runId, lim]
  );
  return result.rows;
}

module.exports = {
  createRun,
  finishRun,
  insertSnapshot,
  insertLogBatch,
  listRuns,
  getRun,
  listRunLogs,
  listRunSnapshots,
  assertUuid,
};
