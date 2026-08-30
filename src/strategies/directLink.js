'use strict';

const { pick, randomInt } = require('../utils/random');
const { sleep } = require('../utils/sleep');
const { isTransientProxyError } = require('../utils/netErrors');
const { isHeavyOfferHost } = require('../core/bandwidth');
const {
  humanBrowsePause,
  humanEngage,
  followClientRedirects,
  navigateLikeHuman,
  pickOrganicReferrer,
  openAsOrganicVisit,
} = require('../core/stealth');

async function gotoWithRetry(page, url, logger, { attempts = 3 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (err) {
      lastErr = err;
      if (!isTransientProxyError(err) || i === attempts) throw err;
      const brief = String(err.message || err).split('\n')[0];
      logger.warn(`Nav falhou (${brief}) — retry ${i}/${attempts - 1}`);
      await sleep(900 * i + randomInt(200, 900));
    }
  }
  throw lastErr;
}

/**
 * Direct link — visita TARGET_URLS com engajamento de visitante comum
 * (scroll, hover, cliques reais) para sinais de CTR/CPM.
 */

async function waitSettled(page, config) {
  // Com bandwidth saver, networkIdle demora menos; timeout curto evita gastar idle no proxy.
  const timeout = config?.bandwidthSaver === 'aggressive' ? 2_500 : 5_000;
  try {
    await page.waitForNetworkIdle({ idleTime: 500, timeout });
  } catch {
    // páginas com polling eterno
  }
}

async function readPageMeta(page) {
  let title = '';
  let bodyLen = 0;
  try {
    title = await page.title();
    bodyLen = await page.evaluate(() =>
      document.body && document.body.innerText
        ? document.body.innerText.trim().length
        : 0
    );
  } catch {
    // ignore
  }
  return { title, bodyLen, finalUrl: page.url() };
}

async function collectInternalLinks(page, hostname) {
  return page.evaluate((host) => {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll('a[href]')) {
      let u;
      try {
        u = new URL(a.getAttribute('href'), location.href);
      } catch {
        continue;
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      if (u.hostname !== host) continue;
      const clean = `${u.origin}${u.pathname}${u.search}`;
      if (seen.has(clean)) continue;
      if (u.pathname === location.pathname && u.search === location.search) continue;
      seen.add(clean);
      out.push(clean);
    }
    return out;
  }, hostname);
}

function resolveEngageBudget(config) {
  if (config.engageEnabled === false) return 0;
  const cap = Math.max(0, config.maxClicksPerPage ?? 3);
  if (cap === 0) return 0;
  const min = Math.max(0, config.engageClicksMin ?? 1);
  const max = Math.max(min, config.engageClicksMax ?? Math.min(3, cap));
  return Math.min(cap, randomInt(min, max));
}

function isDeadEndHost(url) {
  try {
    const h = new URL(url).hostname;
    return /play\.google\.com|apps\.apple\.com|(^|\.)google\.com$|(^|\.)googleapis\.com$|accounts\.google/i.test(
      h
    );
  } catch {
    return false;
  }
}

async function browsePage(page, url, logger, label, config, opts = {}) {
  logger.info(`${label}: ${url}`);

  let navVia = 'goto';
  let resp = null;
  if (opts.preferClick) {
    const nav = await navigateLikeHuman(page, url, logger);
    navVia = nav.via;
  } else if (opts.organic) {
    const organic = await openAsOrganicVisit(page, url, logger, {
      referrerUrl: opts.referrerUrl,
      warmup: Boolean(opts.warmup),
    });
    navVia = organic.via;
  } else {
    resp = await gotoWithRetry(page, url, logger);
  }

  const status = resp ? resp.status() : null;
  const redirectHops = await followClientRedirects(page, logger);
  await waitSettled(page, config);

  // Leitura parcial → engajamento (cliques) → leitura final.
  const dwellFirst = await humanBrowsePause(page, randomInt(5, 9));
  const onDeadEnd = isDeadEndHost(page.url());
  const budget = onDeadEnd ? 0 : resolveEngageBudget(config);
  let engage = { clicks: [], clickCount: 0 };
  if (onDeadEnd) {
    logger.info('Host sem CTR (Play Store/Google) — pulando cliques');
  } else if (budget > 0) {
    logger.info(`Engajando página (até ${budget} click(s) CTR verificados)...`);
    engage = await humanEngage(page, {
      maxClicks: budget,
      clickSelector: config.clickSelector,
      logger,
    });
  }
  const dwellLast = await humanBrowsePause(page, randomInt(3, 6));
  const dwellSec = dwellFirst + dwellLast;

  logger.info(
    `Lendo página (~${dwellSec}s, via=${navVia}, clicksVerificados=${engage.verifiedCount ?? engage.clickCount}/${engage.clickCount})...`
  );

  const meta = await readPageMeta(page);
  logger.info(
    `Resposta: status=${status ?? 'n/a'} | title="${meta.title}" | final=${meta.finalUrl} | texto≈${meta.bodyLen} chars | clicksOk=${engage.verifiedCount ?? engage.clickCount}`
  );
  if (!meta.title && meta.bodyLen < 40) {
    logger.warn('Página quase vazia (title vazio + pouco texto).');
  }
  return {
    status,
    navVia,
    redirectHops,
    clicks: engage.clicks,
    clickCount: engage.clickCount,
    ...meta,
  };
}

