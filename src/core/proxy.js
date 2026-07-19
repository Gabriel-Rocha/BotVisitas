'use strict';

/**
 * Stub de proxy — pronto para evoluir sem espalhar ifs no browser.
 * Hoje: só devolve args do Chromium se PROXY_ENABLED=true e PROXY_SERVER estiver setado.
 *
 * Evolução futura (quando houver orçamento):
 * - carregar lista de proxies
 * - rotação / health-check
 * - auth user:pass
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
    logger.debug('Proxy desabilitado (esperado no v1).');
    return;
  }
  logger.warn('Proxy habilitado — recurso experimental / preparar custo.');
  if (!proxyConfig.server) {
    throw new Error('PROXY_SERVER obrigatório quando PROXY_ENABLED=true');
  }
}

module.exports = {
  getProxyLaunchArgs,
  assertProxyReady,
};
