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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickBySelector(page, selector, times, timeoutMs, logger) {
  let el = null;
  try {
    el = await page.waitForSelector(selector, { visible: true, timeout: timeoutMs });
  } catch {
    el = null;
  }
  if (!el) {
    logger.warn(`Selector não encontrado: "${selector}" (nada clicado)`);
    return { selectorFound: false, clicks: 0 };
  }
  await el.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center' }));
  await sleep(randomInt(400, 1200));
  logger.info(`Selector "${selector}" encontrado — cliques: ${times}`);
  for (let i = 0; i < times; i += 1) {
    await el.click({ delay: randomInt(40, 120) });
    if (i < times - 1) await sleep(randomInt(300, 900));
  }
  return { selectorFound: true, clicks: times };
}

async function clickCenter(page, viewport, times, logger) {
  const x = viewport.width / 2;
  const y = viewport.height / 2;
  logger.warn(
    `CLICK_SELECTOR vazio — clique no centro (${x},${y}) NÃO aciona botão/CTA do site. ` +
      'Defina CLICK_SELECTOR (ex.: #cta) para o analytics registrar click.'
  );
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

  // Dá tempo de scripts de analytics/CTA carregarem (domcontentloaded sozinho é cedo demais).
  try {
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 8_000 });
  } catch {
    // páginas com polling eterno — segue com o que já carregou
  }

  const dwellSec = randomInt(3, 8);
  logger.info(`Dwell ${dwellSec}s antes do clique...`);
  await sleep(dwellSec * 1000);

  let title = '';
  let finalUrl = url;
  let bodyLen = 0;
  try {
    title = await page.title();
    finalUrl = page.url();
    bodyLen = await page.evaluate(() => (document.body && document.body.innerText
      ? document.body.innerText.trim().length
      : 0));
  } catch {
    // página sem título / navegação especial
  }
  logger.info(
    `Resposta: status=${status} | title="${title}" | final=${finalUrl} | texto≈${bodyLen} chars`
  );
  if (!title && bodyLen < 40) {
    logger.warn(
      'Página quase vazia (title vazio + pouco texto). Impressão/click no seu sistema tende a falhar.'
    );
  }

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
      finalUrl,
      status,
      title,
      bodyLen,
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
