'use strict';

/**
 * TuxlerVPN (Windows) — egress residencial gratuito via VPN de sistema.
 * TuxlerVPN (Windows) — egress residencial via VPN de sistema.
 * Modo skip (padrão): usa IP atual do Tuxler; rotação manual no app.
 * Modos restart/coords: scripts/tuxler-rotate.ps1 (opcional).
 * Falhas de geo/rotação não bloqueiam visitas — usa IP atual e segue.
 */

const { spawn } = require('child_process');
const path = require('path');
const { lookupTuxlerEgress, lookupGeoViaSocks, clearGeoCache, COUNTRY_HINTS } = require('./geo');
const {
  waitForTuxlerSocks,
  resetTuxlerSocksCache,
  resolveTuxlerSocksEndpoint,
  probeTuxlerSocks,
} = require('./proxy');
const { sleep } = require('../utils/sleep');
const { rememberTuxlerExit } = require('./tuxlerStore');

class TuxlerInactiveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TuxlerInactiveError';
    this.code = 'TUXLER_INACTIVE';
  }
}

const DEFAULT_EXE = 'C:\\Program Files (x86)\\tuxlerVPN\\tuxlerVPN.exe';

function isWindows() {
  return process.platform === 'win32';
}

function rotateScriptPath() {
  return path.join(process.cwd(), 'scripts', 'tuxler-rotate.ps1');
}

function fallbackGeo(preferredCountry) {
  const cc = String(preferredCountry || '')
    .trim()
    .toUpperCase();
  if (!cc) {
    return {
      ip: null,
      countryCode: null,
      timezoneId: null,
      locale: null,
      source: 'fallback-unknown',
    };
  }
  const hint = COUNTRY_HINTS[cc] || null;
  return {
    ip: null,
    countryCode: cc,
    timezoneId: hint?.timezoneId || null,
    locale: hint?.locale || null,
    source: 'fallback-slot',
  };
}

async function safeFetchEgress(config, logger, preferredCountry) {
  const waitMs = config?.tuxler?.socksWaitMs ?? 20_000;
  const socks = await waitForTuxlerSocks({ config, logger, maxWaitMs: waitMs });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      clearGeoCache();
      return await lookupTuxlerEgress({
        socksHost: socks.host,
        socksPort: socks.port,
        socksOpen: socks.open,
        logger,
        allowLocalFallback: config?.tuxler?.requireActive === false,
      });
    } catch (err) {
      logger?.warn?.(`Geo egress (${attempt}/2): ${err.message}`);
      if (err.code === 'TUXLER_SOCKS_OFFLINE' && config?.tuxler?.requireActive !== false) {
        if (attempt >= 2) {
          throw new TuxlerInactiveError(err.message);
        }
        await sleep(1_200);
        continue;
      }
      if (attempt < 2) await sleep(600);
    }
  }
  return fallbackGeo(preferredCountry);
}

function runPowerShellRotate(config, countryCode, logger, timeoutSec = 20) {
  const script = rotateScriptPath();
  const mode = (config.tuxler?.rotateMode || 'skip').toLowerCase();
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    '-ExePath',
    config.tuxler?.exePath || DEFAULT_EXE,
    '-TimeoutSec',
    String(timeoutSec),
    '-RotateMode',
    mode,
  ];
  const cc = String(countryCode || '').trim().toLowerCase();
  if (cc) {
    args.push('-Country', cc);
  }
  const helperPath = String(config.tuxler?.helperExePath || '').trim();
  if (helperPath) {
    args.push('-HelperPath', helperPath);
  }

  if (mode === 'coords' || mode === 'uia') {
    args.push('-ClickRelX', String(config.tuxler?.clickRelX ?? 0.5));
    args.push('-ClickRelY', String(config.tuxler?.clickRelY ?? 0.68));
  }
  if (mode === 'restart') {
    args.push('-ActivateRelX', String(config.tuxler?.activateRelX ?? 0.5));
    args.push('-ActivateRelY', String(config.tuxler?.activateRelY ?? 0.58));
  }

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', args, { windowsHide: false });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish(new Error(`tuxler-rotate timeout ${timeoutSec}s`));
    }, (timeoutSec + 8) * 1000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      const out = stdout.trim();
      const errOut = stderr.trim();
      if (code === 0) {
        if (logger?.debug) logger.debug(`tuxler-rotate: ${out || 'ok'}`);
        finish(null, out);
        return;
      }
      finish(new Error(errOut || out || `tuxler-rotate.ps1 exit ${code}`));
    });
  });
}

/**
 * Tenta girar IP no Tuxler. Nunca bloqueia minutos: timeout curto + fallback com IP atual.
 */
