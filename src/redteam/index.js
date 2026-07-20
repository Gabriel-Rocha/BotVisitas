'use strict';

const path = require('path');
const { loadConfig } = require('../config');
const { createLogger } = require('../utils/logger');
const { resolveLevels } = require('./levels');
const { startCollector } = require('./collector');
const { runSweep } = require('./runner');
const { writeReport } = require('./report');

/**
 * Harness de red-team — MEDIÇÃO DE COBERTURA DE DETECÇÃO.
 *
 * Uso autorizado apenas, contra infra que você controla. Roda bots em níveis
 * graduados (L0→L4) contra um coletor local e registra, por sessão, os sinais
 * que um detector inspecionaria — para você CONSTRUIR a detecção.
 *
 * Não torna nada "indetectável": o alvo default é localhost e todo request
 * carrega o header X-RedTeam-Run-Id (tráfego identificável, não furtivo).
 */

const DEFAULT_ALLOW_HOSTS = ['localhost', '127.0.0.1', '::1'];

function int(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function splitList(raw) {
  if (!raw) return [];
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

function assertTargetAllowed(targetUrl, allowHosts) {
  let host;
  try {
    host = new URL(targetUrl).hostname;
  } catch {
    throw new Error(`REDTEAM_TARGET_URL inválida: "${targetUrl}"`);
  }
  if (!allowHosts.includes(host)) {
    throw new Error(
      `Alvo "${host}" fora da allow-list [${allowHosts.join(', ')}]. ` +
        'Red-team só contra infra que você controla e está autorizado a testar. ' +
        'Se autorizado, adicione o host em REDTEAM_ALLOW_HOSTS.'
    );
  }
}

async function main() {
  const base = loadConfig();
  const logger = createLogger(base.logLevel);

  const allowHosts = [...DEFAULT_ALLOW_HOSTS, ...splitList(process.env.REDTEAM_ALLOW_HOSTS)];
  const sessionsPerLevel = int(process.env.REDTEAM_SESSIONS_PER_LEVEL, 3);
  const levels = resolveLevels(splitList(process.env.REDTEAM_LEVELS));
  const externalTarget = (process.env.REDTEAM_TARGET_URL || '').trim() || null;
  const port = int(process.env.REDTEAM_PORT, 0);

  const config = {
    headless: base.headless,
    chromeExecutablePath: base.chromeExecutablePath,
    navigationTimeoutMs: base.navigationTimeoutMs,
    viewport: base.viewport,
    userAgents: base.userAgents,
    defaultUserAgent: base.userAgents[0],
  };

  logger.info('═══ Red-Team Detection-Coverage Harness ═══');
  logger.info('Uso autorizado / ambiente controlado. Objetivo: medir cobertura, não evadir.');
  logger.info(`Níveis: ${levels.map((l) => l.id).join(' → ')} | sessões/nível: ${sessionsPerLevel}`);

  let collector = null;
  let collectorUrl = null;

  if (externalTarget) {
    assertTargetAllowed(externalTarget, allowHosts);
    collectorUrl = externalTarget.replace(/\/+$/, '');
    logger.warn(`Alvo externo (autorizado): ${collectorUrl} — sinais de rede server-side ficam indisponíveis.`);
    // Stub: sem coletor, não observamos o servidor do alvo.
    collector = { getServerSignals: () => null, stop: async () => {} };
  } else {
    collector = await startCollector({ port, logger });
    collectorUrl = collector.baseUrl;
    assertTargetAllowed(collectorUrl, allowHosts);
  }

  let shuttingDown = false;
  const cleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await collector.stop().catch(() => {});
  };
  process.on('SIGINT', async () => {
    logger.warn('SIGINT — encerrando...');
    await cleanup();
    process.exit(0);
  });

  try {
    const records = await runSweep({
      levels,
      sessionsPerLevel,
      collector,
      collectorUrl,
      config,
      logger,
    });

    const outDir = path.join(process.cwd(), 'logs', 'redteam');
    const meta = {
      date: new Date().toISOString(),
      target: collectorUrl,
      sessionsPerLevel,
      levels: levels.map((l) => l.id),
    };
    const { mdPath, jsonPath, summary } = writeReport({ records, levels, meta, outDir });

    logger.info('─────────── Resumo do penhasco de detecção ───────────');
    for (const [tell, cliff] of Object.entries(summary.cliffs)) {
      logger.info(`  ${tell.padEnd(26)} → ${cliff === null ? 'nunca dispara' : `sobrevive até ${cliff}`}`);
    }
    logger.info('──────────────────────────────────────────────────────');
    logger.info(`Relatório:  ${mdPath}`);
    logger.info(`JSON bruto: ${jsonPath}`);
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[FATAL]', err);
  process.exit(1);
});
