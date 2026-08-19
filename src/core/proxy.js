'use strict';

/**
 * Proxy só via este módulo + env (não espalhar --proxy-server).
 * Lista em PROXY_SERVER / PROXY_SERVERS; a identidade fixa o IP da sessão.
 */

function parseProxyList(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseProxyServer(server) {
  if (!server) return null;
  const raw = String(server).trim();
  if (!raw) return null;

  try {
    const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
    const u = new URL(withProto);
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    const username = u.username ? decodeURIComponent(u.username) : '';
    const password = u.password ? decodeURIComponent(u.password) : '';
    return {
      raw,
      protocol: (u.protocol || 'http:').replace(':', ''),
      host: u.hostname,
      port,
      username,
      password,
      arg: `${u.protocol}//${u.hostname}:${port}`,
      hasAuth: Boolean(username),
    };
  } catch {
    throw new Error(`PROXY_SERVER inválido: ${raw}`);
  }
}

function getProxyLaunchArgs(proxy) {
  if (!proxy) return [];
  return [`--proxy-server=${proxy.arg}`];
}

function getWebrtcLaunchArgs(proxyEnabled) {
  if (!proxyEnabled) return [];
  return [
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  ];
}

function assertProxyReady(proxyConfig, logger) {
  if (!proxyConfig?.enabled) {
    logger.debug('Proxy desabilitado — IP será o da máquina.');
    return;
  }
  if (!proxyConfig.servers.length) {
    throw new Error('PROXY_ENABLED=true mas nenhum PROXY_SERVER / PROXY_SERVERS foi definido');
  }
  logger.info(`Proxy habilitado | ${proxyConfig.servers.length} endpoint(s)`);
}

async function authenticateProxy(page, proxy) {
  if (!proxy?.hasAuth) return;
  await page.authenticate({ username: proxy.username, password: proxy.password });
}

module.exports = {
  parseProxyList,
  parseProxyServer,
  getProxyLaunchArgs,
  getWebrtcLaunchArgs,
  assertProxyReady,
  authenticateProxy,
};
