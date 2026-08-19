'use strict';

const { pick, randomInt } = require('../utils/random');

async function run(page, { config, logger }) {
  if (!config.targetUrls.length) {
    throw new Error('STRATEGY=directLink exige TARGET_URLS no .env');
  }

  if (config.includeReferrer && config.referrers.length) {
    const ref = pick(config.referrers);
    logger.info(`Referrer: ${ref}`);
    await page.goto(ref, { waitUntil: 'domcontentloaded' });
  }

  const url = pick(config.targetUrls);
  logger.info(`Acessando: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const x = config.viewport.width / 2;
  const y = config.viewport.height / 2;
  const maxClicks = config.maxClicksPerPage;
  const clicks = maxClicks <= 0 ? 1 : randomInt(1, maxClicks);

  logger.info(`Cliques no centro (${x},${y}): ${clicks}`);
  for (let i = 0; i < clicks; i += 1) {
    await page.mouse.click(x, y);
  }

  return { ok: true, meta: { url, clicks } };
}

module.exports = {
  name: 'directLink',
  requiresBrowser: true,
  run,
};
