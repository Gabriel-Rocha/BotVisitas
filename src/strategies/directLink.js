'use strict';

const { pick, randomInt } = require('../utils/random');

/**
 * Direct link — implementado, mas NÃO é o default.
 * Ative só com STRATEGY=directLink e TARGET_URLS no .env.
 *
 * Use apenas contra infra que VOCÊ controla. Se TARGET_ALLOW_HOSTS estiver
 * setado, cada alvo é validado contra essa allow-list.
 */

function assertHostAllowed(rawUrl, allowHosts) {
  if (!allowHosts || !allowHosts.length) return; // sem restrição (default)
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`URL inválida em TARGET_URLS: "${rawUrl}"`);
  }
  if (u.protocol === 'file:') return; // arquivo local é inerentemente controlado
  if (!allowHosts.includes(u.hostname)) {
    throw new Error(
      `Alvo "${u.hostname}" fora de TARGET_ALLOW_HOSTS [${allowHosts.join(', ')}]. ` +
        'directLink só deve apontar para infra que você controla.'
    );
  }
}

async function clickBySelector(page, selector, times, timeoutMs, logger) {
  let el = null;
  try {
    el = await page.waitForSelector(selector, { timeout: timeoutMs });
  } catch {
    el = null;
  }
  if (!el) {
    logger.warn(`Selector não encontrado: "${selector}" (nada clicado)`);
    return { selectorFound: false, clicks: 0 };
  }
  logger.info(`Selector "${selector}" encontrado — cliques: ${times}`);
  for (let i = 0; i < times; i += 1) {
    await el.click(); // já rola o elemento p/ a viewport e clica no centro dele
  }
  return { selectorFound: true, clicks: times };
}

async function clickCenter(page, viewport, times, logger) {
  const x = viewport.width / 2;
  const y = viewport.height / 2;
  logger.info(`Cliques no centro (${x},${y}): ${times}`);
  for (let i = 0; i < times; i += 1) {
    await page.mouse.click(x, y);
  }
  return { selectorFound: null, clicks: times };
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

  const url = pick(config.targetUrls);
  assertHostAllowed(url, config.targetAllowHosts);

  logger.info(`Acessando: ${url}`);
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
  const status = resp ? resp.status() : null;
  let title = '';
  try {
    title = await page.title();
  } catch {
    // página sem título / navegação especial
  }
  logger.info(`Resposta: status=${status} | title="${title}"`);

  const times = randomInt(1, config.maxClicksPerPage);
  const result = config.clickSelector
    ? await clickBySelector(page, config.clickSelector, times, config.defaultTimeoutMs, logger)
    : await clickCenter(page, config.viewport, times, logger);

  // ok=false só quando havia um selector e ele não foi encontrado (falha honesta do teste).
  const ok = result.selectorFound !== false;
  return {
    ok,
    meta: {
      url,
      status,
      title,
      selector: config.clickSelector || null,
      selectorFound: result.selectorFound,
      clicks: result.clicks,
    },
  };
}

module.exports = {
  name: 'directLink',
  requiresBrowser: true,
  run,
};
