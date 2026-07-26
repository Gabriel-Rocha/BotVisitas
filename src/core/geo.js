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

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const LOOKUP_TIMEOUT_MS = 5_000;

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

/**
 * @param {string} [ipOrHost] — vazio = IP do egress atual (sem proxy na chamada)
 */
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
  if (!raw || raw.status !== 'success') {
    throw new Error(raw?.message || 'geo lookup falhou');
  }

  const countryCode = String(raw.countryCode || '').toUpperCase();
  const hint = COUNTRY_HINTS[countryCode] || null;
  const data = {
    ip: raw.query || ipOrHost || null,
    country: raw.country || null,
    countryCode: countryCode || null,
    timezoneId: raw.timezone || hint?.timezoneId || null,
    locale: hint?.locale || null,
    isp: raw.isp || null,
    org: raw.org || null,
    as: raw.as || null,
    // true = IP em blocklist de proxy/VPN/anon (causa clássica de "anonymous proxy detected")
    isProxy: Boolean(raw.proxy),
    isHosting: Boolean(raw.hosting),
    source: 'ip-api',
  };

  cache.set(key, { at: Date.now(), data });
  return data;
}

/**
 * Resolve timezone + locale para a sessão.
 *
 * @param {object} opts
 * @param {object|null} opts.proxy — proxy ativo (usa proxy.host)
 * @param {string} opts.fallbackTimezone
 * @param {string} opts.fallbackLocale
 * @param {boolean} opts.enabled — STEALTH_GEO_TZ
 * @param {object} [opts.logger]
 */
async function resolveSessionLocale({
  proxy = null,
  fallbackTimezone = 'America/Sao_Paulo',
  fallbackLocale = 'pt-BR',
  enabled = true,
  logger = null,
} = {}) {
  const fallback = {
    timezoneId: fallbackTimezone,
    locale: fallbackLocale,
    languages: languagesForLocale(fallbackLocale),
    acceptLanguage: acceptLanguageHeader(fallbackLocale),
    countryCode: null,
    ip: proxy?.host || null,
    isProxy: null,
    isHosting: null,
    isp: null,
    source: 'fallback',
  };

  if (!enabled) {
    // Mesmo com STEALTH_GEO_TZ=false, consulta reputação do IP do proxy (aviso / skip).
    if (proxy?.host) {
      try {
        const geo = await lookupGeo(proxy.host);
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
    const geo = await lookupGeo(target);

    const timezoneId = geo.timezoneId || fallbackTimezone;
    let locale = geo.locale || fallbackLocale;

    // Sem hint de país: mantém fallback de locale (não inventar en-US p/ BR unknown).
    if (!geo.locale && geo.countryCode && COUNTRY_HINTS[geo.countryCode]) {
      locale = COUNTRY_HINTS[geo.countryCode].locale;
    }

    const resolved = {
      timezoneId,
      locale,
      languages: languagesForLocale(locale),
      acceptLanguage: acceptLanguageHeader(locale),
      countryCode: geo.countryCode,
      ip: geo.ip,
      isProxy: geo.isProxy,
      isHosting: geo.isHosting,
      isp: geo.isp,
      source: geo.source,
    };

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
  lookupGeo,
  resolveSessionLocale,
  isFlaggedAnonymousIp,
  clearGeoCache,
};
