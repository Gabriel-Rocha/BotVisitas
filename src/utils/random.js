'use strict';

function randomInt(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function pick(list) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('pick() exige lista não vazia');
  }
  return list[randomInt(0, list.length - 1)];
}

module.exports = { randomInt, pick };
