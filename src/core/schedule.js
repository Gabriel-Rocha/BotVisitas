'use strict';

/**
 * Cadência global com espaçamento — persistida em config/schedule.json.
 * Gap entre hits + burst pause + soft/hard cap diário + janela local.
 */

const fs = require('fs');
const path = require('path');
const { gauss, randomInt, randomFloat } = require('../utils/random');
const { sleepInterruptible } = require('../utils/sleep');

const DEFAULT_FILE = path.join(process.cwd(), 'config', 'schedule.json');
const GLOBAL_KEY = '__global__';

/** Offsets UTC aproximados (horas) por país — janela local 08–23. */
const COUNTRY_UTC_OFFSET = {
  BR: -3,
  AR: -3,
  CL: -4,
  CO: -5,
  PE: -5,
  MX: -6,
  US: -5,
  CA: -5,
  GB: 0,
  PT: 0,
  DE: 1,
  FR: 1,
  IT: 1,
  ES: 1,
  NL: 1,
  AU: 10,
  SG: 8,
  JP: 9,
  HK: 8,
  VE: -4,
  DZ: 1,
};

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function loadSchedule(filePath = DEFAULT_FILE) {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        lastHitAt: {},
        hitsToday: {},
        meta: {
          softPauseUntil: 0,
          lastBurstHitCount: 0,
          softCapTriggeredDate: null,
        },
      };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      lastHitAt: raw.lastHitAt || {},
      hitsToday: raw.hitsToday || {},
      meta: {
        softPauseUntil: Number(raw.meta?.softPauseUntil || 0),
        lastBurstHitCount: Number(raw.meta?.lastBurstHitCount || 0),
        softCapTriggeredDate: raw.meta?.softCapTriggeredDate || null,
        ...(raw.meta || {}),
      },
    };
  } catch {
    return {
      lastHitAt: {},
      hitsToday: {},
      meta: { softPauseUntil: 0, lastBurstHitCount: 0, softCapTriggeredDate: null },
    };
  }
}

function saveSchedule(state, filePath = DEFAULT_FILE) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function hitsTodayGlobal(state) {
  const row = state.hitsToday[GLOBAL_KEY];
  if (!row || row.date !== dayKey()) return 0;
  return Number(row.count) || 0;
}

function hitsTodayFor(state, ip) {
  if (!ip || ip === GLOBAL_KEY) return hitsTodayGlobal(state);
  const row = state.hitsToday[ip];
  if (!row || row.date !== dayKey()) return 0;
  return Number(row.count) || 0;
}

function recordHit(state, ip, filePath = DEFAULT_FILE) {
  const now = Date.now();
  const today = dayKey();
  const keys = [GLOBAL_KEY];
  if (ip && ip !== GLOBAL_KEY && ip !== 'unknown') keys.push(ip);

  for (const key of keys) {
    state.lastHitAt[key] = now;
    const row = state.hitsToday[key];
    if (!row || row.date !== today) {
      state.hitsToday[key] = { date: today, count: 1 };
    } else {
      row.count = (Number(row.count) || 0) + 1;
    }
  }

  const globalHits = hitsTodayGlobal(state);
  const burstEvery = Number(state.meta._burstEvery || 0);
  if (burstEvery > 0 && globalHits > 0 && globalHits % burstEvery === 0) {
    state.meta.lastBurstHitCount = globalHits;
  }

  saveSchedule(state, filePath);
  return {
    hitsToday: globalHits,
    lastHitAt: now,
  };
}

function recordGlobalHit(filePath = DEFAULT_FILE, ip = null) {
  const state = loadSchedule(filePath);
  return recordHit(state, ip || GLOBAL_KEY, filePath);
}

/**
 * Gap gaussiano entre visitas (segundos → ms).
 */
function nextVisitGapMs(config) {
  const minS = Math.max(0, Number(config.visitGapMinSec ?? 8));
  const maxS = Math.max(minS, Number(config.visitGapMaxSec ?? 25));
  const mean = (minS + maxS) / 2;
  const sd = Math.max(1, (maxS - minS) / 4);
  let sec = mean + gauss(0, sd);
  sec = Math.max(minS, Math.min(maxS, sec));
  // leve jitter extra
  sec *= 1 + gauss(0, 0.08);
  sec = Math.max(minS, Math.min(maxS * 1.15, sec));
  return Math.round(sec * 1000);
}

