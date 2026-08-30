'use strict';

/**
 * Proxies — lista (Webshare etc.) ou gateway (DataImpulse).
 * Formatos aceitos por entrada:
 *   http://user:pass@host:port
 *   host:port:user:pass          (export típico Webshare)
 *   host:port
 *
 * Chromium: --proxy-server SEM credenciais + page.authenticate().
 * Workers: acquire/release exclusivo (1 proxy = 1 browser por vez).
 */

/** Teto absoluto de workers/proxies paralelos (RAM + sticky ports). */
const FREE_PLAN_MAX = 40;

const TOR_SOCKS_PORTS = new Set(['9050', '9051', '9150']);

function assertNotTorProxy(host, port) {
  const h = String(host || '').toLowerCase();
  const p = String(port || '');
  const isLocal = h === '127.0.0.1' || h === 'localhost' || h === '::1';
  if (isLocal && TOR_SOCKS_PORTS.has(p)) {
    throw new Error(
      'Tor SOCKS (127.0.0.1:9050/9150) não é suportado — use TUXLER_ENABLED=true no Windows'
    );
  }
}

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
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    assertNotTorProxy(url.hostname, port);
    return {
      protocol: url.protocol.replace(':', '') || 'http',
      host: url.hostname,
      port,
      username,
      password,
      label: `${url.hostname}:${url.port || '80'}`,
    };
  }

  const parts = entry.split(':');
  if (parts.length === 2) {
    assertNotTorProxy(parts[0], parts[1]);
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
    assertNotTorProxy(host, port);
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

function parseCountryList(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z]{2}$/.test(s));
}

/**
 * DataImpulse: país no username → login__cr.us
 * Não duplica se já houver __cr.xx no login.
 */
function withCountryTarget(username, countryCode) {
  if (!username || !countryCode) return username;
  const cc = String(countryCode).toLowerCase();
  if (/__cr\.[a-z]{2}/i.test(username)) return username;
  return `${username}__cr.${cc}`;
}

function buildProxyPool(proxyConfig) {
  const max = Math.min(
    Math.max(1, proxyConfig.maxProxies || FREE_PLAN_MAX),
    FREE_PLAN_MAX
  );

  const countries = parseCountryList(proxyConfig.countries || '');

  let pool = [];
  if (proxyConfig.list?.length) {
    pool = proxyConfig.list.map((entry, i) => {
      const clone = { ...entry };
      if (countries.length && clone.username) {
        const cc = countries[i % countries.length];
        clone.username = withCountryTarget(clone.username, cc);
        clone.country = cc;
        clone.label = `${clone.label || `${clone.host}:${clone.port}`}|${cc}`;
      }
      return clone;
    });
  } else if (proxyConfig.server) {
    // Gateway rotativo (DataImpulse, Zyte, etc.): N slots = até PROXY_MAX workers.
    const entry = parseProxyEntry(proxyConfig.server);
    const stickyBase =
      /dataimpulse\.com$/i.test(entry.host) && Number(entry.port) === 823
        ? 10000 // DataImpulse sticky 10000–20000 (evita 2 workers no mesmo IP rotativo)
        : null;
    pool = Array.from({ length: max }, (_, i) => {
      const clone = { ...entry };
      if (stickyBase != null) {
        clone.port = String(stickyBase + i);
        clone.label = `${clone.host}:${clone.port}`;
      }
      if (countries.length && clone.username) {
        const cc = countries[i % countries.length];
        clone.username = withCountryTarget(clone.username, cc);
        clone.country = cc;
        clone.label = `${clone.label}|${cc}`;
      }
      return clone;
    });
  }

  if (pool.length > max) {
    pool = pool.slice(0, max);
  }

  return { pool, max, countries };
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
    acquire(preferredCountry) {
      if (!available.length) {
        throw new Error('Nenhuma proxy livre no pool (todas em uso)');
      }
      const want = String(preferredCountry || '').toLowerCase();
      let index = 0;
      if (want) {
        const found = available.findIndex(
          (item) => String(item.country || '').toLowerCase() === want
        );
        if (found >= 0) index = found;
      }
      const proxy = available.splice(index, 1)[0];
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
  if (!selected || selected.isTuxler) return [];
  // Chromium: preferir host:port (sem scheme). DataImpulse e vários guias
  // recomendam isso; `https://` no proxy causa ERR_SSL_PROTOCOL_ERROR.
  // `http://host:port` também funciona na maioria dos casos, mas host:port é o mais seguro.
  const args = [`--proxy-server=${selected.host}:${selected.port}`];
  if (/dataimpulse\.com$/i.test(selected.host)) {
    args.push('--disable-quic');
  }
  return args;
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

  const { pool, max, countries } = buildProxyPool(proxyConfig);
  if (!pool.length) {
    throw new Error(
      'PROXY_ENABLED=true mas nenhuma proxy configurada (PROXY_LIST ou PROXY_SERVER)'
    );
  }

  if ((proxyConfig.list?.length || 0) > FREE_PLAN_MAX) {
    logger.warn(
      `PROXY_LIST tem mais de ${FREE_PLAN_MAX} entradas — usando só as ${max} primeiras (teto do pool).`
    );
  }

  const geoLabel = countries?.length ? ` | countries=${countries.join(',')}` : '';
  logger.info(
    `Proxy ON | pool=${pool.length}/${max} | lease=exclusive | host=${pool[0]?.host || '?'}${geoLabel}`
  );
}

module.exports = {
  FREE_PLAN_MAX,
  parseProxyEntry,
  parseProxyList,
  parseCountryList,
  withCountryTarget,
  buildProxyPool,
  createProxyLease,
  getProxyLaunchArgs,
  applyProxyAuth,
  assertProxyReady,
};
