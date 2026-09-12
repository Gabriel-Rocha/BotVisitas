'use strict';

/**
 * Gate opcional de gotos no SOCKS Tuxler.
 * Por padrão o paralelismo = número de workers (CONCURRENCY).
 * TUXLER_NAV_SLOTS>0 só se quiser um teto menor que os workers.
 */

function createNavGate(maxConcurrent = 3) {
  const max = Math.max(1, Number(maxConcurrent) || 3);
  let active = 0;
  /** @type {Array<() => void>} */
  const waiters = [];

  async function run(fn, { acquireTimeoutMs = 20_000, signal } = {}) {
    if (signal?.aborted) {
      const err = new Error('Operação abortada');
      err.name = 'AbortError';
      throw err;
    }

    if (active >= max) {
      await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          finish(() => {
            const err = new Error('Nav gate timeout — SOCKS saturado');
            err.code = 'NAV_GATE_TIMEOUT';
            reject(err);
          });
        }, Math.max(1_000, Number(acquireTimeoutMs) || 20_000));

        function wake() {
          finish(resolve);
        }

        function onAbort() {
          finish(() => {
            const err = new Error('Operação abortada');
            err.name = 'AbortError';
            reject(err);
          });
        }

        function finish(cb) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          const idx = waiters.indexOf(wake);
          if (idx >= 0) waiters.splice(idx, 1);
          cb();
        }

        waiters.push(wake);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }

    if (signal?.aborted) {
      const err = new Error('Operação abortada');
      err.name = 'AbortError';
      throw err;
    }

    active += 1;
    try {
      return await fn();
    } finally {
      active = Math.max(0, active - 1);
      const next = waiters.shift();
      if (next) next();
    }
  }

  return { run, max };
}

let shared = null;

function getTuxlerNavGate(maxConcurrent = 3) {
  if (!shared) shared = createNavGate(maxConcurrent);
  return shared;
}

function resetTuxlerNavGate() {
  shared = null;
}

module.exports = { createNavGate, getTuxlerNavGate, resetTuxlerNavGate };