async function rotateTuxlerIp(config, countryCode, logger) {
  if (!isWindows()) {
    throw new Error('TUXLER_ENABLED exige Windows com TuxlerVPN instalado');
  }

  const mode = (config.tuxler?.rotateMode || 'skip').toLowerCase();
  const scriptTimeoutSec =
    mode === 'restart'
      ? Math.min(
          120,
          Math.max(45, Math.ceil((config.tuxler?.rotateTimeoutMs || 60_000) / 1000))
        )
      : Math.min(
          25,
          Math.max(12, Math.ceil((config.tuxler?.rotateTimeoutMs || 20_000) / 1000))
        );

  const before = await safeFetchEgress(config, logger, countryCode);

  if (mode === 'skip') {
    const via = before.viaSocks ? 'socks' : 'IP-LOCAL (SOCKS offline)';
    logger?.info?.(
      `Tuxler egress | ip=${before.ip || '?'} cc=${before.countryCode || '?'} tz=${before.timezoneId || '?'} via=${via} (sem rotação)`
    );
    if (!before.viaSocks) {
      if (config.tuxler?.requireActive !== false) {
        throw new TuxlerInactiveError(
          'Tuxler SOCKS não está roteando (geo via túnel falhou). Reconecte o app e aguarde 127.0.0.1:23321.'
        );
      }
      logger?.warn?.(
        'Tuxler conectado no app mas proxy local offline — abra o Tuxler, escolha o país e aguarde até socks=127.0.0.1:23321 responder.'
      );
    }
    if (!before.countryCode && !before.ip) {
      logger?.warn?.('Tuxler: geo egress indisponível — confira VPN conectada');
    }
    return before;
  }

  logger?.info?.(
    `Tuxler rotate | antes ip=${before.ip || '?'} cc=${before.countryCode || '?'} alvo=${countryCode || 'auto'} mode=${mode}`
  );

  try {
    await runPowerShellRotate(config, countryCode, logger, scriptTimeoutSec);
  } catch (err) {
    logger?.warn?.(`Tuxler rotate falhou (${err.message}) — seguindo com IP atual`);
    return before.ip ? before : await safeFetchEgress(config, logger, countryCode);
  }

  await sleep(1500);
  const after = await safeFetchEgress(config, logger, countryCode);

  if (after.ip && before.ip && after.ip !== before.ip) {
    logger?.info?.(`Tuxler rotate OK | ip=${after.ip} cc=${after.countryCode || '?'}`);
    return after;
  }

  if (after.ip) {
    logger?.warn?.(
      `Tuxler: IP inalterado (${after.ip} cc=${after.countryCode || '?'}) — visitas seguem mesmo assim`
    );
    return after;
  }

  return before;
}

function toTuxlerSlot(geo) {
  const cc = String(geo.countryCode || '')
    .trim()
    .toLowerCase();
  return {
    protocol: 'tuxler',
    host: null,
    port: null,
    username: null,
    password: null,
    isTuxler: true,
    country: cc || null,
    ip: geo.ip || null,
    label: `tuxler|${cc || '?'}|${geo.ip || '?'}`,
    geo: {
      ip: geo.ip || null,
      country: geo.country || null,
      countryCode: geo.countryCode || null,
      timezoneId: geo.timezoneId || null,
      locale: geo.locale || null,
      isProxy: geo.isProxy,
      isHosting: geo.isHosting,
      isp: geo.isp || null,
      viaSocks: Boolean(geo.viaSocks),
      source: geo.source || 'egress',
    },
  };
}

function persistTuxlerSlot(geo, config) {
  const slot = toTuxlerSlot(geo);
  rememberTuxlerExit(slot, config);
  return slot;
}

const EGRESS_REFRESH_MS = 30_000;

function createTuxlerLease(config, logger) {
  const skip = (config.tuxler?.rotateMode || 'skip').toLowerCase() === 'skip';
  let cachedEgress = null;
  let cachedAt = 0;

  async function resolveEgress(preferredCountry) {
    const now = Date.now();
    if (skip && cachedEgress?.ip && now - cachedAt < EGRESS_REFRESH_MS) {
      return cachedEgress;
    }
    clearGeoCache();
    const geo = await rotateTuxlerIp(config, preferredCountry, logger);
    if (skip) {
      cachedEgress = geo;
      cachedAt = now;
    }
    return geo;
  }

  if (skip) {
    return {
      size: Math.max(1, config.concurrency || 1),
      availableCount() {
        return Math.max(1, config.concurrency || 1);
      },
      async acquire(_preferredCountry) {
        const geo = await resolveEgress(null);
        return persistTuxlerSlot(geo, config);
      },
      release(_proxy) {
        // skip: workers paralelos, sem fila
      },
      refreshEgress() {
        cachedEgress = null;
        cachedAt = 0;
        clearGeoCache();
      },
    };
  }

  let held = false;
  /** @type {Array<() => void>} */
  const waiters = [];

  function releaseWaiter() {
    held = false;
    const next = waiters.shift();
    if (next) next();
  }

  async function waitTurn() {
    if (!held) {
      held = true;
      return;
    }
    logger?.info?.('Tuxler: aguardando vez de outro worker...');
    await new Promise((resolve) => {
      waiters.push(() => {
        held = true;
        resolve();
      });
    });
  }

  return {
    size: 1,
    availableCount() {
      return held ? 0 : 1;
    },
    async acquire(preferredCountry) {
      await waitTurn();
      try {
        const geo = await resolveEgress(preferredCountry);
        return persistTuxlerSlot(geo, config);
      } catch (err) {
        logger?.warn?.(`Tuxler acquire fallback: ${err.message}`);
        const geo = await safeFetchEgress(config, logger, preferredCountry);
        return persistTuxlerSlot(geo, config);
      }
    },
    release(_proxy) {
      releaseWaiter();
    },
  };
}