function burstPauseMs(config) {
  const lo = Math.max(0, Number(config.burstPauseMinMin ?? 15));
  const hi = Math.max(lo, Number(config.burstPauseMaxMin ?? 45));
  return randomInt(lo, hi) * 60_000;
}

function localHourForCountry(countryCode) {
  const cc = String(countryCode || 'BR').toUpperCase();
  const offset = COUNTRY_UTC_OFFSET[cc] ?? -3;
  const utcH = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
  let local = (utcH + offset) % 24;
  if (local < 0) local += 24;
  return local;
}

function msUntilActiveWindow(config, countryCode) {
  const start = Number(config.hitActiveHourStart ?? 8);
  const end = Number(config.hitActiveHourEnd ?? 23);
  const local = localHourForCountry(countryCode);
  if (local >= start && local < end) return 0;

  let hoursUntil = start - local;
  if (hoursUntil <= 0) hoursUntil += 24;
  return Math.round(hoursUntil * 3_600_000);
}

/**
 * Aguarda até poder emitir o próximo hit global.
 */
async function waitForVisitSlot({
  countryCode = 'BR',
  config,
  logger = null,
  shouldStop = () => false,
  signal = null,
  filePath = DEFAULT_FILE,
} = {}) {
  const softCap = Math.max(0, Number(config.hitSoftCapDay ?? 1000));
  const softPauseH = Math.max(0, Number(config.hitSoftPauseHours ?? 1));
  const hardCap = Math.max(0, Number(config.hitHardCapDay ?? 2500));
  const burstEvery = Math.max(0, Number(config.burstEveryHits ?? 200));
  const minGapMs = Math.max(0, Number(config.visitGapMinSec ?? 8)) * 1000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (shouldStop()) return { skipped: true, reason: 'stop' };

    const state = loadSchedule(filePath);
    state.meta._burstEvery = burstEvery;
    const hits = hitsTodayGlobal(state);
    const now = Date.now();

    // Hard cap: para até amanhã
    if (hardCap > 0 && hits >= hardCap) {
      const waitMs =
        Math.round((24 - localHourForCountry(countryCode)) * 3_600_000) +
        randomFloat(60_000, 300_000);
      logger?.info?.(
        `Cadência: hard cap ${hits}/${hardCap} hits hoje — dormindo ~${Math.round(waitMs / 3_600_000)}h`
      );
      await sleepInterruptible(Math.min(waitMs, 6 * 3_600_000), { shouldStop, signal });
      continue;
    }

    // Soft pause em andamento
    if (state.meta.softPauseUntil && now < state.meta.softPauseUntil) {
      const waitMs = state.meta.softPauseUntil - now;
      logger?.info?.(
        `Cadência: soft pause até ${new Date(state.meta.softPauseUntil).toLocaleTimeString()} (~${Math.round(waitMs / 60_000)}min)`
      );
      await sleepInterruptible(Math.min(waitMs, 3_600_000), { shouldStop, signal });
      continue;
    }

    // Soft cap: dispara 1× por dia ao cruzar o limiar
    if (
      softCap > 0 &&
      hits >= softCap &&
      state.meta.softCapTriggeredDate !== dayKey() &&
      softPauseH > 0
    ) {
      state.meta.softCapTriggeredDate = dayKey();
      state.meta.softPauseUntil = now + Math.round(softPauseH * 3_600_000);
      saveSchedule(state, filePath);
      logger?.info?.(
        `Cadência: soft cap ${hits}/${softCap} — pausa de ${softPauseH}h`
      );
      continue;
    }

    const windowWait = msUntilActiveWindow(config, countryCode);
    if (windowWait > 0) {
      logger?.info?.(
        `Cadência: fora da janela local (${config.hitActiveHourStart ?? 8}–${config.hitActiveHourEnd ?? 23}) — aguardando ${Math.round(windowWait / 60_000)}min`
      );
      await sleepInterruptible(Math.min(windowWait, 3_600_000), { shouldStop, signal });
      continue;
    }

    // Burst: a cada N hits, pausa longa (antes do próximo após múltiplo)
    if (
      burstEvery > 0 &&
      hits > 0 &&
      hits % burstEvery === 0 &&
      Number(state.meta.lastBurstHitCount || 0) === hits
    ) {
      // lastBurstHitCount == hits significa que o último recordHit marcou este múltiplo
      // e ainda não consumimos a pausa — limpar marcador e pausar
      const pauseMs = burstPauseMs(config);
      state.meta.lastBurstHitCount = hits - 1; // evita re-disparar até o próximo múltiplo
      saveSchedule(state, filePath);
      logger?.info?.(
        `Cadência: burst a cada ${burstEvery} hits (agora ${hits}) — pausa ${Math.round(pauseMs / 60_000)}min`
      );
      await sleepInterruptible(pauseMs, { shouldStop, signal });
      continue;
    }

    const last = Number(state.lastHitAt[GLOBAL_KEY] || 0);
    const elapsed = last ? now - last : Number.POSITIVE_INFINITY;
    const needGap = Math.max(minGapMs, nextVisitGapMs(config));
    if (last && elapsed < needGap) {
      const waitMs = needGap - elapsed;
      logger?.info?.(
        `Cadência: gap ${Math.round(waitMs / 1000)}s antes do próximo hit (${hits} hoje)`
      );
      await sleepInterruptible(waitMs, { shouldStop, signal });
      continue;
    }

    return {
      skipped: false,
      hitsToday: hits,
      minutesSinceLastHit: last ? Math.round(elapsed / 60_000) : null,
      softCap,
      hardCap,
      nextPauseHint:
        softCap > 0 && hits < softCap
          ? `soft em ${softCap - hits} hits`
          : hardCap > 0
            ? `hard ${hardCap}`
            : null,
    };
  }
}

