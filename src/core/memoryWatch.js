'use strict';

const os = require('os');

function bytesToMb(n) {
  return Math.round((Number(n) || 0) / 1024 / 1024);
}

function readNodeMemory() {
  try {
    const usage = process.memoryUsage();
    return {
      nodeRssMb: bytesToMb(usage.rss),
      nodeHeapMb: bytesToMb(usage.heapUsed),
    };
  } catch {
    return { nodeRssMb: 0, nodeHeapMb: 0 };
  }
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
    ...readNodeMemory(),
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
  let warnStreak = 0;
  let lastSnapshot = readMemorySnapshot();

  function tick() {
    lastSnapshot = readMemorySnapshot();
    const level = classifyPressure(lastSnapshot, { warnPct, criticalPct });
    const { usedPct, usedMb, freeMb, totalMb } = lastSnapshot;
    const pctLabel = `${Math.round(usedPct * 100)}%`;
    const now = Date.now();

    const fireRecycle = (label) => {
      if (now - lastCriticalAt < 25_000) return;
      lastCriticalAt = now;
      logger?.warn?.(label);
      Promise.resolve(onCritical?.(lastSnapshot)).catch((err) => {
        logger?.warn?.('Watchdog RAM falhou:', err.message);
      });
    };

    if (level === 'critical') {
      warnStreak = 0;
      fireRecycle(
        `RAM crítica ${pctLabel} (${usedMb}/${totalMb} MB, livre ${freeMb} MB) — reciclagem imediata de browsers`
      );
    } else if (level === 'warn') {
      warnStreak += 1;
      if (lastLevel !== 'warn') {
        logger?.warn?.(
          `RAM alta ${pctLabel} (${usedMb}/${totalMb} MB, livre ${freeMb} MB) — monitorando`
        );
      }
      // 2 ticks (~40s) em warn: recicla antes de chegar em critical (leak lento).
      if (warnStreak >= 2) {
        fireRecycle(
          `RAM alta sustentada ${pctLabel} (${usedMb}/${totalMb} MB) — reciclagem preventiva`
        );
        warnStreak = 0;
      }
    } else if (level === 'ok' && lastLevel !== 'ok') {
      warnStreak = 0;
      logger?.info?.(`RAM normalizou ${pctLabel} (livre ${freeMb} MB)`);
    } else {
      warnStreak = 0;
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
