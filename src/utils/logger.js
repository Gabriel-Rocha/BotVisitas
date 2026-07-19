'use strict';

function createLogger(level = 'info') {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  const current = levels[level] ?? levels.info;

  function write(tag, args) {
    if ((levels[tag] ?? 99) > current) return;
    const ts = new Date().toISOString();
    const prefix = `[${ts}] [${tag.toUpperCase()}]`;
    // eslint-disable-next-line no-console
    console[tag === 'debug' ? 'log' : tag](prefix, ...args);
  }

  return {
    error: (...args) => write('error', args),
    warn: (...args) => write('warn', args),
    info: (...args) => write('info', args),
    debug: (...args) => write('debug', args),
  };
}

module.exports = { createLogger };
