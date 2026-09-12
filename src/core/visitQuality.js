'use strict';

/**
 * Classifica qualidade da visita após redirects (oferta vs intermediário).
 */

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Hosts/URLs sem valor de CTR/CPM — buscadores, lojas, challenge, erro Chrome. */
function isDeadEndUrl(url) {
  const raw = String(url || '');
  if (!raw) return false;
  if (/^chrome-error:/i.test(raw) || /chromewebdata/i.test(raw)) return true;
  if (/\/_{3,}tmd_{3,}\/punish/i.test(raw)) return true;
  return false;
}

function isIntermediateHost(url) {
  if (isDeadEndUrl(url)) return true;
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (/play\.google\.com|apps\.apple\.com|accounts\.google/i.test(h)) return true;
    if (/(^|\.)google\.com$|(^|\.)googleapis\.com$/i.test(h)) return true;
    if (/(^|\.)duckduckgo\.com$/i.test(h)) return true;
    if (/(^|\.)bing\.com$/i.test(h)) return true;
    if (/(^|\.)yahoo\.com$/i.test(h)) return true;
    if (/effectivecpmnetwork\.com$/i.test(h) && u.pathname.startsWith('/api/')) return true;
    return false;
  } catch {
    return false;
  }
}

function classifyVisitQuality(finalUrl, pageResult = {}) {
  if (isIntermediateHost(finalUrl)) {
    return 'intermediate';
  }

  const bodyLen = Number(pageResult.bodyLen) || 0;
  const title = String(pageResult.title || '').trim();
  const verified =
    Number(pageResult.verifiedClicks ?? pageResult.verifiedCount) ||
    (Array.isArray(pageResult.clicks)
      ? pageResult.clicks.filter((c) => c.verified === true).length
      : 0);
  const clickCount = Number(pageResult.clickCount) || 0;

  // Clique verificado = oferta (mesmo com pouco texto no main frame).
  if (verified > 0) return 'offer';

  // Página vazia / challenge — não conta como impressão válida no CPM.
  if (bodyLen < 80 && (!title || /^(un momento|captcha|just a moment)/i.test(title))) {
    return 'intermediate';
  }
  if (bodyLen < 40 && verified === 0 && clickCount === 0) {
    return 'intermediate';
  }

  return 'offer';
}

/** Hosts de rede de ads — reporte apenas; o bot não mira unidade de anúncio. */
const AD_NETWORK_HOST_RE =
  /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adnxs\.com|adsrvr\.org|adsterra\.com|propellerads\.com|monetag\.com|taboola\.com|outbrain\.com|effectivecpmnetwork\.com)$/i;
const AD_TRACKER_RE =
  /click_id|clickid|\/click\b|[?&]cpc=|ad_id=|aff_|haff_|smartlink|effectivecpm|adserver|\brtb\b/i;

function baseDomain(host) {
  const parts = String(host || '')
    .toLowerCase()
    .split('.')
    .filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

function hostFrom(raw, base) {
  if (!raw) return '';
  try {
    return new URL(raw, base || undefined).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Onde o clique caiu: unidade de anúncio, link interno do site, destino externo
 * ou indefinido. Evita que navegação interna da landing apareça como CTR de ad.
 */
function classifyClickTarget(click = {}, originUrl = '') {
  const href = String(click.href || '');
  const finalUrl = String(click.finalUrl || '');

  if (click.via === 'iframe') return 'ad';

  for (const candidate of [href, finalUrl]) {
    const host = hostFrom(candidate, originUrl);
    if (host && AD_NETWORK_HOST_RE.test(host)) return 'ad';
  }
  if (AD_TRACKER_RE.test(`${href} ${finalUrl}`)) return 'ad';

  const destHost = hostFrom(finalUrl, originUrl) || hostFrom(href, originUrl);
  if (!destHost) return 'unknown';

  const originBase = baseDomain(hostOf(originUrl));
  const destBase = baseDomain(destHost);
  if (!originBase || !destBase) return 'unknown';
  return destBase === originBase ? 'internal' : 'external';
}

/** Conta só cliques verificados, agrupados por destino. */
function summarizeClickTargets(clicks = [], originUrl = '') {
  const out = { ad: 0, internal: 0, external: 0, unknown: 0 };
  for (const click of clicks) {
    if (!click || click.verified !== true) continue;
    const target = click.target || classifyClickTarget(click, originUrl);
    out[target] = (out[target] || 0) + 1;
  }
  return out;
}

function pickEntryUrl(targetUrls, exclude = []) {
  const { pick } = require('../utils/random');
  const blocked = new Set(exclude);
  const pool = targetUrls.filter((u) => u && !blocked.has(u));
  if (pool.length) return pick(pool);
  return pick(targetUrls);
}

module.exports = {
  hostOf,
  isDeadEndUrl,
  isIntermediateHost,
  classifyVisitQuality,
  classifyClickTarget,
  summarizeClickTargets,
  pickEntryUrl,
};
