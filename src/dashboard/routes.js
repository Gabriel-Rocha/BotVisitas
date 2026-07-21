'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const botRuntime = require('./botRuntime');
const logBuffer = require('./logBuffer');
const { getSafeConfig, updateSafeConfig } = require('./configStore');
const {
  healthCheck,
  isAvailable,
  getLastError,
  listRuns,
  getRun,
  listRunLogs,
  listRunSnapshots,
  assertUuid,
} = require('../db');

function authMiddleware(req, res, next) {
  const token = (process.env.DASHBOARD_TOKEN || '').trim();
  if (!token) return next();
  const header = req.get('X-Dashboard-Token') || '';
  const query = typeof req.query.token === 'string' ? req.query.token : '';
  if (header !== token && query !== token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

function createApp() {
  const app = express();
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', async (_req, res) => {
    const db = await healthCheck();
    res.json({
      ok: true,
      service: 'botvisitas-dashboard',
      db: db.status || (db.ok ? 'up' : 'down'),
      dbError: db.error || null,
    });
  });

  app.use('/api', authMiddleware);

  app.get('/api/status', (_req, res) => {
    res.json(botRuntime.getStatus());
  });

  app.post('/api/bot/start', async (req, res) => {
    try {
      const result = await botRuntime.start(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/bot/stop', async (_req, res) => {
    try {
      const result = await botRuntime.stop();
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/bot/restart', async (req, res) => {
    try {
      const result = await botRuntime.restart(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/config', (_req, res) => {
    res.json(getSafeConfig());
  });

  app.put('/api/config', (req, res) => {
    try {
      const result = updateSafeConfig(req.body || {});
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    for (const entry of logBuffer.getRecent(100)) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    const unsub = logBuffer.subscribe((entry) => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsub();
    });
  });

  // ── Histórico (Postgres) ──

  app.get('/api/runs', async (req, res) => {
    try {
      if (!isAvailable()) {
        return res.status(503).json({
          ok: false,
          error: getLastError() || 'Histórico indisponível (Postgres offline)',
        });
      }
      const status = typeof req.query.status === 'string' ? req.query.status : null;
      const allowed = new Set(['running', 'stopped', 'error', 'crashed']);
      if (status && !allowed.has(status)) {
        return res.status(400).json({ ok: false, error: 'status inválido' });
      }
      const data = await listRuns({
        limit: req.query.limit,
        offset: req.query.offset,
        status,
      });
      res.json({ ok: true, ...data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/runs/:id', async (req, res) => {
    try {
      assertUuid(req.params.id);
      if (!isAvailable()) {
        return res.status(503).json({ ok: false, error: 'Histórico indisponível' });
      }
      const run = await getRun(req.params.id);
      if (!run) return res.status(404).json({ ok: false, error: 'Run não encontrado' });
      res.json({ ok: true, run });
    } catch (err) {
      const code = err.code === 'VALIDATION' ? 400 : 500;
      res.status(code).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/runs/:id/logs', async (req, res) => {
    try {
      assertUuid(req.params.id);
      if (!isAvailable()) {
        return res.status(503).json({ ok: false, error: 'Histórico indisponível' });
      }
      const level = typeof req.query.level === 'string' ? req.query.level : null;
      const before = typeof req.query.before === 'string' ? req.query.before : null;
      const items = await listRunLogs(req.params.id, {
        limit: req.query.limit,
        before,
        level,
      });
      res.json({ ok: true, items });
    } catch (err) {
      const code = err.code === 'VALIDATION' ? 400 : 500;
      res.status(code).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/runs/:id/snapshots', async (req, res) => {
    try {
      assertUuid(req.params.id);
      if (!isAvailable()) {
        return res.status(503).json({ ok: false, error: 'Histórico indisponível' });
      }
      const items = await listRunSnapshots(req.params.id, {
        limit: req.query.limit,
      });
      res.json({ ok: true, items });
    } catch (err) {
      const code = err.code === 'VALIDATION' ? 400 : 500;
      res.status(code).json({ ok: false, error: err.message });
    }
  });

  const dist = path.resolve(process.cwd(), 'web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.type('html').send(
        '<p>Dashboard API no ar. Build o frontend: <code>npm run web:build</code></p>'
      );
    });
  }

  return app;
}

module.exports = { createApp };