function assertTuxlerReady(config, logger) {
  if (!config.tuxler?.enabled) return;

  if (!isWindows()) {
    throw new Error(
      'TUXLER_ENABLED=true mas o SO não é Windows. Desligue TUXLER_ENABLED ou use Windows com TuxlerVPN.'
    );
  }

  logger.info(
    `Tuxler ON | mode=${config.tuxler?.rotateMode || 'skip'} | exe=${config.tuxler.exePath || DEFAULT_EXE}`
  );
}

/**
 * Gate obrigatório: SOCKS online + egress medido via túnel.
 * Lança TuxlerInactiveError se Tuxler não estiver roteando.
 */
async function validateTuxlerActive(config, logger, { strategy = null } = {}) {
  if (!config.tuxler?.enabled) {
    return { ok: true, skipped: true, reason: 'tuxler-disabled' };
  }

  if (strategy?.requiresBrowser === false) {
    return { ok: true, skipped: true, reason: 'no-browser' };
  }

  if (config.tuxler?.requireActive === false) {
    return { ok: true, skipped: true, reason: 'require-active-off' };
  }

  assertTuxlerReady(config, logger);
  resetTuxlerSocksCache();
  clearGeoCache();

  const waitMs = config.tuxler?.socksWaitMs ?? 20_000;
  const endpoint = resolveTuxlerSocksEndpoint(config);
  logger.info(
    `Validando Tuxler (SOCKS ${endpoint.host}:${endpoint.port}, timeout ${Math.round(waitMs / 1000)}s)...`
  );

  const socks = await waitForTuxlerSocks({ config, logger, maxWaitMs: waitMs });
  if (!socks.open) {
    throw new TuxlerInactiveError(
      `Tuxler inativo: proxy SOCKS ${socks.host}:${socks.port} offline após ${Math.round(waitMs / 1000)}s. ` +
        'Abra o Tuxler → conecte o país → aguarde. Teste: Test-NetConnection 127.0.0.1 -Port 23321'
    );
  }

  let geo;
  try {
    geo = await lookupGeoViaSocks(socks.host, socks.port);
    geo.viaSocks = true;
  } catch (err) {
    throw new TuxlerInactiveError(
      `Tuxler SOCKS online mas egress via túnel falhou (${err.message}). Reconecte o app.`
    );
  }

  if (!geo?.ip || !geo?.countryCode) {
    throw new TuxlerInactiveError(
      'Tuxler respondeu mas IP/país do egress inválido — reconecte o Tuxler.'
    );
  }

  logger.info(
    `Tuxler OK | ip=${geo.ip} cc=${geo.countryCode} tz=${geo.timezoneId || '?'} | socks=${socks.proxyUrl}`
  );
  rememberTuxlerExit(toTuxlerSlot(geo), config);
  return { ok: true, socks, geo };
}

/** Checagem rápida (sem espera longa) — útil para CLI/API. */
async function probeTuxlerActive(config, logger = null) {
  if (!config.tuxler?.enabled) {
    return { active: false, reason: 'TUXLER_ENABLED=false' };
  }
  if (!isWindows()) {
    return { active: false, reason: 'SO não é Windows' };
  }

  const socks = await probeTuxlerSocks(config, logger);
  if (!socks.open) {
    return {
      active: false,
      reason: `SOCKS ${socks.host}:${socks.port} offline`,
      socks,
    };
  }

  try {
    clearGeoCache();
    const geo = await lookupGeoViaSocks(socks.host, socks.port);
    return {
      active: Boolean(geo?.ip && geo?.countryCode),
      socks,
      geo,
      reason: geo?.ip ? 'ok' : 'egress inválido',
    };
  } catch (err) {
    return { active: false, reason: err.message, socks };
  }
}

module.exports = {
  DEFAULT_EXE,
  isWindows,
  TuxlerInactiveError,
  safeFetchEgress,
  rotateTuxlerIp,
  createTuxlerLease,
  assertTuxlerReady,
  validateTuxlerActive,
  probeTuxlerActive,
  toTuxlerSlot,
};
