'use strict';

const { pick, randomInt } = require('../utils/random');
const { sleep, sleepInterruptible, isAbortError } = require('../utils/sleep');
const { isTransientProxyError } = require('../utils/netErrors');
const { isHeavyOfferHost } = require('../core/bandwidth');
const {
  isIntermediateHost,
  classifyVisitQuality,
  pickEntryUrl,
  hostOf,
} = require('../core/visitQuality');
const {
  humanBrowsePause,
  humanEngage,
  legacyCenterClicks,
  followClientRedirects,
  navigateLikeHuman,
  pickOrganicReferrer,
  openAsOrganicVisit,
} = require('../core/stealth');

async function gotoWithRetry(page, url, logger, { attempts = 3, shouldStop } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    if (shouldStop?.()) {
      const err = new Error('Worker encerrando');
      err.name = 'AbortError';
      throw err;
    }
    try {
      return await page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (err) {
      lastErr = err;
      if (!isTransientProxyError(err) || i === attempts) throw err;
      const brief = String(err.message || err).split('\n')[0];
      logger.warn(`Nav falhou (${brief}) — retry ${i}/${attempts - 1}`);
      await sleepInterruptible(900 * i + randomInt(200, 900), { shouldStop });
    }
  }
  throw lastErr;
}

async function waitSettled(page, config) {
  const fast = (config?.dwellMaxSec ?? 9) <= 4;
  const timeout = config?.bandwidthSaver === 'aggressive' ? 2_000 : fast ? 2_500 : 5_000;
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

function resolveClickBudget(config) {
  const mode = resolveClickMode(config);
  const cap = Math.max(0, config.maxClicksPerPage ?? 1);
  if (cap === 0) return 0;

  if (mode === 'legacy' || mode === 'hybrid') {
    const min = Math.max(1, config.engageClicksMin ?? 1);
    const max = Math.max(min, config.engageClicksMax ?? Math.min(3, cap));
    return Math.min(cap, randomInt(min, max));
  }

  if (config.engageEnabled === false) return 0;
  const min = Math.max(0, config.engageClicksMin ?? 1);
  const max = Math.max(min, config.engageClicksMax ?? Math.min(3, cap));
  return Math.min(cap, randomInt(min, max));
}

async function runEngagement(page, config, logger, ctx, { onIntermediate, budget, fast }) {
  const mode = resolveClickMode(config);
  let engage = { clicks: [], clickCount: 0, verifiedCount: 0 };

  if (onIntermediate || budget <= 0) {
    return engage;
  }

  // v1 primeiro: clique no centro logo após a página carregar (cada worker, N vezes).
  if (mode === 'legacy' || mode === 'hybrid') {
    engage = await legacyCenterClicks(page, config, logger, {
      count: budget,
      followRedirects: true,
    });
    if (mode === 'legacy' || engage.clickCount > 0) {
      return engage;
    }
  }

  logger.info(`Engajando página (até ${budget} click(s) CTR verificados)...`);
  engage = await humanEngage(page, {
    maxClicks: budget,
    clickSelector: config.clickSelector,
    logger,
    fast,
    maxMs: config.engageMaxMs ?? 25_000,
    requireUrlChange: Boolean(config.engageRequireUrlChange),
    ...ctx,
  });

  return engage;
}

function resolveClickMode(config) {
  const raw = (config.clickMode || 'legacy').trim().toLowerCase();
  if (['legacy', 'engage', 'hybrid'].includes(raw)) return raw;
  return 'legacy';
}

async function browsePage(page, url, logger, label, config, opts = {}) {
  const ctx = {
    shouldStop: opts.shouldStop,
    signal: opts.signal,
  };
  const waitOpts = { shouldStop: ctx.shouldStop, signal: ctx.signal };

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
    resp = await gotoWithRetry(page, url, logger, { shouldStop: ctx.shouldStop });
  }

  const status = resp ? resp.status() : null;
  const redirectHops = await followClientRedirects(page, logger);

  const onIntermediate = isIntermediateHost(page.url());
  if (onIntermediate) {
    logger.info(`Redirect parou em host intermediário (${hostOf(page.url()) || '?'}) — sem cliques`);
  }
  const budget = onIntermediate ? 0 : resolveClickBudget(config);

  // v1: clique logo após goto + redirects iniciais (antes do dwell longo).
  await sleep(randomInt(200, 600));
  const engage = await runEngagement(page, config, logger, waitOpts, {
    onIntermediate,
    budget,
    fast: (config.dwellMaxSec ?? 9) <= 4,
  });

  await waitSettled(page, config);

  const dwellBudget = onIntermediate
    ? randomInt(1, 2)
    : randomInt(config.dwellMinSec ?? 2, config.dwellMaxSec ?? 3);
  const dwellFirst = await humanBrowsePause(page, dwellBudget, waitOpts);

  const tailBudget = onIntermediate
    ? 0
    : randomInt(config.dwellTailMinSec ?? 1, config.dwellTailMaxSec ?? 2);
  const dwellLast = await humanBrowsePause(page, tailBudget, waitOpts);
  const dwellSec = dwellFirst + dwellLast;

  logger.info(
    `Lendo página (~${dwellSec}s, via=${navVia}, cliques=${engage.clickCount})...`
  );

  const meta = await readPageMeta(page);
  const performedClicks = engage.clickCount ?? 0;
  const quality = classifyVisitQuality(meta.finalUrl, {
    bodyLen: meta.bodyLen,
    verifiedClicks: performedClicks,
    clickCount: performedClicks,
    clicks: engage.clicks,
  });

  logger.info(
    `Resposta: status=${status ?? 'n/a'} | qualidade=${quality} | title="${meta.title}" | final=${meta.finalUrl} | texto≈${meta.bodyLen} chars | cliques=${performedClicks}`
  );
  if (!meta.title && meta.bodyLen < 40) {
    logger.warn('Página quase vazia (title vazio + pouco texto).');
  }
  return {
    status,
    navVia,
    redirectHops,
    quality,
    clicks: engage.clicks,
    clickCount: engage.clickCount,
    verifiedClicks: performedClicks,
    ...meta,
  };
}

