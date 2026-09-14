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

/**
 * Box-Muller — distribuição gaussiana (média `mean`, desvio `sd`).
 * Usar só em TEMPO/SEQUÊNCIA, nunca em identidade.
 */
function gauss(mean = 0, sd = 1) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * sd;
}

module.exports = { randomInt, randomFloat, pick, chance, gauss };
