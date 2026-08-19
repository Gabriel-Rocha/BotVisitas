'use strict';

const { createLogger } = require('../utils/logger');
const logBuffer = require('./logBuffer');

function createBufferedLogger(level = 'info') {
  const base = createLogger(level);

  function wrap(method) {
    return (...args) => {
      logBuffer.push(method, args);
      base[method](...args);
    };
  }

  return {
    error: wrap('error'),
    warn: wrap('warn'),
    info: wrap('info'),
    debug: wrap('debug'),
  };
}

module.exports = { createBufferedLogger };
