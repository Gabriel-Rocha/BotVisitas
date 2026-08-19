'use strict';

const { pick, randomInt } = require('../utils/random');
const { sleep } = require('../utils/sleep');
const { humanBrowsePause, navigateLikeHuman } = require('../core/stealth');

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

  const x = config.viewport.width / 2;
  const y = config.viewport.height / 2;
  const maxClicks = config.maxClicksPerPage;
  const clicks = maxClicks <= 0 ? 1 : randomInt(1, maxClicks);

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
