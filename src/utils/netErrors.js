'use strict';

/** Falhas transitórias de rede/proxy no Chromium (vale retry / trocar sticky). */
const TRANSIENT_NET_MARKERS = [
  'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_SOCKS_CONNECTION_FAILED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_TIMED_OUT',
  'ERR_NETWORK_CHANGED',
  'ERR_EMPTY_RESPONSE',
  'ERR_SSL_PROTOCOL_ERROR',
  'ERR_PROXY_AUTH_UNSUPPORTED',
  'ERR_NAME_NOT_RESOLVED',
];

function isTransientProxyError(err) {
  const msg = String(err?.message || err || '');
  return TRANSIENT_NET_MARKERS.some((m) => msg.includes(m));
}

module.exports = { isTransientProxyError, TRANSIENT_NET_MARKERS };
