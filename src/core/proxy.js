'use strict';

const net = require('net');
const { execSync } = require('child_process');
const { sleep } = require('../utils/sleep');

/** Teto de workers paralelos (RAM + lease Tuxler serializado). */
const FREE_PLAN_MAX = 40;

const DEFAULT_TUXLER_SOCKS = { host: '127.0.0.1', port: 23321 };

/** @type {{ open: boolean, host: string, port: number, proxyUrl: string|null, source: string, at: number }|null} */
let cachedSocksState = null;
/** Porta TCP aberta não basta — geo via SOCKS pode timeout com o túnel saturado. */
let tunnelOk = true;
let tunnelDownAt = 0;
const SOCKS_CACHE_MS = 3_000;
const TUNNEL_COOLDOWN_MS = 8_000;

function markTuxlerTunnelDown() {
  tunnelOk = false;
  tunnelDownAt = Date.now();
  if (cachedSocksState) {
    cachedSocksState = { ...cachedSocksState, open: false, at: Date.now() };
  }
}

function markTuxlerTunnelUp() {
  tunnelOk = true;
  tunnelDownAt = 0;
}

function isTuxlerTunnelOk() {
  if (tunnelOk) return true;
  return Date.now() - tunnelDownAt >= TUNNEL_COOLDOWN_MS;
}

function parseCountryList(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z]{2}$/.test(s));
}

/** Proxy HTTP/SOCKS explícito por worker (--proxy-server + auth na page). */
function getProxyLaunchArgs(selected) {
  if (!selected?.host || !selected?.port) return [];
  const scheme = (selected.protocol || 'http').replace(':', '');
  const server =
    scheme === 'socks5' || scheme === 'socks4'
      ? `${scheme}://${selected.host}:${selected.port}`
      : `http://${selected.host}:${selected.port}`;
  return [`--proxy-server=${server}`];
}

