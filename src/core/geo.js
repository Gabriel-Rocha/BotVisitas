'use strict';

/**
 * Geo → timezone/locale a partir do IP (proxy ou egress).
 * Alinha fingerprint de fuso horário à região vista pelo site alvo.
 *
 * Fonte: ip-api.com (free, sem API key). Falha → fallback do .env.
 * Cache em memória por IP/host (processo).
 */

const http = require('http');
const https = require('https');
const net = require('net');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const LOOKUP_TIMEOUT_MS = 12_000;

/** @type {Map<string, { at: number, data: object }>} */
const cache = new Map();

/**
 * Fallback país → timezone + locale quando a API não devolver timezone.
 * Cobertura focada em regiões comuns de proxies residenciais/datacenter.
 */
const COUNTRY_HINTS = {
  BR: { timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' },
  PT: { timezoneId: 'Europe/Lisbon', locale: 'pt-PT' },
  US: { timezoneId: 'America/New_York', locale: 'en-US' },
  CA: { timezoneId: 'America/Toronto', locale: 'en-CA' },
  MX: { timezoneId: 'America/Mexico_City', locale: 'es-MX' },
  AR: { timezoneId: 'America/Argentina/Buenos_Aires', locale: 'es-AR' },
  CL: { timezoneId: 'America/Santiago', locale: 'es-CL' },
  CO: { timezoneId: 'America/Bogota', locale: 'es-CO' },
  PE: { timezoneId: 'America/Lima', locale: 'es-PE' },
  VE: { timezoneId: 'America/Caracas', locale: 'es-VE' },
  EC: { timezoneId: 'America/Guayaquil', locale: 'es-EC' },
  UY: { timezoneId: 'America/Montevideo', locale: 'es-UY' },
  PY: { timezoneId: 'America/Asuncion', locale: 'es-PY' },
  BO: { timezoneId: 'America/La_Paz', locale: 'es-BO' },
  GB: { timezoneId: 'Europe/London', locale: 'en-GB' },
  IE: { timezoneId: 'Europe/Dublin', locale: 'en-IE' },
  FR: { timezoneId: 'Europe/Paris', locale: 'fr-FR' },
  DE: { timezoneId: 'Europe/Berlin', locale: 'de-DE' },
  ES: { timezoneId: 'Europe/Madrid', locale: 'es-ES' },
  IT: { timezoneId: 'Europe/Rome', locale: 'it-IT' },
  NL: { timezoneId: 'Europe/Amsterdam', locale: 'nl-NL' },
  PL: { timezoneId: 'Europe/Warsaw', locale: 'pl-PL' },
  TR: { timezoneId: 'Europe/Istanbul', locale: 'tr-TR' },
  IN: { timezoneId: 'Asia/Kolkata', locale: 'en-IN' },
  JP: { timezoneId: 'Asia/Tokyo', locale: 'ja-JP' },
  KR: { timezoneId: 'Asia/Seoul', locale: 'ko-KR' },
  SG: { timezoneId: 'Asia/Singapore', locale: 'en-SG' },
  AU: { timezoneId: 'Australia/Sydney', locale: 'en-AU' },
  NZ: { timezoneId: 'Pacific/Auckland', locale: 'en-NZ' },
  ZA: { timezoneId: 'Africa/Johannesburg', locale: 'en-ZA' },
  AE: { timezoneId: 'Asia/Dubai', locale: 'ar-AE' },
  RU: { timezoneId: 'Europe/Moscow', locale: 'ru-RU' },
};

function languagesForLocale(locale) {
  const loc = String(locale || 'pt-BR');
  const lower = loc.toLowerCase();
  if (lower.startsWith('pt')) return [loc, 'pt', 'en-US', 'en'];
  if (lower.startsWith('es')) return [loc, 'es', 'en-US', 'en'];
  if (lower.startsWith('fr')) return [loc, 'fr', 'en-US', 'en'];
  if (lower.startsWith('de')) return [loc, 'de', 'en-US', 'en'];
  if (lower.startsWith('it')) return [loc, 'it', 'en-US', 'en'];
  if (lower.startsWith('nl')) return [loc, 'nl', 'en-US', 'en'];
  if (lower.startsWith('pl')) return [loc, 'pl', 'en-US', 'en'];
  if (lower.startsWith('ja')) return [loc, 'ja', 'en-US', 'en'];
  if (lower.startsWith('ko')) return [loc, 'ko', 'en-US', 'en'];
  if (lower.startsWith('ru')) return [loc, 'ru', 'en-US', 'en'];
  if (lower.startsWith('ar')) return [loc, 'ar', 'en-US', 'en'];
  if (lower.startsWith('en-gb')) return ['en-GB', 'en'];
  return [loc, 'en'];
}

function acceptLanguageHeader(locale) {
  const langs = languagesForLocale(locale);
  return langs
    .map((lang, i) => (i === 0 ? lang : `${lang};q=${Math.max(0.5, (10 - i) / 10)}`))
    .join(',');
}

function httpGetJson(url, timeoutMs = LOOKUP_TIMEOUT_MS) {
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
        if (body.length > 64_000) {
          req.destroy();
          reject(new Error('Resposta geo muito grande'));
        }
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout no lookup geo'));
    });
    req.on('error', reject);
  });
}

