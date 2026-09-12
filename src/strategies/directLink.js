'use strict';

const { pick, randomInt } = require('../utils/random');
const { sleep, sleepInterruptible, isAbortError } = require('../utils/sleep');
const { isTransientProxyError } = require('../utils/netErrors');
const { getTuxlerNavGate } = require('../core/navGate');
const { isTuxlerTunnelOk, probeTuxlerSocks } = require('../core/proxy');
const { isHeavyOfferHost } = require('../core/bandwidth');
const {
  isIntermediateHost,
  classifyVisitQuality,
  classifyClickTarget,
  summarizeClickTargets,
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
  pageUrl,
} = require('../core/stealth');

async function gotoWithRetry(page, url, logger, { attempts = 3, shouldStop, signal, config } = {}) {
  const useTuxlerGate = config?.tuxler?.enabled === true;
  const gate = useTuxlerGate ? getTuxlerNavGate(config?.tuxler?.navSlots || 1) : null;
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    if (shouldStop?.() || signal?.aborted) {
      const err = new Error('Worker encerrando');
      err.name = 'AbortError';
      throw err;
    }
    if (useTuxlerGate) {
      if (!isTuxlerTunnelOk()) {
        const err = new Error('Tuxler túnel saturado — adiando goto');
        err.code = 'TUXLER_SOCKS_OFFLINE';
        throw err;
      }
      const socks = await probeTuxlerSocks(config);
      if (!socks.open) {
        const err = new Error(`Tuxler SOCKS ${socks.host}:${socks.port} offline`);
        err.code = 'TUXLER_SOCKS_OFFLINE';
        throw err;
      }
    }
    try {
      const go = () => page.goto(url, { waitUntil: 'domcontentloaded' });
      return gate ? await gate.run(go, { signal, acquireTimeoutMs: 20_000 }) : await go();
    } catch (err) {
      lastErr = err;
      if (shouldStop?.() || signal?.aborted || isAbortError(err)) throw err;
      if (err.code === 'NAV_GATE_TIMEOUT' || !isTransientProxyError(err) || i === attempts) {
        throw err;
      }
      const brief = String(err.message || err).split('\n')[0];
      logger.warn(`Nav falhou (${brief}) — retry ${i}/${attempts - 1}`);
      const ssl = /ERR_SSL_PROTOCOL_ERROR/i.test(brief);
      const waitMs = ssl
        ? 2_400 * i + randomInt(400, 1_200)
        : 900 * i + randomInt(200, 900);
      await sleepInterruptible(waitMs, { shouldStop, signal });
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
  let interactives = 0;
  try {
    title = await page.title();
    const info = await page.evaluate(() => {
      const text =
        document.body && document.body.innerText
          ? document.body.innerText.trim().length
          : 0;
      const nodes = document.querySelectorAll(
        'a[href], button, [role="button"], iframe, input[type="submit"], [onclick], .btn, [data-cta], [data-ad]'
      );
      return { text, interactives: nodes.length };
    });
    bodyLen = info.text || 0;
    interactives = info.interactives || 0;
  } catch {
    // ignore
  }
  return { title, bodyLen, interactives, finalUrl: pageUrl(page) };
}

/**
 * Proxies lentos / SPA: espera UI rápido; se ficar 0/0, desiste cedo (não “trava” 12s).
 */
async function waitForPageReady(page, config, waitOpts = {}) {
  const hardMax = Math.min(5_500, Math.max(2_500, Number(config?.pageReadyMs) || 5_000));
  const earlyBailMs = Math.min(2_200, hardMax);
  const deadline = Date.now() + hardMax;
  const earlyAt = Date.now() + earlyBailMs;
  let last = await readPageMeta(page);
  while (Date.now() < deadline) {
    if (waitOpts.shouldStop?.() || waitOpts.signal?.aborted) break;
    if (last.bodyLen >= 60) return last;
    if (last.interactives >= 1 && (last.bodyLen >= 20 || last.title)) return last;
    if (last.interactives >= 3) return last;
    // Blank smartlink (dutiful-hate etc.): não queima o ciclo inteiro.
    if (Date.now() >= earlyAt && last.bodyLen < 15 && last.interactives < 1 && !last.title) {
      return last;
    }
    await sleepInterruptible(280, waitOpts);
    last = await readPageMeta(page);
  }
  return last;
}

async function collectPageLinks(page, hostname, { allowExternal = true } = {}) {
  return page.evaluate(
    (host, allowExt) => {
      const junkHref =
        /privacy|terms|cookie|gdpr|mailto:|tel:|javascript:|play\.google|apps\.apple|accounts\.google|facebook\.com|twitter\.com|instagram\.com|linkedin\.com|youtube\.com\/redirect/i;
      const junkText =
        /privacy|terms|cookie|sign in|log in|subscribe|share|report|back to home|learn more/i;
      const seen = new Set();
      const same = [];
      const external = [];

      for (const a of document.querySelectorAll('a[href]')) {
        let u;
        try {
          u = new URL(a.getAttribute('href'), location.href);
        } catch {
          continue;
        }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
        const clean = `${u.origin}${u.pathname}${u.search}`;
        if (seen.has(clean)) continue;
        if (u.pathname === location.pathname && u.search === location.search) continue;
        if (junkHref.test(clean)) continue;
        const text = (a.innerText || a.getAttribute('aria-label') || '').trim();
        if (text && junkText.test(text) && text.length < 40) continue;

        const r = a.getBoundingClientRect();
        const style = window.getComputedStyle(a);
        if (r.width < 8 || r.height < 8) continue;
        if (style.visibility === 'hidden' || style.display === 'none') continue;

        seen.add(clean);
        if (u.hostname === host) {
          same.push(clean);
        } else if (allowExt) {
          external.push(clean);
        }
      }
      // Internos primeiro; externos (ofertas) depois.
      return [...same, ...external];
    },
    hostname,
    allowExternal
  );
}

/** @deprecated alias */
async function collectInternalLinks(page, hostname) {
  return collectPageLinks(page, hostname, { allowExternal: false });
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
  let engage = { clicks: [], clickCount: 0, verifiedCount: 0, urlChanged: false };

  if (onIntermediate || budget <= 0) {
    return engage;
  }

  // legacy/hybrid: centro só se ainda estiver no modo antigo.
  if (mode === 'legacy' || mode === 'hybrid') {
    engage = await legacyCenterClicks(page, config, logger, {
      count: budget,
      followRedirects: true,
    });
    const verified = Number(engage.verifiedCount) || 0;
    if (mode === 'legacy') {
      return engage;
    }
    if (mode === 'hybrid' && verified > 0) {
      return engage;
    }
  }

  // Default (engage/links): CTA / ad / âncora de oferta — sem centro e sem “passear” em artigo.
  const remaining = Math.max(1, budget - (Number(engage.verifiedCount) || 0));
  logger.info(`Engajando CTA/ads (até ${remaining} click(s) verificados)...`);
  const engage2 = await humanEngage(page, {
    maxClicks: remaining,
    clickSelector: config.clickSelector,
    logger,
    fast,
    maxMs: config.engageMaxMs ?? 25_000,
    requireUrlChange: config.engageRequireUrlChange !== false,
    // Último recurso: centro só se nada verificou (interstitial full-bleed).
    allowCenterFallback: true,
    preferAnchors: false,
    preferOfferLinks: true,
    ...ctx,
  });

  const mergedClicks = [...(engage.clicks || []), ...(engage2.clicks || [])];
  return {
    clicks: mergedClicks,
    clickCount: mergedClicks.length,
    verifiedCount:
      (Number(engage.verifiedCount) || 0) + (Number(engage2.verifiedCount) || 0),
    urlChanged: Boolean(engage.urlChanged) || mergedClicks.some((c) => c.urlChanged),
  };
}

function resolveClickMode(config) {
  const raw = (config.clickMode || 'engage').trim().toLowerCase();
  if (raw === 'links' || raw === 'navigate') return 'engage';
  if (['legacy', 'engage', 'hybrid'].includes(raw)) return raw;
  return 'engage';
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
    resp = await gotoWithRetry(page, url, logger, {
      shouldStop: ctx.shouldStop,
      signal: ctx.signal,
      config,
    });
  }

  const status = resp ? resp.status() : null;
  const redirectHops = await followClientRedirects(page, logger, {
    config,
    shouldStop: ctx.shouldStop,
    signal: ctx.signal,
  });

  const onIntermediate = isIntermediateHost(pageUrl(page));
  if (onIntermediate) {
    logger.info(
      `Redirect parou em host intermediário (${hostOf(pageUrl(page)) || '?'}) — sem cliques`
    );
  }

  // Impressão primeiro: espera a página/ads carregarem antes do CTR.
  await waitSettled(page, config);
  let preMeta = await waitForPageReady(page, config, waitOpts);
  const challengeTitle = /^(un momento|captcha|just a moment|attention required)/i.test(
    String(preMeta.title || '').trim()
  );
  // Só trata como vazia se NÃO há CTA/iframe/links — landings de ad às vezes têm pouco texto.
  const looksEmpty =
    !onIntermediate &&
    preMeta.interactives < 1 &&
    (challengeTitle || preMeta.bodyLen < 40) &&
    (!preMeta.title || challengeTitle);
  if (looksEmpty) {
    logger.warn(
      `Página sem UI (title="${preMeta.title}" texto≈${preMeta.bodyLen} interativos=${preMeta.interactives}) — sem cliques`
    );
  } else if (preMeta.bodyLen < 80) {
    logger.info(
      `UI pronta com pouco texto (texto≈${preMeta.bodyLen} interativos=${preMeta.interactives}) — engajando mesmo assim`
    );
  }

  const budget = onIntermediate || looksEmpty ? 0 : resolveClickBudget(config);

  const dwellBudget =
    onIntermediate || looksEmpty
      ? randomInt(1, 2)
      : randomInt(config.dwellMinSec ?? 5, config.dwellMaxSec ?? 9);
  const dwellFirst = await humanBrowsePause(page, dwellBudget, waitOpts);

  // Origem do clique — usada para separar navegação interna de destino de ad.
  const originUrl = pageUrl(page);

  const fastEngage = (config.dwellMaxSec ?? 9) <= 4;
  const engage = await runEngagement(page, config, logger, waitOpts, {
    onIntermediate: onIntermediate || looksEmpty,
    budget,
    fast: fastEngage,
  });

  const tailBudget =
    onIntermediate || looksEmpty
      ? 0
      : randomInt(config.dwellTailMinSec ?? 3, config.dwellTailMaxSec ?? 6);
  const dwellLast = await humanBrowsePause(page, tailBudget, waitOpts);
  const dwellSec = dwellFirst + dwellLast;

  const clicks = (engage.clicks || []).map((click) => ({
    ...click,
    target: click.target || classifyClickTarget(click, originUrl),
  }));
  const clickTargets = summarizeClickTargets(clicks, originUrl);

  const verifiedClicks =
    Number(engage.verifiedCount) || clicks.filter((c) => c.verified).length;
  const performedClicks = Number(engage.clickCount) || 0;

  logger.info(
    `Lendo página (~${dwellSec}s, via=${navVia}, cliques=${performedClicks}, verificados=${verifiedClicks}` +
      ` [anúncio=${clickTargets.ad} site=${clickTargets.internal} externo=${clickTargets.external}])...`
  );
  if (verifiedClicks > 0 && clickTargets.ad === 0) {
    logger.warn(
      'Nenhum clique caiu em unidade de anúncio — navegação interna/externa não gera CTR de ad'
    );
  }

  const meta = await readPageMeta(page);
  const quality = classifyVisitQuality(meta.finalUrl, {
    title: meta.title,
    bodyLen: meta.bodyLen,
    verifiedClicks,
    clickCount: performedClicks,
    clicks,
  });

  logger.info(
    `Resposta: status=${status ?? 'n/a'} | qualidade=${quality} | title="${meta.title}" | final=${meta.finalUrl} | texto≈${meta.bodyLen} chars | ui=${meta.interactives} | cliques=${performedClicks} | verificados=${verifiedClicks}`
  );
  if (!meta.title && meta.bodyLen < 40 && meta.interactives < 1) {
    logger.warn('Página quase vazia (title vazio + pouco texto + sem UI).');
  }
  return {
    status,
    navVia,
    redirectHops,
    quality,
    clicks,
    clickCount: performedClicks,
    verifiedClicks,
    clickTargets,
    emptyUi: Boolean(looksEmpty || (meta.interactives < 1 && meta.bodyLen < 40)),
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
    const capped = Math.min(extraPages, 1);
    logger.info(
      `Host oferta pesada (${browseHost}) — limitando navegação a ${capped} link(s)`
    );
    extraPages = capped;
  }

  let links = extraPages > 0 ? await collectPageLinks(page, browseHost, { allowExternal: true }) : [];
  if (extraPages > 0) logger.info(`Links na página encontrados: ${links.length}`);
  else if (pagesMax === 0) logger.info('BROWSE_PAGES=0 — só a entrada (economiza banda)');

  let navigated = 0;
  for (let i = 0; i < extraPages; i += 1) {
    const candidates = links.filter((href) => !visited.has(href.split('#')[0]));
    if (!candidates.length) {
      logger.info('Sem mais links novos na página — encerrando navegação.');
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
      const more = await collectPageLinks(page, browseHost, { allowExternal: true });
      links = [...new Set([...links, ...more])];
    } catch (err) {
      logger.warn(`Falha ao abrir ${next}: ${err.message}`);
    }
  }

  const performedClicks = allClicks.length;
  const verifiedClicks = allClicks.filter((c) => c.verified).length;
  // Cada clique já carrega `target`; o originUrl não é mais necessário aqui.
  const clickTargets = summarizeClickTargets(allClicks);
  const finalUrl = path[path.length - 1] || first.finalUrl;
  const quality = classifyVisitQuality(finalUrl, {
    title: first.title,
    bodyLen: first.bodyLen,
    verifiedClicks,
    clickCount: performedClicks,
    clicks: allClicks,
  });

  return {
    ok: quality !== 'intermediate',
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
      verifiedClicks,
      clickTargets,
      clicks: allClicks.slice(0, 20),
      emptyUi: Boolean(first.emptyUi),
      bodyLen: first.bodyLen,
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
