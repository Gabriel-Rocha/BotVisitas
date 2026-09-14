'use strict';

/**
 * IP público da máquina (egress nativo).
 * Fonte de verdade para cadência e detecção de rotação.
 */

const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const { sleep } = require('../utils/sleep');

const execFileAsync = promisify(execFile);

const IPIFY_URL = 'https://api.ipify.org';
const CACHE_TTL_MS = 60_000;
const MIN_ROTATE_GAP_MS = 2 * 24 * 60 * 60 * 1000; // 2 dias

/** @type {{ ip: string, at: number }|null} */
let cachedIp = null;
/** @type {number} */
let lastRotateAt = 0;
/** @type {string|null} */
let expectedIp = null;
/** @type {boolean} */
let pausedForInvoluntaryChange = false;

function httpGetText(url, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 256) {
          req.destroy();
          reject(new Error('Resposta IP muito grande'));
        }
      });
      res.on('end', () => resolve(String(body || '').trim()));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout ao consultar IP público'));
    });
    req.on('error', reject);
  });
}

/**
 * @param {{ force?: boolean, retries?: number }} [opts]
 * @returns {Promise<string>}
 */
async function getCurrentPublicIp({ force = false, retries = 3 } = {}) {
  if (!force && cachedIp && Date.now() - cachedIp.at < CACHE_TTL_MS) {
    return cachedIp.ip;
  }

  let lastErr;
  for (let i = 1; i <= retries; i += 1) {
    try {
      const ip = await httpGetText(IPIFY_URL);
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && !ip.includes(':')) {
        throw new Error(`IP inválido: ${ip}`);
      }
      cachedIp = { ip, at: Date.now() };
      if (!expectedIp) expectedIp = ip;
      return ip;
    } catch (err) {
      lastErr = err;
      await sleep(400 * i);
    }
  }
  throw lastErr || new Error('Falha ao obter IP público');
}

function clearIpCache() {
  cachedIp = null;
}

function getExpectedIp() {
  return expectedIp;
}

function setExpectedIp(ip) {
  expectedIp = ip || null;
}

function isPausedForIpChange() {
  return pausedForInvoluntaryChange;
}

function acknowledgeIpChange(logger = null) {
  pausedForInvoluntaryChange = false;
  if (cachedIp?.ip) expectedIp = cachedIp.ip;
  logger?.info?.(`IP involuntário confirmado — seguindo com ${expectedIp}`);
}

/**
 * Detecta CGNAT/rebalance sem pedido.
 * @returns {Promise<{ changed: boolean, previous: string|null, current: string }>}
 */
async function checkInvoluntaryRotation(logger = null) {
  const previous = expectedIp;
  const current = await getCurrentPublicIp({ force: true });
  if (previous && previous !== current) {
    pausedForInvoluntaryChange = true;
    logger?.warn?.(
      `IP mudou sem pedido: ${previous} → ${current}. PAUSADO — confirme (CGNAT) antes de continuar.`
    );
    return { changed: true, previous, current };
  }
  expectedIp = current;
  return { changed: false, previous, current };
}

/**
 * Tenta forçar novo lease no adaptador (Windows) → novo IP público em CGNAT.
 * No máximo 1x a cada 2 dias.
 */
async function rotateIp({ config = {}, logger = null, force = false } = {}) {
  const now = Date.now();
  if (!force && lastRotateAt && now - lastRotateAt < MIN_ROTATE_GAP_MS) {
    const waitH = Math.ceil((MIN_ROTATE_GAP_MS - (now - lastRotateAt)) / 3_600_000);
    logger?.warn?.(`rotateIp: aguardar ${waitH}h (máx. 1×/2 dias)`);
    return { ok: false, reason: 'cooldown', ip: await getCurrentPublicIp().catch(() => null) };
  }

  const before = await getCurrentPublicIp({ force: true }).catch(() => null);
  logger?.info?.(`rotateIp: IP atual ${before || '?'}`);

  if (process.platform !== 'win32') {
    logger?.warn?.('rotateIp: só implementado em Windows (Disable/Enable-NetAdapter)');
    return { ok: false, reason: 'not-windows', ip: before };
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'reconnect.ps1');
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { timeout: 90_000, windowsHide: true }
    );
  } catch (err) {
    logger?.warn?.(`rotateIp: script falhou — ${err.message}`);
    logger?.warn?.('Ação manual: desconecte/reconecte o adaptador ou reinicie o modem.');
    return { ok: false, reason: err.message, ip: before };
  }

  await sleep(8_000);
  clearIpCache();
  const after = await getCurrentPublicIp({ force: true }).catch(() => null);
  lastRotateAt = Date.now();

  if (after && before && after !== before) {
    expectedIp = after;
    pausedForInvoluntaryChange = false;
    logger?.info?.(`rotateIp: OK ${before} → ${after}`);
    return { ok: true, previous: before, ip: after };
  }

  logger?.warn?.(
    `rotateIp: IP não mudou (${after || before || '?'}). Ação manual necessária.`
  );
  return { ok: false, reason: 'unchanged', previous: before, ip: after || before };
}

module.exports = {
  getCurrentPublicIp,
  clearIpCache,
  getExpectedIp,
  setExpectedIp,
  isPausedForIpChange,
  acknowledgeIpChange,
  checkInvoluntaryRotation,
  rotateIp,
  CACHE_TTL_MS,
  MIN_ROTATE_GAP_MS,
};
