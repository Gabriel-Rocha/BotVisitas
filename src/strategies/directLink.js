'use strict';

const { pick, randomInt } = require('../utils/random');
const { sleep } = require('../utils/sleep');
const { humanBrowsePause, navigateLikeHuman } = require('../core/stealth');

/**
 * Direct link — visita TARGET_URLS e navega pelo site (mesmo host).
 * Comportamento humanizado (ofuscação): scroll suave, mouse, dwell, clique em links.
 * Sem clique forçado em CTA.
 */

async function waitSettled(page) {
  try {
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 8_000 });
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
      // ignora âncoras na mesma página
      if (u.pathname === location.pathname && u.search === location.search) continue;
      seen.add(clean);
      out.push(clean);
    }
    return out;
  }, hostname);
}

async function browsePage(page, url, logger, label, { preferClick = false } = {}) {
  logger.info(`${label}: ${url}`);

  let navVia = 'goto';
  let resp = null;
  if (preferClick) {
    const nav = await navigateLikeHuman(page, url, logger);
    navVia = nav.via;
  } else {
    resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  const status = resp ? resp.status() : null;
  await waitSettled(page);

  const dwellSec = await humanBrowsePause(page, randomInt(5, 14));
  logger.info(`Lendo página (~${dwellSec}s, via=${navVia})...`);

  const meta = await readPageMeta(page);
  logger.info(
    `Resposta: status=${status ?? 'n/a'} | title="${meta.title}" | final=${meta.finalUrl} | texto≈${meta.bodyLen} chars`
  );
  if (!meta.title && meta.bodyLen < 40) {
    logger.warn('Página quase vazia (title vazio + pouco texto).');
  }
  return { status, navVia, ...meta };
}

async function run(page, { config, logger }) {
  if (!config.targetUrls.length) {
    throw new Error('STRATEGY=directLink exige TARGET_URLS no .env');
  }

  if (config.includeReferrer && config.referrers.length) {
    const ref = pick(config.referrers);
    logger.info(`Referrer: ${ref}`);
    await page.goto(ref, { waitUntil: 'domcontentloaded' });
    // Pausa curta no referrer (humano não pula instantâneo).
    await sleep(randomInt(1200, 3500));
  }

  const entryUrl = pick(config.targetUrls);

  const entryHost = new URL(entryUrl).hostname;
  const visited = new Set();
  const path = [];

  const first = await browsePage(page, entryUrl, logger, 'Entrada', { preferClick: false });
  visited.add(first.finalUrl.split('#')[0]);
  path.push(first.finalUrl);

  const pagesMin = Math.max(0, config.browsePagesMin ?? 1);
  const pagesMax = Math.max(pagesMin, config.browsePagesMax ?? 3);
  const extraPages = randomInt(pagesMin, pagesMax);

  let links = await collectInternalLinks(page, entryHost);
  logger.info(`Links internos encontrados: ${links.length}`);

  let navigated = 0;
  for (let i = 0; i < extraPages; i += 1) {
    const candidates = links.filter((href) => !visited.has(href));
    if (!candidates.length) {
      logger.info('Sem mais links internos novos — encerrando navegação.');
      break;
    }

    const next = pick(candidates);

    try {
      const step = await browsePage(page, next, logger, `Navegação ${i + 1}/${extraPages}`, {
        preferClick: true,
      });
      visited.add(step.finalUrl.split('#')[0]);
      path.push(step.finalUrl);
      navigated += 1;
      // atualiza pool de links a partir da página atual
      const more = await collectInternalLinks(page, entryHost);
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
    },
  };
}

module.exports = {
  name: 'directLink',
  requiresBrowser: true,
  run,
};
