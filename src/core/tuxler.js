'use strict';

/**
 * TuxlerVPN (Windows) — egress residencial gratuito via VPN de sistema.
 * Sem API oficial: rotação via scripts/tuxler-rotate.ps1 (UI Automation).
 *
 * Limitação: 1 IP ativo por máquina. Vários workers compartilham um mutex —
 * cada um rotaciona o Tuxler ao adquirir o lease (IP diferente por rodada).
 */

const { spawn } = require('child_process');
const path = require('path');
const { lookupGeo, clearGeoCache } = require('./geo');
const { sleep } = require('../utils/sleep');

const DEFAULT_EXE = 'C:\\Program Files (x86)\\tuxlerVPN\\tuxlerVPN.exe';

function isWindows() {
  return process.platform === 'win32';
}

function rotateScriptPath() {
  return path.join(process.cwd(), 'scripts', 'tuxler-rotate.ps1');
}

async function fetchEgress() {
  clearGeoCache();
  return lookupGeo(null);
}

function runPowerShellRotate(config, countryCode, logger) {
  const script = rotateScriptPath();
  const timeoutSec = Math.max(30, Math.ceil((config.tuxler?.rotateTimeoutMs || 90_000) / 1000));
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
  ];
  const cc = String(countryCode || '').trim().toLowerCase();
  if (cc) {
    args.push('-Country', cc);
  }

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      const out = stdout.trim();
      const errOut = stderr.trim();
      if (code === 0) {
        if (logger?.debug) logger.debug(`tuxler-rotate: ${out || 'ok'}`);
        resolve(out);
        return;
      }
      reject(new Error(errOut || out || `tuxler-rotate.ps1 exit ${code}`));
    });
  });
}

/**
 * Gira o IP no Tuxler e espera mudança de egress (ou país alvo).
 */
async function rotateTuxlerIp(config, countryCode, logger) {
  if (!isWindows()) {
    throw new Error('TUXLER_ENABLED exige Windows com TuxlerVPN instalado');
  }

  const before = await fetchEgress();
  logger?.info?.(
    `Tuxler rotate | antes ip=${before.ip || '?'} cc=${before.countryCode || '?'} alvo=${countryCode || 'auto'}`
  );

  await runPowerShellRotate(config, countryCode, logger);

  const deadline = Date.now() + (config.tuxler?.rotateTimeoutMs || 90_000);
  const want = String(countryCode || '').toLowerCase();
  let after = before;

  while (Date.now() < deadline) {
    await sleep(2500);
    after = await fetchEgress();

    const ipChanged = after.ip && before.ip && after.ip !== before.ip;
    const countryOk =
      !want || String(after.countryCode || '').toLowerCase() === want;

    if (ipChanged || (countryOk && after.ip)) {
      logger?.info?.(
        `Tuxler rotate OK | ip=${after.ip || '?'} cc=${after.countryCode || '?'}`
      );
      return after;
    }
  }

  if (after.ip) {
    logger?.warn?.(
      `Tuxler: timeout aguardando IP novo (usando ip=${after.ip} cc=${after.countryCode || '?'})`
    );
    return after;
  }

  throw new Error('Tuxler: não foi possível confirmar IP de saída após rotação');
}

function toTuxlerSlot(geo, preferredCountry) {
  const cc = String(geo.countryCode || preferredCountry || '')
    .trim()
    .toLowerCase();
  return {
    protocol: 'tuxler',
    host: null,
    port: null,
    username: null,
    password: null,
    isTuxler: true,
    country: cc,
    ip: geo.ip || null,
    label: `tuxler|${cc || '?'}|${geo.ip || '?'}`,
  };
}

/**
 * Lease exclusivo: 1 worker por vez no Tuxler (VPN de sistema).
 * Cada acquire() rotaciona o IP antes de liberar o browser.
 */
function createTuxlerLease(config, logger) {
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
        const geo = await rotateTuxlerIp(config, preferredCountry, logger);
        return toTuxlerSlot(geo, preferredCountry);
      } catch (err) {
        releaseWaiter();
        throw err;
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
      'TUXLER_ENABLED=true mas o SO não é Windows. Use PROXY_LIST ou desligue TUXLER_ENABLED.'
    );
  }

  if (config.proxy?.enabled && (config.proxy.list?.length || config.proxy.server)) {
    logger.warn(
      'TUXLER_ENABLED + PROXY_ENABLED: o tráfego segue a VPN do Tuxler (Chromium sem --proxy-server). PROXY_* é ignorado.'
    );
  }

  logger.info(
    `Tuxler ON | Windows | rotação por worker (1 IP por vez) | exe=${config.tuxler.exePath || DEFAULT_EXE}`
  );
}

module.exports = {
  DEFAULT_EXE,
  isWindows,
  fetchEgress,
  rotateTuxlerIp,
  createTuxlerLease,
  assertTuxlerReady,
  toTuxlerSlot,
};
