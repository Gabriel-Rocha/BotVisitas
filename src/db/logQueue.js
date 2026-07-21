'use strict';

const { insertLogBatch } = require('./runs');
const { isAvailable } = require('./pool');

const FLUSH_MS = 400;
const MAX_BATCH = 100;

let queue = [];
let timer = null;
let flushing = false;
let currentRunId = null;

function setCurrentRunId(runId) {
  currentRunId = runId || null;
}

function getCurrentRunId() {
  return currentRunId;
}

function enqueueLog(entry) {
  if (!isAvailable()) return;
  queue.push({
    runId: entry.runId !== undefined ? entry.runId : currentRunId,
    level: entry.level,
    message: entry.message,
    ts: entry.ts || new Date().toISOString(),
  });
  if (queue.length >= MAX_BATCH) {
    flush().catch(() => {});
    return;
  }
  if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      flush().catch(() => {});
    }, FLUSH_MS);
  }
}

async function flush() {
  if (flushing) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.length || !isAvailable()) {
    if (!isAvailable()) queue = [];
    return;
  }

  flushing = true;
  try {
    while (queue.length) {
      const batch = queue.splice(0, MAX_BATCH);
      try {
        await insertLogBatch(batch);
      } catch {
        // best-effort: descartar lote se o banco falhar
      }
    }
  } finally {
    flushing = false;
  }
}

module.exports = {
  setCurrentRunId,
  getCurrentRunId,
  enqueueLog,
  flush,
};