async function fetchProxyListUrl(listUrl, logger) {
  const url = String(listUrl || '').trim();
  if (!url) return '';
  logger?.info?.(`Baixando lista de proxies: ${url.split('?')[0]}…`);
  const res = await fetch(url, {
    headers: { Accept: 'text/plain,*/*' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`PROXY_LIST_URL HTTP ${res.status}`);
  }
  const text = await res.text();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  logger?.info?.(`Lista Webshare/proxy: ${lines.length} endpoints`);
  return lines.join('\n');
}

/**
 * Monta pool a partir de PROXY_LIST, PROXY_LIST_URL ou PROXY_SERVER (gateway sticky).
 * Formatos: http://user:pass@host:port | Webshare host:port:user:pass
 */
async function buildHttpProxyPool(config = {}, logger = null) {
  const max = Math.max(1, Math.min(Number(config.proxy?.max) || 12, FREE_PLAN_MAX));
  const countries = parseCountryList(config.workerCountries || config.proxy?.countries || '');
  let listRaw = String(config.proxy?.list || '').trim();
  if (!listRaw && config.proxy?.listUrl) {
    listRaw = await fetchProxyListUrl(config.proxy.listUrl, logger);
  }
  const serverRaw = String(config.proxy?.server || '').trim();
  const slots = [];

  if (listRaw) {
    const urls = listRaw
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (let i = 0; i < urls.length && slots.length < max; i += 1) {
      const slot = proxySlotFromUrl(urls[i], i, countries[i % (countries.length || 1)] || null);
      if (slot) slots.push(slot);
    }
  } else if (serverRaw) {
    const base = normalizeProxyUrl(serverRaw);
    if (!base) {
      throw new Error('PROXY_SERVER inválido');
    }
    let parsed;
    try {
      parsed = new URL(base);
    } catch {
      throw new Error(`PROXY_SERVER inválido: ${serverRaw}`);
    }
    for (let i = 0; i < max; i += 1) {
      const cc = countries.length ? countries[i % countries.length] : null;
      const stickyId = 10_000 + i;
      const slot = expandGatewaySlot(parsed, stickyId, cc, i);
      slots.push(slot);
    }
  }

  return slots;
}

function proxySlotFromUrl(raw, index, preferredCountry = null) {
  const proxyUrl = normalizeProxyUrl(raw);
  if (!proxyUrl) return null;
  let u;
  try {
    u = new URL(proxyUrl);
  } catch {
    return null;
  }
  const protocol = (u.protocol || 'http:').replace(':', '') || 'http';
  const username = u.username ? decodeURIComponent(u.username) : null;
  const password = u.password ? decodeURIComponent(u.password) : null;
  const country =
    preferredCountry ||
    (username && username.match(/__cr\.([a-z]{2})/i)?.[1]?.toLowerCase()) ||
    null;
  return {
    protocol,
    host: u.hostname,
    port: Number(u.port) || (protocol.startsWith('socks') ? 1080 : 80),
    username,
    password,
    country,
    isTuxler: false,
    label: `http|${country || '?'}|${u.hostname}:${u.port || '?'}#${index + 1}`,
    proxyUrl: `${protocol}://${u.hostname}:${Number(u.port) || 80}`,
  };
}

function expandGatewaySlot(parsedUrl, stickyId, countryCode, index) {
  const protocol = (parsedUrl.protocol || 'http:').replace(':', '') || 'http';
  let user = parsedUrl.username ? decodeURIComponent(parsedUrl.username) : '';
  const pass = parsedUrl.password ? decodeURIComponent(parsedUrl.password) : '';

  if (user) {
    if (countryCode && !/__cr\.[a-z]{2}/i.test(user)) {
      user = `${user}__cr.${String(countryCode).toLowerCase()}`;
    }
    if (!/;sessid\./i.test(user) && !/-session-/i.test(user)) {
      user = `${user};sessid.${stickyId}`;
    }
  }

  const port = Number(parsedUrl.port) || (protocol.startsWith('socks') ? 1080 : 80);
  return {
    protocol,
    host: parsedUrl.hostname,
    port,
    username: user || null,
    password: pass || null,
    country: countryCode || null,
    isTuxler: false,
    stickyId,
    label: `http|${countryCode || '?'}|sess${stickyId}|${parsedUrl.hostname}`,
    proxyUrl: `${protocol}://${parsedUrl.hostname}:${port}`,
  };
}

/**
 * Lease exclusivo: 1 endpoint por worker (paralelismo real, sem SOCKS único).
 */
async function createHttpProxyLease(config, logger) {
  const pool = await buildHttpProxyPool(config, logger);
  if (!pool.length) {
    throw new Error(
      'PROXY_ENABLED=true exige PROXY_LIST_URL (Webshare), PROXY_LIST ou PROXY_SERVER. Ver docs/09-proxies-webshare.md'
    );
  }

  /** @type {Set<object>} */
  const free = new Set(pool);
  /** @type {Array<{prefer: string|null, resolve: (p: object) => void}>} */
  const waiters = [];

  logger?.info?.(
    `Proxy HTTP pool | slots=${pool.length} | host=${pool[0].host}:${pool[0].port} | 1 endpoint/worker`
  );
  logger?.warn?.(
    'Webshare datacenter costuma ser marcado como proxy/anon — ads podem filtrar. Residencial costuma render melhor.'
  );

  function takePreferred(prefer) {
    const cc = String(prefer || '')
      .trim()
      .toLowerCase();
    if (cc) {
      for (const p of free) {
        if (p.country === cc) {
          free.delete(p);
          return p;
        }
      }
    }
    const first = free.values().next().value;
    if (first) free.delete(first);
    return first || null;
  }

  function pumpWaiters() {
    while (waiters.length && free.size) {
      const next = waiters.shift();
      const proxy = takePreferred(next.prefer);
      if (proxy) next.resolve(proxy);
      else break;
    }
  }

  return {
    size: pool.length,
    availableCount() {
      return free.size;
    },
    async acquire(preferredCountry) {
      const got = takePreferred(preferredCountry);
      if (got) return got;
      return new Promise((resolve) => {
        waiters.push({ prefer: preferredCountry || null, resolve });
      });
    },
    release(proxy) {
      if (!proxy) return;
      free.add(proxy);
      pumpWaiters();
    },
  };
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
  // Webshare download: host:port:user:pass
  const webshare = value.match(/^([^:\s\/]+):(\d+):([^:\s]+):(.+)$/);
  if (webshare) {
    const [, host, port, user, pass] = webshare;
    return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
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
    if (last.open && isTuxlerTunnelOk()) {
      markTuxlerTunnelUp();
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
  if (
    cachedSocksState?.open &&
    isTuxlerTunnelOk() &&
    Date.now() - cachedSocksState.at < SOCKS_CACHE_MS
  ) {
    return cachedSocksState;
  }
  if (maxWaitMs > 0) {
    return waitForTuxlerSocks({ config, logger, maxWaitMs });
  }
  const state = await probeTuxlerSocks(config, logger);
  if (state.open && !isTuxlerTunnelOk()) {
    return { ...state, open: false };
  }
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
  const waitMs = config.tuxler?.socksWaitMs ?? 20_000;
  const socks = await ensureTuxlerSocks(config, logger, waitMs);

  if (socks.open && socks.proxyUrl && isTuxlerTunnelOk()) {
    const host = socks.host || '127.0.0.1';
    logger?.info?.(`Tuxler: Chromium via ${socks.proxyUrl} (DNS pelo SOCKS, sem HTTP/2)`);
    return [
      `--proxy-server=${socks.proxyUrl}`,
      `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE ${host}`,
      '--disable-http2',
      '--disable-quic',
      '--disable-features=UseDnsHttpsSvcb,UseDnsHttpsSvcbAlpn,Http2',
    ];
  }

  if (config.tuxler?.requireActive !== false && config.tuxler?.enabled) {
    const err = new Error(
      `Tuxler SOCKS ${socks.host}:${socks.port} offline — bot não deve rodar sem VPN (TUXLER_REQUIRE_ACTIVE=true)`
    );
    err.code = 'TUXLER_SOCKS_OFFLINE';
    throw err;
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
  buildHttpProxyPool,
  createHttpProxyLease,
  readWindowsSystemProxy,
  resolveTuxlerSocksEndpoint,
  waitForTuxlerSocks,
  ensureTuxlerSocks,
  resetTuxlerSocksCache,
  probeTuxlerSocks,
  isLocalPortOpen,
  markTuxlerTunnelDown,
  markTuxlerTunnelUp,
  isTuxlerTunnelOk,
};
