'use strict';

const dryRun = require('./dryRun');
const directLink = require('./directLink');

const registry = {
  [dryRun.name]: dryRun,
  [directLink.name]: directLink,
};

function resolveStrategy(name) {
  const strategy = registry[name];
  if (!strategy) {
    const available = Object.keys(registry).join(', ');
    throw new Error(`Estratégia desconhecida: "${name}". Disponíveis: ${available}`);
  }
  return strategy;
}

module.exports = { resolveStrategy, registry };
