'use strict';

const { randomInt } = require('./random');

function createAbortError(reason = 'aborted') {
  const err = new Error(reason === 'stopped' ? 'Worker encerrando' : 'Operação abortada');
  err.name = 'AbortError';
  err.code = reason;
  return err;
}

function isAbortError(err) {
  return err?.name === 'AbortError';
}

function sleep(ms, opts = {}) {
  const n = Number(ms) || 0;
  if (n <= 0) return Promise.resolve();
  const { signal } = opts;
  if (signal?.aborted) return Promise.reject(createAbortError('aborted'));

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };

    const onAbort = () => finish(reject, createAbortError('aborted'));

    const timer = setTimeout(() => finish(resolve), n);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Sleep em fatias curtas — responde a shouldStop() sem esperar o bloco inteiro. */
async function sleepInterruptible(ms, { signal, shouldStop, chunkMs = 250 } = {}) {
  let remaining = Number(ms) || 0;
  while (remaining > 0) {
    if (shouldStop?.()) throw createAbortError('stopped');
    if (signal?.aborted) throw createAbortError('aborted');
    const step = Math.min(chunkMs, remaining);
    await sleep(step, { signal });
    remaining -= step;
  }
}

async function sleepRange(minMs, maxMs, opts) {
  const ms = randomInt(minMs, maxMs);
  await sleep(ms, opts);
  return ms;
}

module.exports = {
  sleep,
  sleepInterruptible,
  sleepRange,
  createAbortError,
  isAbortError,
};
