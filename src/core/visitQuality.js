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

/** Hosts sem valor de CTR/CPM — buscadores, lojas, API smartlink sem landing. */
function isIntermediateHost(url) {
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
  const performed =
    Number(pageResult.clickCount) ||
    (Array.isArray(pageResult.clicks) ? pageResult.clicks.length : 0);
  const verified =
    Number(pageResult.verifiedClicks ?? pageResult.verifiedCount) ||
    (Array.isArray(pageResult.clicks)
      ? pageResult.clicks.filter((c) => c.verified !== false).length
      : 0);

  if (bodyLen < 40 && performed === 0 && verified === 0) {
    return 'intermediate';
  }

  return 'offer';
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
  isIntermediateHost,
  classifyVisitQuality,
  pickEntryUrl,
};
