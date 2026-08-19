'use strict';

/**
 * Proxy via env: PROXY_ENABLED + PROXY_SERVER.
 * Devolve args do Chromium quando habilitado.
 */

function getProxyLaunchArgs(proxyConfig) {
  if (!proxyConfig?.enabled) return [];
  if (!proxyConfig.server) {
    throw new Error('PROXY_ENABLED=true mas PROXY_SERVER está vazio');
  }
  return [`--proxy-server=${proxyConfig.server}`];
}

function assertProxyReady(proxyConfig, logger) {
  if (!proxyConfig?.enabled) {
    logger.debug('Proxy desabilitado.');
    return;
  }
  logger.info(`Proxy habilitado: ${proxyConfig.server}`);
  if (!proxyConfig.server) {
    throw new Error('PROXY_SERVER obrigatório quando PROXY_ENABLED=true');
  }
}

module.exports = {
  getProxyLaunchArgs,
  assertProxyReady,
};
