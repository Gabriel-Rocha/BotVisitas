'use strict';

const { pick, randomInt, chance } = require('../utils/random');
const { humanClick, browseLikeHuman, clickPoint, dwell } = require('../core/human');
const { extraHttpHeaders } = require('../core/stealth');
const { sleepRange } = require('../utils/sleep');

async function gotoTarget(page, url, referer, identity) {
  const opts = { waitUntil: 'domcontentloaded' };
  if (referer) opts.referer = referer;
  try {
    await page.goto(url, opts);
  } catch (err) {
    if (referer && identity) {
      await page.setExtraHTTPHeaders({ ...extraHttpHeaders(identity), Referer: referer });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      return;
    }
    throw err;
  }
}

async function run(page, { config, logger, identity }) {
  if (!config.targetUrls.length) {
    throw new Error('STRATEGY=directLink exige TARGET_URLS no .env');
  }

  const viewport = identity?.viewport || page.viewport() || config.viewport;
  let referer = null;

  if (config.includeReferrer && config.referrers.length) {
    referer = pick(config.referrers);
    if (chance(0.35)) {
      logger.info(`Navegando pelo referrer: ${referer}`);
      await page.goto(referer, { waitUntil: 'domcontentloaded' });
      await browseLikeHuman(page, config);
    } else {
      logger.info(`Referrer (header): ${referer}`);
    }
  }

  const url = pick(config.targetUrls);
  logger.info(`Acessando: ${url}`);
  await gotoTarget(page, url, referer, identity);
  await browseLikeHuman(page, config);

  const maxClicks = config.maxClicksPerPage;
  const clicks = maxClicks <= 0 ? 1 : randomInt(1, maxClicks);

  logger.info(`Cliques humanizados: ${clicks}`);
  for (let i = 0; i < clicks; i += 1) {
    const point = clickPoint(viewport);
    if (config.stealth.humanize) {
      await humanClick(page, point.x, point.y);
    } else {
      await page.mouse.click(point.x, point.y);
    }
    if (i < clicks - 1) await sleepRange(180, 640);
  }

  await dwell(config);

  return { ok: true, meta: { url, clicks, profileId: identity?.profileId || null } };
}

module.exports = {
  name: 'directLink',
  requiresBrowser: true,
  run,
};
