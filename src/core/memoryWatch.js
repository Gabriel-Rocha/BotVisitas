'use strict';

const os = require('os');

function bytesToMb(n) {
  return Math.round((Number(n) || 0) / 1024 / 1024);
}

function readMemorySnapshot() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  const usedPct = total > 0 ? used / total : 0;
  return {
    totalMb: bytesToMb(total),
    freeMb: bytesToMb(free),
    usedMb: bytesToMb(used),
    usedPct,
  };
}

function classifyPressure(snapshot, { warnPct = 0.82, criticalPct = 0.9 } = {}) {
  const usedPct = snapshot.usedPct || 0;
  if (usedPct >= criticalPct) return 'critical';
  if (usedPct >= warnPct) return 'warn';
  return 'ok';
}

function createMemoryWatch({
  logger,
  warnPct = 0.82,
  criticalPct = 0.9,
  intervalMs = 20_000,
  onCritical = null,
} = {}) {
  let timer = null;
  let lastLevel = 'ok';
  let lastCriticalAt = 0;
  let lastSnapshot = readMemorySnapshot();

  function tick() {
    lastSnapshot = readMemorySnapshot();
    const level = classifyPressure(lastSnapshot, { warnPct, criticalPct });
    const { usedPct, usedMb, freeMb, totalMb } = lastSnapshot;
    const pctLabel = `${Math.round(usedPct * 100)}%`;

    if (level === 'critical') {
      const now = Date.now();
      if (now - lastCriticalAt > 30_000) {
        lastCriticalAt = now;
        logger?.warn?.(
          `RAM crítica ${pctLabel} (${usedMb}/${totalMb} MB, livre ${freeMb} MB) — reciclagem de browsers`
        );
        Promise.resolve(onCritical?.(lastSnapshot)).catch((err) => {
          logger?.warn?.('Watchdog RAM falhou:', err.message);
        });
      }
    } else if (level === 'warn' && lastLevel !== 'warn') {
      logger?.warn?.(
        `RAM alta ${pctLabel} (${usedMb}/${totalMb} MB, livre ${freeMb} MB) — próximo restart periódico`
      );
    } else if (level === 'ok' && lastLevel !== 'ok') {
      logger?.info?.(`RAM normalizou ${pctLabel} (livre ${freeMb} MB)`);
    }

    lastLevel = level;
  }

  function start() {
    stop();
    tick();
    timer = setInterval(tick, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function getSnapshot() {
    lastSnapshot = readMemorySnapshot();
    return {
      ...lastSnapshot,
      level: classifyPressure(lastSnapshot, { warnPct, criticalPct }),
    };
  }

  return { start, stop, getSnapshot };
}

module.exports = {
  createMemoryWatch,
  readMemorySnapshot,
  classifyPressure,
};
