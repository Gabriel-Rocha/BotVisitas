'use strict';

const { randomInt } = require('./random');

function sleep(ms) {
  const n = Number(ms) || 0;
  if (n <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, n));
}

async function sleepRange(minMs, maxMs) {
  const ms = randomInt(minMs, maxMs);
  await sleep(ms);
  return ms;
}

module.exports = { sleep, sleepRange };
