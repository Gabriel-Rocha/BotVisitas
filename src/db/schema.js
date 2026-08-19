'use strict';

const { query, isAvailable } = require('./pool');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS bot_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'dashboard'
    CHECK (source IN ('cli', 'dashboard')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'stopped', 'error', 'crashed')),
  strategy TEXT NOT NULL,
  concurrency INT,
  device_mix TEXT,
  proxy_enabled BOOLEAN NOT NULL DEFAULT false,
  target_source TEXT,
  target_urls TEXT[] DEFAULT '{}',
  config_safe JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  ok_total INT NOT NULL DEFAULT 0,
  errors_total INT NOT NULL DEFAULT 0,
  iterations_total INT NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS run_logs (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID REFERENCES bot_runs(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_snapshots (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES bot_runs(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bot_runs_started_at ON bot_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_runs_status ON bot_runs (status);
CREATE INDEX IF NOT EXISTS idx_run_logs_run_ts ON run_logs (run_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_run_snapshots_run_ts ON run_snapshots (run_id, captured_at DESC);
`;

async function migrate() {
  if (!isAvailable()) {
    return { ok: false, reason: 'banco indisponível' };
  }
  // gen_random_uuid() é nativo no Postgres 13+; pgcrypto só como fallback.
  try {
    await query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  } catch {
    // ignore — Postgres 16 já tem gen_random_uuid sem extensão
  }
  await query(SCHEMA_SQL);
  const crashed = await query(
    `UPDATE bot_runs
     SET status = 'crashed',
         ended_at = COALESCE(ended_at, now()),
         error_message = COALESCE(error_message, 'Processo reiniciado com run ainda running')
     WHERE status = 'running'
     RETURNING id`
  );
  return { ok: true, crashed: crashed.rowCount || 0 };
}

module.exports = { migrate, SCHEMA_SQL };