/** @deprecated use waitForVisitSlot — mantido para compat */
async function waitForHitSlot(opts) {
  return waitForVisitSlot(opts);
}

function markHit(ip, filePath = DEFAULT_FILE) {
  const state = loadSchedule(filePath);
  return recordHit(state, ip || GLOBAL_KEY, filePath);
}

function getIpDayStats(ip, filePath = DEFAULT_FILE) {
  const state = loadSchedule(filePath);
  const last = Number(state.lastHitAt[ip || GLOBAL_KEY] || state.lastHitAt[GLOBAL_KEY] || 0);
  return {
    hitsToday: hitsTodayGlobal(state),
    hitsTodayIp: ip ? hitsTodayFor(state, ip) : hitsTodayGlobal(state),
    lastHitAt: last || null,
    minutesSinceLastHit: last ? Math.round((Date.now() - last) / 60_000) : null,
    softPauseUntil: state.meta.softPauseUntil || null,
  };
}

function getCadenceSnapshot(config, filePath = null) {
  const fp = filePath || config.scheduleFile || DEFAULT_FILE;
  const state = loadSchedule(fp);
  const hits = hitsTodayGlobal(state);
  const last = Number(state.lastHitAt[GLOBAL_KEY] || 0);
  return {
    hitsToday: hits,
    softCap: config.hitSoftCapDay ?? 1000,
    hardCap: config.hitHardCapDay ?? 2500,
    softPauseUntil: state.meta.softPauseUntil || null,
    lastHitAt: last || null,
    minutesSinceLastHit: last ? Math.round((Date.now() - last) / 60_000) : null,
  };
}

// Compat exports antigos
function nextGapMs(config) {
  if (config.visitGapMinSec != null) return nextVisitGapMs(config);
  const minH = Number(config.hitMinGapHours ?? 3);
  const maxH = Number(config.hitMaxGapHours ?? 8);
  const baseH = minH + Math.random() * Math.max(0, maxH - minH);
  const jittered = Math.max(baseH, baseH * (1 + gauss(0, 0.35)));
  return Math.round(jittered * 3_600_000);
}

function workerGapScale() {
  return 1;
}

module.exports = {
  DEFAULT_FILE,
  GLOBAL_KEY,
  loadSchedule,
  saveSchedule,
  waitForVisitSlot,
  waitForHitSlot,
  recordGlobalHit,
  markHit,
  getIpDayStats,
  getCadenceSnapshot,
  nextVisitGapMs,
  nextGapMs,
  workerGapScale,
  localHourForCountry,
  msUntilActiveWindow,
  hitsTodayGlobal,
};
