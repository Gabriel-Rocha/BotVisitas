'use strict';

/**
 * Estratégia segura para validar config/loop em qualquer device.
 * Não sobe browser e não acessa smartlinks.
 */
async function run(_page, { config, logger }) {
  const wouldVisit = config.targetUrls.length
    ? config.targetUrls
    : ['(nenhuma TARGET_URLS configurada)'];

  logger.info('[dryRun] Pipeline OK — sem browser e sem direct links');
  logger.info(`[dryRun] Em produção visitaria: ${wouldVisit.join(', ')}`);
  logger.info(
    `[dryRun] includeReferrer=${config.includeReferrer} | browse=${config.browsePagesMin}-${config.browsePagesMax} | proxy=${config.proxy.enabled}`
  );

  return {
    ok: true,
    meta: { mode: 'dryRun', wouldVisit },
  };
}

module.exports = {
  name: 'dryRun',
  requiresBrowser: false,
  run,
};
