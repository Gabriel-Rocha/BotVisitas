'use strict';

const MAX = 500;
const lines = [];
const listeners = new Set();

let persistHook = null;

function setPersistHook(fn) {
  persistHook = typeof fn === 'function' ? fn : null;
}

function push(level, parts) {
  const text = parts
    .map((p) => {
      if (typeof p === 'string') return p;
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    })
    .join(' ');

  const entry = {
    ts: new Date().toISOString(),
    level,
    message: text,
  };

  lines.push(entry);
  if (lines.length > MAX) lines.shift();

  for (const fn of listeners) {
    try {
      fn(entry);
    } catch {
      // ignore listener errors
    }
  }

  if (persistHook) {
    try {
      persistHook(entry);
    } catch {
      // best-effort
    }
  }
}

function getRecent(limit = 200) {
  return lines.slice(-limit);
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { push, getRecent, subscribe, setPersistHook };
