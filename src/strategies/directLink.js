'use strict';

const { pick, randomInt } = require('../utils/random');
const { sleep } = require('../utils/sleep');

/**
 * Direct link — visita TARGET_URLS e navega pelo site (mesmo host).
 * Sem clique forçado em CTA. Use só contra infra que VOCÊ controla.
 */

function assertHostAllowed(rawUrl, allowHosts) {
  if (!allowHosts || !allowHosts.length) return;
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`URL inválida em TARGET_URLS: "${rawUrl}"`);
  }
  if (u.protocol === 'file:') return;
  if (!allowHosts.includes(u.hostname)) {
    throw new Error(
      `Alvo "${u.hostname}" fora de TARGET_ALLOW_HOSTS [${allowHosts.join(', ')}]. ` +
        'directLink só deve apontar para infra que você controla.'
    );
  }
}

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

async function scrollAround(page) {
  const steps = randomInt(2, 5);
  for (let i = 0; i < steps; i += 1) {
    const dy = randomInt(180, 720);
    await page.evaluate((delta) => {
      window.scrollBy({ top: delta, left: 0, behavior: 'instant' });
    }, dy);
    await sleep(randomInt(350, 1100));
  }
  // às vezes sobe um pouco (leitura)
  if (Math.random() < 0.35) {
    await page.evaluate(() => {
      window.scrollBy({ top: -Math.round(window.innerHeight * 0.3), left: 0, behavior: 'instant' });
    });
    await sleep(randomInt(300, 800));
  }
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

async function browsePage(page, url, logger, label) {
  logger.info(`${label}: ${url}`);
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
  const status = resp ? resp.status() : null;
  await waitSettled(page);

  const dwellSec = randomInt(4, 12);
  logger.info(`Lendo página (~${dwellSec}s)...`);
  await sleep(Math.min(dwellSec, 3) * 1000);
  await scrollAround(page);
  await sleep(Math.max(0, dwellSec - 3) * 1000);

  const meta = await readPageMeta(page);
  logger.info(
    `Resposta: status=${status} | title="${meta.title}" | final=${meta.finalUrl} | texto≈${meta.bodyLen} chars`
  );
  if (!meta.title && meta.bodyLen < 40) {
    logger.warn('Página quase vazia (title vazio + pouco texto).');
  }
  return { status, ...meta };
}

async function run(page, { config, logger }) {
  if (!config.targetUrls.length) {
    throw new Error('STRATEGY=directLink exige TARGET_URLS no .env');
  }

  if (config.includeReferrer && config.referrers.length) {
    const ref = pick(config.referrers);
    logger.info(`Referrer: ${ref}`);
    await page.goto(ref, { waitUntil: 'domcontentloaded' });
  }

  const entryUrl = pick(config.targetUrls);
  assertHostAllowed(entryUrl, config.targetAllowHosts);

  const entryHost = new URL(entryUrl).hostname;
  const visited = new Set();
  const path = [];

  const first = await browsePage(page, entryUrl, logger, 'Entrada');
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
    assertHostAllowed(next, config.targetAllowHosts);

    try {
      const step = await browsePage(page, next, logger, `Navegação ${i + 1}/${extraPages}`);
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