function consumeSocks5ConnectResponse(buffer) {
  if (buffer.length < 4) return { ready: false, rest: buffer };
  if (buffer[0] !== 0x05) throw new Error('SOCKS resposta inválida');
  if (buffer[1] !== 0x00) throw new Error(`SOCKS CONNECT falhou (código ${buffer[1]})`);
  const atyp = buffer[3];
  let need = 4;
  if (atyp === 0x01) need += 4 + 2;
  else if (atyp === 0x04) need += 16 + 2;
  else if (atyp === 0x03) {
    if (buffer.length < 5) return { ready: false, rest: buffer };
    need += 1 + buffer[4] + 2;
  } else {
    throw new Error(`SOCKS ATYP desconhecido (${atyp})`);
  }
  if (buffer.length < need) return { ready: false, rest: buffer };
  return { ready: true, rest: buffer.slice(need) };
}

function socks5Connect(socket, destHost, destPort) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let stage = 'greet';

    const fail = (err) => {
      socket.removeAllListeners('data');
      reject(err);
    };

    socket.once('error', fail);

    socket.once('connect', () => {
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });

    socket.on('data', (chunk) => {
      try {
        buffer = Buffer.concat([buffer, chunk]);
        if (stage === 'greet') {
          if (buffer.length < 2) return;
          if (buffer[0] !== 0x05 || buffer[1] !== 0x00) {
            fail(new Error('SOCKS auth não suportada'));
            return;
          }
          buffer = buffer.slice(2);
          stage = 'connect';
          const hostBuf = Buffer.from(destHost, 'utf8');
          const req = Buffer.alloc(7 + hostBuf.length);
          req[0] = 0x05;
          req[1] = 0x01;
          req[2] = 0x00;
          req[3] = 0x03;
          req[4] = hostBuf.length;
          hostBuf.copy(req, 5);
          req.writeUInt16BE(destPort, 5 + hostBuf.length);
          socket.write(req);
        }
        if (stage === 'connect') {
          const parsed = consumeSocks5ConnectResponse(buffer);
          if (!parsed.ready) return;
          socket.removeListener('error', fail);
          socket.removeAllListeners('data');
          resolve({ socket, pending: parsed.rest });
        }
      } catch (err) {
        fail(err);
      }
    });
  });
}

