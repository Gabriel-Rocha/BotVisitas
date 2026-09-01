'use strict';

const net = require('net');
const { execSync } = require('child_process');
const { sleep } = require('../utils/sleep');

/** Teto de workers paralelos (RAM + lease Tuxler serializado). */
const FREE_PLAN_MAX = 40;

const DEFAULT_TUXLER_SOCKS = { host: '127.0.0.1', port: 23321 };

/** @type {{ open: boolean, host: string, port: number, proxyUrl: string|null, source: string, at: number }|null} */
let cachedSocksState = null;

function parseCountryList(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z]{2}$/.test(s));
}

/** Proxy HTTP explícito (legado) — vazio por padrão. */
function getProxyLaunchArgs(_selected) {
  return [];
}

function readWindowsSystemProxy() {
  if (process.platform !== 'win32') {
    return { enabled: false, server: null };
  }
  try {
    const script =
      "$p = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; " +
      '[pscustomobject]@{ enable = [int]$p.ProxyEnable; server = [string]$p.ProxyServer } | ConvertTo-Json -Compress';
    const raw = execSync(`powershell -NoProfile -Command "${script}"`, {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    }).trim();
    const data = JSON.parse(raw);
    return {
      enabled: Boolean(Number(data.enable)),
      server: String(data.server || '').trim() || null,
    };
  } catch {
    return { enabled: false, server: null };
  }
}

function normalizeProxyUrl(raw) {
  if (!raw) return null;
  let value = String(raw).trim();
  if (!value) return null;
  if (/^socks=/i.test(value)) {
    value = value.replace(/^socks=/i, 'socks5://');
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `http://${value}`;
  }
  return value;
}

function parseProxyEndpoint(proxyUrl) {
  try {
    const url = new URL(proxyUrl);
    return {
      host: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      proxyUrl,
    };
  } catch {
    return null;
  }
}

function isLocalPortOpen(host, port, timeoutMs = 900) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

/**
 * Resolve endpoint SOCKS do Tuxler (Windows proxy ou env).
 */
function resolveTuxlerSocksEndpoint(config = {}) {
  const envHost = (process.env.TUXLER_SOCKS_HOST || config.tuxler?.socksHost || '').trim();
  const envPort = Number.parseInt(process.env.TUXLER_SOCKS_PORT || config.tuxler?.socksPort || '', 10);

  if (envHost && Number.isFinite(envPort) && envPort > 0) {
    return {
      host: envHost,
      port: envPort,
      proxyUrl: `socks5://${envHost}:${envPort}`,
      source: 'env',
    };
  }

  const { enabled, server } = readWindowsSystemProxy();
  if (enabled && server) {
    const proxyUrl = normalizeProxyUrl(server);
    const endpoint = parseProxyEndpoint(proxyUrl);
    if (endpoint && /^socks/i.test(proxyUrl)) {
      return { ...endpoint, source: 'windows-proxy' };
    }
  }

  return {
    host: DEFAULT_TUXLER_SOCKS.host,
    port: DEFAULT_TUXLER_SOCKS.port,
    proxyUrl: `socks5://${DEFAULT_TUXLER_SOCKS.host}:${DEFAULT_TUXLER_SOCKS.port}`,
    source: 'default',
  };
}

async function probeTuxlerSocks(config = {}, logger = null) {
  const endpoint = resolveTuxlerSocksEndpoint(config);
  const open = await isLocalPortOpen(endpoint.host, endpoint.port, 1200);
  const state = {
    open,
    host: endpoint.host,
    port: endpoint.port,
    proxyUrl: endpoint.proxyUrl,
    source: endpoint.source,
    at: Date.now(),
  };
  if (!open && logger?.debug) {
    logger.debug(
      `Tuxler SOCKS ${endpoint.host}:${endpoint.port} fechado (fonte=${endpoint.source})`
    );
  }
  return state;
}

/**
 * Aguarda o SOCKS local do Tuxler (127.0.0.1:23321) ficar online.
 */
async function waitForTuxlerSocks({ config = {}, logger = null, maxWaitMs = 20_000 } = {}) {
  const deadline = Date.now() + Math.max(0, maxWaitMs);
  let last = null;

  while (Date.now() <= deadline) {
    last = await probeTuxlerSocks(config, logger);
    if (last.open) {
      cachedSocksState = last;
      if (logger) {
        logger.info(
          `Tuxler SOCKS online: ${last.proxyUrl} (fonte=${last.source}) — tráfego via VPN do app`
        );
      }
      return last;
    }
    if (Date.now() >= deadline) break;
    await sleep(1000);
  }

  cachedSocksState = last || {
    open: false,
    host: DEFAULT_TUXLER_SOCKS.host,
    port: DEFAULT_TUXLER_SOCKS.port,
    proxyUrl: null,
    source: 'offline',
    at: Date.now(),
  };

  if (logger) {
    logger.warn(
      `Tuxler SOCKS offline (${cachedSocksState.host}:${cachedSocksState.port}) após ${maxWaitMs}ms — ` +
        'Node/Chromium saem pelo IP LOCAL até reconectar o app (Abrir Tuxler → conectar país → aguardar proxy).'
    );
  }
  return cachedSocksState;
}

async function ensureTuxlerSocks(config, logger, maxWaitMs = 0) {
  if (cachedSocksState?.open && Date.now() - cachedSocksState.at < 30_000) {
    return cachedSocksState;
  }
  if (maxWaitMs > 0) {
    return waitForTuxlerSocks({ config, logger, maxWaitMs });
  }
  const state = await probeTuxlerSocks(config, logger);
  cachedSocksState = state;
  return state;
}

function resetTuxlerSocksCache() {
  cachedSocksState = null;
}

/**
 * Tuxler define proxy SOCKS no Windows (ex.: socks=127.0.0.1:23321).
 * Só usa Chromium via SOCKS quando a porta local responde.
 */
async function getTuxlerLaunchArgs(logger, config = {}) {
  const socks = await ensureTuxlerSocks(config, logger, 0);

  if (socks.open && socks.proxyUrl) {
    logger?.info?.(`Tuxler: Chromium via ${socks.proxyUrl}`);
    return [`--proxy-server=${socks.proxyUrl}`];
  }

  if (config.tuxler?.requireActive !== false && config.tuxler?.enabled) {
    throw new Error(
      `Tuxler SOCKS ${socks.host}:${socks.port} offline — bot não deve rodar sem VPN (TUXLER_REQUIRE_ACTIVE=true)`
    );
  }

  logger?.warn?.(
    `Tuxler: Chromium direct:// — SOCKS ${socks.host}:${socks.port} offline; visitas NÃO passam pela VPN do app`
  );
  return ['--proxy-server=direct://'];
}

module.exports = {
  FREE_PLAN_MAX,
  parseCountryList,
  getProxyLaunchArgs,
  getTuxlerLaunchArgs,
  readWindowsSystemProxy,
  resolveTuxlerSocksEndpoint,
  waitForTuxlerSocks,
  ensureTuxlerSocks,
  resetTuxlerSocksCache,
  probeTuxlerSocks,
  isLocalPortOpen,
};
