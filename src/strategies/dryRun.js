'use strict';

/**
 * Opt-in para validar config/loop sem subir browser.
 * Não é o default — produção usa directLink.
 */
async function run(_page, { config, logger }) {
  const wouldVisit = config.targetUrls.length
    ? config.targetUrls
    : ['(nenhum link — cole no painel antes do Start)'];

  logger.info('[dryRun] Pipeline OK — sem browser e sem direct links');
  logger.info(`[dryRun] Em produção visitaria: ${wouldVisit.join(', ')}`);
  logger.info(
    `[dryRun] includeReferrer=${config.includeReferrer} | maxClicks=${config.maxClicksPerPage} | tuxler=${Boolean(config.tuxler?.enabled)}`
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