function httpGetJsonViaSocks5(socksHost, socksPort, absoluteUrl, timeoutMs = LOOKUP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const target = new URL(absoluteUrl);
    const destPort = Number(target.port) || (target.protocol === 'https:' ? 443 : 80);
    const socket = net.connect({ host: socksHost, port: socksPort, timeout: timeoutMs });
    let settled = false;
    let body = '';

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => finish(new Error('Timeout geo via SOCKS')), timeoutMs);

    socket.once('error', (err) => finish(err));

    socks5Connect(socket, target.hostname, destPort)
      .then(({ socket: sock, pending }) => {
        const path = `${target.pathname}${target.search}`;
        sock.write(
          `GET ${path} HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\nAccept: application/json\r\n\r\n`
        );

        let raw = pending.length ? pending.toString('utf8') : '';
        sock.setEncoding('utf8');
        sock.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > 96_000) finish(new Error('Resposta geo muito grande'));
        });
        sock.on('end', () => {
          const split = raw.indexOf('\r\n\r\n');
          if (split < 0) {
            finish(new Error('Resposta HTTP inválida via SOCKS'));
            return;
          }
          body = raw.slice(split + 4);
          const statusLine = raw.split('\r\n')[0] || '';
          const code = Number.parseInt(statusLine.split(' ')[1], 10);
          if (code >= 400) {
            finish(new Error(`HTTP ${code} via SOCKS`));
            return;
          }
          try {
            finish(null, JSON.parse(body));
          } catch (err) {
            finish(err);
          }
        });
        sock.on('error', (err) => finish(err));
      })
      .catch((err) => finish(err));
  });
}

function httpGetJsonViaHttpProxy(proxy, absoluteUrl, timeoutMs = LOOKUP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const target = new URL(absoluteUrl);
    const headers = {
      Host: target.host,
      Connection: 'close',
    };
    if (proxy.username) {
      const token = Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64');
      headers['Proxy-Authorization'] = `Basic ${token}`;
    }

    const req = http.request(
      {
        host: proxy.host,
        port: Number(proxy.port) || 80,
        method: 'GET',
        path: absoluteUrl,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode === 407) {
          res.resume();
          reject(new Error('Proxy exige autenticação (407)'));
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 64_000) {
            req.destroy();
            reject(new Error('Resposta geo muito grande'));
          }
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout no probe via proxy'));
    });
    req.on('error', reject);
    req.end();
  });
}

function geoFromApiRaw(raw, fallbackIp) {
  if (!raw || raw.status !== 'success') {
    throw new Error(raw?.message || 'geo lookup falhou');
  }
  const countryCode = String(raw.countryCode || '').toUpperCase();
  const hint = COUNTRY_HINTS[countryCode] || null;
  return {
    ip: raw.query || fallbackIp || null,
    country: raw.country || null,
    countryCode: countryCode || null,
    timezoneId: raw.timezone || hint?.timezoneId || null,
    locale: hint?.locale || null,
    isp: raw.isp || null,
    org: raw.org || null,
    as: raw.as || null,
    isProxy: Boolean(raw.proxy),
    isHosting: Boolean(raw.hosting),
    source: 'ip-api',
  };
}

async function lookupGeoViaSocks(socksHost, socksPort) {
  const key = `socks:${socksHost}:${socksPort}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  const fields =
    'status,message,country,countryCode,timezone,query,isp,org,as,proxy,hosting';
  const url = `http://ip-api.com/json/?fields=${fields}`;
  const raw = await httpGetJsonViaSocks5(socksHost, socksPort, url);
  const data = geoFromApiRaw(raw, null);
  data.source = 'ip-api-via-socks';
  cache.set(key, { at: Date.now(), data });
  return data;
}

/**
 * Mede egress Tuxler: SOCKS do app (VPN) ou IP local se SOCKS offline.
 */
async function lookupTuxlerEgress({ socksHost, socksPort, socksOpen, logger = null } = {}) {
  if (socksOpen && socksHost && socksPort) {
    try {
      const viaSocks = await lookupGeoViaSocks(socksHost, socksPort);
      viaSocks.viaSocks = true;
      return viaSocks;
    } catch (err) {
      logger?.warn?.(`Geo via SOCKS falhou (${err.message}) — tentando IP local`);
    }
  }

  const local = await lookupGeo(null);
  local.viaSocks = false;
  local.source = `${local.source || 'ip-api'}-local-fallback`;
  if (logger) {
    logger.warn(
      `Geo medido pelo IP LOCAL (${local.ip || '?'} cc=${local.countryCode || '?'}) — ` +
        'Tuxler SOCKS offline; reconecte o app para refletir Venezuela/outro país.'
    );
  }
  return local;
}

