'use strict';

function randomInt(min, max) {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(list) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('pick() exige lista não vazia');
  }
  return list[randomInt(0, list.length - 1)];
}

function chance(probability) {
  return Math.random() < probability;
}

module.exports = { randomInt, randomFloat, pick, chance };