async function runSingleVisit(page, { config, logger, entryUrl, shouldStop, signal }) {
  const visitCtx = { shouldStop, signal };
  const visited = new Set();
  const path = [];
  const allClicks = [];
  const referrerUrl = pickOrganicReferrer(page.__botGeo?.countryCode, config.referrers);

  const first = await browsePage(page, entryUrl, logger, 'Entrada', config, {
    preferClick: false,
    organic: Boolean(config.includeReferrer),
    warmup: Boolean(config.includeReferrer),
    referrerUrl,
    ...visitCtx,
  });
  visited.add(first.finalUrl.split('#')[0]);
  path.push(first.finalUrl);
  allClicks.push(...(first.clicks || []));

  const pagesMin = Math.max(0, config.browsePagesMin ?? 0);
  const pagesMax = Math.max(pagesMin, config.browsePagesMax ?? 0);
  let extraPages = pagesMax > 0 ? randomInt(pagesMin, pagesMax) : 0;

  let browseHost = hostOf(entryUrl) || hostOf(first.finalUrl);
  try {
    browseHost = new URL(first.finalUrl).hostname;
  } catch {
    // keep
  }

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
        ...visitCtx,
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

  const performedClicks = allClicks.length;
  const finalUrl = path[path.length - 1] || first.finalUrl;
  const quality = classifyVisitQuality(finalUrl, {
    bodyLen: first.bodyLen,
    verifiedClicks: performedClicks,
    clickCount: performedClicks,
    clicks: allClicks,
  });

  return {
    ok: true,
    quality,
    meta: {
      entryUrl,
      path,
      pagesVisited: path.length,
      internalNavigations: navigated,
      status: first.status,
      title: first.title,
      finalUrl,
      finalHost: hostOf(finalUrl),
      quality,
      clickCount: performedClicks,
      verifiedClicks: performedClicks,
      clicks: allClicks.slice(0, 20),
    },
  };
}

async function run(page, { config, logger, shouldStop, signal }) {
  if (!config.targetUrls.length) {
    throw new Error(
      'STRATEGY=directLink exige links colados no painel (Start). URLs não vêm do .env.'
    );
  }

  const visitCtx = { shouldStop, signal };
  const maxAttempts = config.visitRetryOnDeadEnd ? 2 : 1;
  const tried = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (shouldStop?.()) {
      const err = new Error('Worker encerrando');
      err.name = 'AbortError';
      throw err;
    }

    const entryUrl = pickEntryUrl(config.targetUrls, tried);
    tried.push(entryUrl);

    const result = await runSingleVisit(page, { config, logger, entryUrl, ...visitCtx });

    if (result.quality !== 'intermediate' || attempt >= maxAttempts) {
      if (result.quality === 'intermediate' && attempt >= maxAttempts) {
        logger.warn(
          `qualidade=intermediate (${result.meta.finalHost || '?'}) — sem retry restante`
        );
      }
      return result;
    }

    logger.warn(
      `qualidade=intermediate (${result.meta.finalHost || '?'}) — retry ${attempt}/${maxAttempts - 1} com outro link`
    );
  }

  return runSingleVisit(page, {
    config,
    logger,
    entryUrl: pick(config.targetUrls),
    ...visitCtx,
  });
}

module.exports = {
  name: 'directLink',
  requiresBrowser: true,
  run,
  isIntermediateHost,
  classifyVisitQuality,
};