async function lookupGeo(ipOrHost) {
  const key = (ipOrHost && String(ipOrHost).trim()) || '__egress__';
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  const fields =
    'status,message,country,countryCode,timezone,query,isp,org,as,proxy,hosting';
  const path = ipOrHost
    ? `http://ip-api.com/json/${encodeURIComponent(ipOrHost)}?fields=${fields}`
    : `http://ip-api.com/json/?fields=${fields}`;

  const raw = await httpGetJson(path);
  const data = geoFromApiRaw(raw, ipOrHost);
  cache.set(key, { at: Date.now(), data });
  return data;
}

/**
 * Reputação do IP de SAÍDA visto pela internet (pedido sai pelo proxy).
 * lookupGeo(proxy.host) só olha o gateway — o egress pode ser outro IP.
 */
async function lookupGeoViaProxy(proxy) {
  if (!proxy?.host) return lookupGeo(null);
  const key = `via:${proxy.label || `${proxy.host}:${proxy.port}`}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  const fields =
    'status,message,country,countryCode,timezone,query,isp,org,as,proxy,hosting';
  const url = `http://ip-api.com/json/?fields=${fields}`;

  try {
    const raw = await httpGetJsonViaHttpProxy(proxy, url);
    const data = geoFromApiRaw(raw, proxy.host);
    data.source = 'ip-api-via-proxy';
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) {
    const fallback = await lookupGeo(proxy.host);
    fallback.source = `ip-api-host (${err.message})`;
    return fallback;
  }
}

/**
 * Monta hints de locale a partir de geo já resolvido (ex.: egress Tuxler).
 */
function buildLocaleFromGeo(geo, fallbackTimezone = 'UTC', fallbackLocale = 'en-US') {
  const cc = String(geo?.countryCode || '').toUpperCase();
  const hint = cc ? COUNTRY_HINTS[cc] : null;
  const timezoneId = geo?.timezoneId || hint?.timezoneId || fallbackTimezone;
  const locale = geo?.locale || hint?.locale || fallbackLocale;
  return {
    timezoneId,
    locale,
    languages: languagesForLocale(locale),
    acceptLanguage: acceptLanguageHeader(locale),
    countryCode: cc || null,
    country: geo?.country || null,
    ip: geo?.ip || null,
    isProxy: geo?.isProxy ?? null,
    isHosting: geo?.isHosting ?? null,
    isp: geo?.isp || null,
    source: geo?.source || 'egress',
  };
}

/**
 * Resolve timezone + locale para a sessão.
 *
 * @param {object} opts
 * @param {object|null} opts.proxy — proxy HTTP (host/port)
 * @param {object|null} opts.egressGeo — geo já medido (Tuxler skip / ip-api)
 * @param {string} opts.fallbackTimezone
 * @param {string} opts.fallbackLocale
 * @param {boolean} opts.enabled — STEALTH_GEO_TZ
 * @param {object} [opts.logger]
 */
