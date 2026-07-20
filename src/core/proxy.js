'use strict';

/**
 * Proxies — pensado para o plano free Webshare (máx. 10).
 * https://www.webshare.io/pricing
 *
 * Formatos aceitos por entrada:
 *   http://user:pass@host:port
 *   host:port:user:pass          (export típico Webshare)
 *   host:port
 *
 * Chromium: --proxy-server SEM credenciais + page.authenticate().
 * Workers: acquire/release exclusivo (1 proxy = 1 browser por vez).
 */

const FREE_PLAN_MAX = 10;

function stripQuotes(s) {
  return String(s || '').trim().replace(/^['"]|['"]$/g, '');
}

/**
 * @returns {{ protocol: string, host: string, port: string, username: string|null, password: string|null, label: string }}
 */
function parseProxyEntry(raw) {
  const entry = stripQuotes(raw);
  if (!entry) return null;

  if (/^[a-z]+:\/\//i.test(entry)) {
    let url;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`Proxy inválido (URL): ${entry}`);
    }
    const username = url.username ? decodeURIComponent(url.username) : null;
    const password = url.password ? decodeURIComponent(url.password) : null;
    return {
      protocol: url.protocol.replace(':', '') || 'http',
      host: url.hostname,
      port: url.port || (url.protocol === 'https:' ? '443' : '80'),
      username,
      password,
      label: `${url.hostname}:${url.port || '80'}`,
    };
  }

  const parts = entry.split(':');
  if (parts.length === 2) {
    return {
      protocol: 'http',
      host: parts[0],
      port: parts[1],
      username: null,
      password: null,
      label: `${parts[0]}:${parts[1]}`,
    };
  }
  if (parts.length >= 4) {
    const [host, port, username, ...rest] = parts;
    const password = rest.join(':');
    return {
      protocol: 'http',
      host,
      port,
      username,
      password,
      label: `${host}:${port}`,
    };
  }

  throw new Error(
    `Proxy inválido: "${entry}". Use http://user:pass@host:port ou host:port:user:pass`
  );
}

function parseProxyList(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseProxyEntry)
    .filter(Boolean);
}

function buildProxyPool(proxyConfig) {
  const max = Math.min(
    Math.max(1, proxyConfig.maxProxies || FREE_PLAN_MAX),
    FREE_PLAN_MAX
  );

  let pool = [];
  if (proxyConfig.list?.length) {
    pool = [...proxyConfig.list];
  } else if (proxyConfig.server) {
    pool = [parseProxyEntry(proxyConfig.server)];
  }

  if (pool.length > max) {
    pool = pool.slice(0, max);
  }

  return { pool, max };
}

/**
 * Lease exclusivo: enquanto um worker segura o proxy, outro não o usa.
 */
function createProxyLease(pool) {
  const available = [...pool];
  const leased = new Set();

  return {
    size: pool.length,
    availableCount() {
      return available.length;
    },
    acquire() {
      if (!available.length) {
        throw new Error('Nenhuma proxy livre no pool (todas em uso)');
      }
      const proxy = available.shift();
      leased.add(proxy);
      return proxy;
    },
    release(proxy) {
      if (!proxy || !leased.has(proxy)) return;
      leased.delete(proxy);
      available.push(proxy);
    },
  };
}

function getProxyLaunchArgs(selected) {
  if (!selected) return [];
  return [`--proxy-server=${selected.protocol}://${selected.host}:${selected.port}`];
}

async function applyProxyAuth(page, selected) {
  if (!selected?.username) return;
  await page.authenticate({
    username: selected.username,
    password: selected.password || '',
  });
}

function assertProxyReady(proxyConfig, logger) {
  if (!proxyConfig?.enabled) {
    logger.debug('Proxy desabilitado.');
    return;
  }

  const { pool, max } = buildProxyPool(proxyConfig);
  if (!pool.length) {
    throw new Error(
      'PROXY_ENABLED=true mas nenhuma proxy configurada (PROXY_LIST ou PROXY_SERVER)'
    );
  }

  if ((proxyConfig.list?.length || 0) > FREE_PLAN_MAX) {
    logger.warn(
      `PROXY_LIST tem mais de ${FREE_PLAN_MAX} entradas — plano free Webshare: usando só as ${max} primeiras.`
    );
  }

  logger.info(
    `Proxy ON | pool=${pool.length}/${max} | lease=exclusive | provider=webshare-free-cap`
  );
}

module.exports = {
  FREE_PLAN_MAX,
  parseProxyEntry,
  parseProxyList,
  buildProxyPool,
  createProxyLease,
  getProxyLaunchArgs,
  applyProxyAuth,
  assertProxyReady,
};
