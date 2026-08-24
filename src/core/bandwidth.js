'use strict';

/**
 * Economiza banda do proxy bloqueando recursos pesados que não geram impressão/CTR.
 * Mantém document, script, xhr, fetch, ping e (no modo light) image (pixels de ad).
 */

const MODES = new Set(['off', 'light', 'aggressive']);

function normalizeMode(raw) {
  const m = String(raw ?? 'light')
    .trim()
    .toLowerCase();
  if (['off', 'false', '0'].includes(m)) return 'off';
  if (['aggressive', 'max', 'high'].includes(m)) return 'aggressive';
  return 'light';
}

function blockTypesForMode(mode) {
  if (mode === 'aggressive') {
    // Máxima economia de banda (pode reduzir CTA/pixels — tradeoff consciente).
    return new Set([
      'image',
      'media',
      'font',
      'stylesheet',
      'websocket',
      'manifest',
      'texttrack',
      'other',
    ]);
  }
  // light: corta vídeo/fonte/ws; mantém imagem (pixels CPM) + CSS (layout/CTA)
  return new Set(['media', 'font', 'websocket', 'manifest', 'texttrack']);
}

const HEAVY_URL_RE =
  /\.(mp4|webm|m3u8|mp3|wav|avi|mov|mkv|woff2?|ttf|otf|eot)(\?|$)/i;

const HEAVY_HOST_RE =
  /googlevideo|ytimg\.com|youtube\.com|youtu\.be|vimeocdn|fbcdn\.net|tiktokcdn|doubleclick\.net\/.*video/i;

/**
 * @returns {{ aborted: number, continued: number }}
 */
async function applyBandwidthSaver(page, { mode = 'light', logger = null } = {}) {
  const resolved = normalizeMode(mode);
  if (resolved === 'off') {
    return { aborted: 0, continued: 0, mode: 'off' };
  }

  if (page.__botBandwidthSaver) {
    return page.__botBandwidthSaver;
  }

  const blockTypes = blockTypesForMode(resolved);
  const stats = { aborted: 0, continued: 0, mode: resolved };
  page.__botBandwidthSaver = stats;

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    try {
      const type = req.resourceType();
      const url = req.url();

      if (blockTypes.has(type) || HEAVY_URL_RE.test(url) || HEAVY_HOST_RE.test(url)) {
        stats.aborted += 1;
        return req.abort().catch(() => {});
      }

      stats.continued += 1;
      return req.continue().catch(() => {});
    } catch {
      try {
        req.continue().catch(() => {});
      } catch {
        // ignore
      }
    }
  });

  if (logger) {
    logger.debug(`Bandwidth saver=${resolved} (bloqueia ${[...blockTypes].join(',')})`);
  }

  return stats;
}

/** Hosts de oferta “pesada” — navegar links internos gasta MB sem impressão extra no smartlink. */
function isHeavyOfferHost(hostname) {
  return /aliexpress|alibaba|amazon\.|amzn\.|ebay\.|shopee|lazada|temu\.|wish\.|walmart|rakuten|mercadolivre|mercadolibre/i.test(
    String(hostname || '')
  );
}

module.exports = {
  applyBandwidthSaver,
  isHeavyOfferHost,
  normalizeMode,
  MODES,
};
