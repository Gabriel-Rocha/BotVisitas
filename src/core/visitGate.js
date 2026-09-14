'use strict';

/**
 * Fila global de visitas — no máximo 1 hit em voo (VISIT_SERIAL).
 * Combina mutex + cadência (gap / burst / soft / hard) de schedule.js.
 */

const { waitForVisitSlot, recordGlobalHit, getCadenceSnapshot } = require('./schedule');

/**
 * @param {object} opts
 * @param {object} opts.config
 * @param {object} [opts.logger]
 */
function createVisitGate({ config, logger = null } = {}) {
  let held = false;
  /** @type {Array<() => void>} */
  const waiters = [];

  async function waitMutex({ shouldStop, signal } = {}) {
    if (!config.visitSerial) return;
    if (!held) {
      held = true;
      return;
    }
    await new Promise((resolve, reject) => {
      const entry = () => {
        held = true;
        resolve();
      };
      waiters.push(entry);
      if (signal) {
        const onAbort = () => {
          const idx = waiters.indexOf(entry);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      if (shouldStop?.()) {
        const idx = waiters.indexOf(entry);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(Object.assign(new Error('stop'), { name: 'AbortError' }));
      }
    });
  }

  function releaseMutex() {
    if (!config.visitSerial) return;
    held = false;
    const next = waiters.shift();
    if (next) next();
  }

  /**
   * Bloqueia até poder emitir uma visita (mutex + gap + burst + caps + janela).
   */
  async function acquire({
    countryCode = 'BR',
    workerId = 0,
    logger: log = logger,
    shouldStop = () => false,
    signal = null,
  } = {}) {
    await waitMutex({ shouldStop, signal });
    try {
      const slot = await waitForVisitSlot({
        countryCode,
        config,
        logger: log,
        shouldStop,
        signal,
        filePath: config.scheduleFile,
      });
      if (slot.skipped) {
        releaseMutex();
        return slot;
      }
      return { ...slot, release: () => releaseMutex() };
    } catch (err) {
      releaseMutex();
      throw err;
    }
  }

  function markCompleted(ip = null) {
    return recordGlobalHit(config.scheduleFile, ip);
  }

  function snapshot() {
    return getCadenceSnapshot(config);
  }

  return { acquire, markCompleted, snapshot, releaseMutex };
}

module.exports = { createVisitGate };
