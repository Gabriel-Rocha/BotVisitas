'use strict';

/**
 * Valida Tuxler antes de subir o bot.
 * Exit 0 = SOCKS online + egress OK | Exit 1 = inativo
 */
const { loadConfig } = require('../src/config');
const { validateTuxlerActive, probeTuxlerActive } = require('../src/core/tuxler');
const { resolveStrategy } = require('../src/strategies');

const logger = {
  info: (...a) => console.log('[INFO]', ...a),
  warn: (...a) => console.warn('[WARN]', ...a),
  error: (...a) => console.error('[ERROR]', ...a),
  debug: () => {},
};

async function main() {
  const config = loadConfig();
  const quick = process.argv.includes('--quick');

  if (!config.tuxler?.enabled) {
    console.error('[FAIL] TUXLER_ENABLED=false — ligue no .env ou desative este check.');
    process.exit(1);
  }

  if (quick) {
    const probe = await probeTuxlerActive(config, logger);
    if (probe.active) {
      console.log(
        `[OK] Tuxler ativo | ip=${probe.geo?.ip} cc=${probe.geo?.countryCode} tz=${probe.geo?.timezoneId || '?'}`
      );
      process.exit(0);
    }
    console.error(`[FAIL] Tuxler inativo: ${probe.reason}`);
    process.exit(1);
  }

  try {
    const strategy = resolveStrategy(config.strategy);
    const result = await validateTuxlerActive(config, logger, { strategy });
    if (result.skipped) {
      console.log(`[SKIP] Validação ignorada (${result.reason})`);
      process.exit(0);
    }
    console.log(
      `[OK] Tuxler validado | ip=${result.geo.ip} cc=${result.geo.countryCode} tz=${result.geo.timezoneId || '?'}`
    );
    process.exit(0);
  } catch (err) {
    console.error(`[FAIL] ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[FAIL]', err.message);
  process.exit(1);
});