async function resolveSessionLocale({
  proxy = null,
  egressGeo = null,
  fallbackTimezone = 'UTC',
  fallbackLocale = 'en-US',
  enabled = true,
  logger = null,
} = {}) {
  const fallback = buildLocaleFromGeo(
    { source: 'fallback' },
    fallbackTimezone,
    fallbackLocale
  );

  if (egressGeo?.ip || egressGeo?.countryCode) {
    const resolved = buildLocaleFromGeo(egressGeo, fallbackTimezone, fallbackLocale);
    if (logger) {
      logger.info(
        `Geo TZ: ${resolved.timezoneId} | locale=${resolved.locale}` +
          (resolved.countryCode ? ` | cc=${resolved.countryCode}` : '') +
          (resolved.ip ? ` | ip=${resolved.ip}` : '') +
          ` | via=${resolved.source || 'tuxler-egress'}`
      );
      if (resolved.isProxy || resolved.isHosting) {
        logger.warn(
          `IP marcado como ${[
            resolved.isProxy ? 'proxy/VPN/anon' : null,
            resolved.isHosting ? 'hosting/datacenter' : null,
          ]
            .filter(Boolean)
            .join(' + ')}` +
            (resolved.isp ? ` (${resolved.isp})` : '')
        );
      }
    }
    return resolved;
  }

  if (!enabled) {
    // Mesmo com STEALTH_GEO_TZ=false, consulta reputação do IP do proxy (aviso / skip).
    if (proxy?.host) {
      try {
        const geo = await lookupGeoViaProxy(proxy);
        if (logger && (geo.isProxy || geo.isHosting)) {
          logger.warn(
            `IP marcado como ${[
              geo.isProxy ? 'proxy/VPN/anon' : null,
              geo.isHosting ? 'hosting/datacenter' : null,
            ]
              .filter(Boolean)
              .join(' + ')}` +
              (geo.isp ? ` (${geo.isp})` : '') +
              ' — sites de ads costumam responder "anonymous proxy detected". ' +
              'Stealth de browser NÃO resolve isso: use proxy residencial/mobile. Ver docs/09-proxies-webshare.md'
          );
        }
        return {
          ...fallback,
          countryCode: geo.countryCode,
          ip: geo.ip,
          isProxy: geo.isProxy,
          isHosting: geo.isHosting,
          isp: geo.isp,
          source: 'reputation-only',
        };
      } catch {
        return fallback;
      }
    }
    return fallback;
  }

  try {
    const target = proxy?.host || null;
    const geo = proxy ? await lookupGeoViaProxy(proxy) : await lookupGeo(target);

    const timezoneId = geo.timezoneId || fallbackTimezone;
    let locale = geo.locale || fallbackLocale;

    if (!geo.locale && geo.countryCode && COUNTRY_HINTS[geo.countryCode]) {
      locale = COUNTRY_HINTS[geo.countryCode].locale;
    }

    const resolved = buildLocaleFromGeo(
      { ...geo, timezoneId, locale },
      fallbackTimezone,
      fallbackLocale
    );

    if (logger) {
      logger.info(
        `Geo TZ: ${resolved.timezoneId} | locale=${resolved.locale}` +
          (resolved.countryCode ? ` | cc=${resolved.countryCode}` : '') +
          (resolved.ip ? ` | ip=${resolved.ip}` : '') +
          (proxy ? ` | via=proxy` : ' | via=egress')
      );

      if (resolved.isProxy || resolved.isHosting) {
        logger.warn(
          `IP marcado como ${[
            resolved.isProxy ? 'proxy/VPN/anon' : null,
            resolved.isHosting ? 'hosting/datacenter' : null,
          ]
            .filter(Boolean)
            .join(' + ')}` +
            (resolved.isp ? ` (${resolved.isp})` : '') +
            ' — sites de ads costumam responder "anonymous proxy detected". ' +
            'Stealth de browser NÃO resolve isso: use proxy residencial/mobile ou PROXY_ENABLED=false na sua rede doméstica. Ver docs/09-proxies-webshare.md'
        );
      }
    }

    return resolved;
  } catch (err) {
    if (logger) {
      logger.warn(`Geo TZ indisponível (${err.message}) — usando fallback ${fallbackTimezone}`);
    }
    return fallback;
  }
}

/**
 * true se o IP está em reputação de proxy/hosting (risco alto de "anonymous proxy detected").
 */
function isFlaggedAnonymousIp(geo) {
  return Boolean(geo && (geo.isProxy || geo.isHosting));
}

function clearGeoCache() {
  cache.clear();
}

module.exports = {
  COUNTRY_HINTS,
  languagesForLocale,
  acceptLanguageHeader,
  buildLocaleFromGeo,
  lookupGeo,
  lookupGeoViaSocks,
  lookupTuxlerEgress,
  lookupGeoViaProxy,
  resolveSessionLocale,
  isFlaggedAnonymousIp,
  clearGeoCache,
};
