'use strict';

function isBenignTargetClose(err) {
  const name = err?.name || '';
  const msg = String(err?.message || err || '');
  if (name === 'TargetCloseError') return true;
  return (
    /Target closed/i.test(msg) ||
    /Session closed/i.test(msg) ||
    /page has been closed/i.test(msg) ||
    /target has been closed/i.test(msg) ||
    /Requesting main frame too early/i.test(msg) ||
    /Connection closed/i.test(msg)
  );
}

let installed = false;

function installBenignPuppeteerHandlers(logger) {
  if (installed) return;
  installed = true;

  process.on('unhandledRejection', (reason) => {
    if (isBenignTargetClose(reason)) {
      logger?.debug?.('Puppeteer target fechado (ignorado):', reason?.message || reason);
      return;
    }
    logger?.error?.('unhandledRejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    if (isBenignTargetClose(err)) {
      logger?.debug?.('Puppeteer exception ignorada:', err.message);
      return;
    }
    logger?.error?.('uncaughtException:', err);
    process.exit(1);
  });
}

module.exports = { isBenignTargetClose, installBenignPuppeteerHandlers };