async function run(page, { config, logger }) {
  if (!config.targetUrls.length) {
    throw new Error('STRATEGY=directLink exige TARGET_URLS no .env');
  }

  const entryUrl = pick(config.targetUrls);
  const entryHost = new URL(entryUrl).hostname;
  const visited = new Set();
  const path = [];
  const allClicks = [];
  const referrerUrl = pickOrganicReferrer(page.__botGeo?.countryCode, config.referrers);

  const first = await browsePage(page, entryUrl, logger, 'Entrada', config, {
    preferClick: false,
    organic: true,
    warmup: Boolean(config.includeReferrer),
    referrerUrl,
  });
  visited.add(first.finalUrl.split('#')[0]);
  path.push(first.finalUrl);
  allClicks.push(...(first.clicks || []));

  const pagesMin = Math.max(0, config.browsePagesMin ?? 0);
  const pagesMax = Math.max(pagesMin, config.browsePagesMax ?? 0);
  let extraPages = pagesMax > 0 ? randomInt(pagesMin, pagesMax) : 0;

  // Após engajamento, host final pode ter mudado (smartlink → offer).
  let browseHost = entryHost;
  try {
    browseHost = new URL(first.finalUrl).hostname;
  } catch {
    // keep entryHost
  }

  // Loja pesada (AliExpress etc.) consome MB sem nova impressão no smartlink.
  if (extraPages > 0 && isHeavyOfferHost(browseHost)) {
    logger.info(
      `Host oferta pesada (${browseHost}) — pulando navegação interna (economiza banda)`
    );
    extraPages = 0;
  }

  let links = extraPages > 0 ? await collectInternalLinks(page, browseHost) : [];
  if (extraPages > 0) logger.info(`Links internos encontrados: ${links.length}`);
  else if (pagesMax === 0) logger.info('BROWSE_PAGES=0 — só a entrada (economiza banda)');

  let navigated = 0;
  for (let i = 0; i < extraPages; i += 1) {
    const candidates = links.filter((href) => !visited.has(href));
    if (!candidates.length) {
      logger.info('Sem mais links internos novos — encerrando navegação.');
      break;
    }

    const next = pick(candidates);

    try {
      const step = await browsePage(page, next, logger, `Navegação ${i + 1}/${extraPages}`, config, {
        preferClick: true,
      });
      visited.add(step.finalUrl.split('#')[0]);
      path.push(step.finalUrl);
      allClicks.push(...(step.clicks || []));
      navigated += 1;
      try {
        browseHost = new URL(step.finalUrl).hostname;
      } catch {
        // keep
      }
      const more = await collectInternalLinks(page, browseHost);
      links = [...new Set([...links, ...more])];
    } catch (err) {
      logger.warn(`Falha ao abrir ${next}: ${err.message}`);
    }
  }

  return {
    ok: true,
    meta: {
      entryUrl,
      path,
      pagesVisited: path.length,
      internalNavigations: navigated,
      status: first.status,
      title: first.title,
      clickCount: allClicks.length,
      verifiedClicks: allClicks.filter((c) => c.verified).length,
      clicks: allClicks.slice(0, 20),
    },
  };
}

module.exports = {
  name: 'directLink',
  requiresBrowser: true,
  run,
};
