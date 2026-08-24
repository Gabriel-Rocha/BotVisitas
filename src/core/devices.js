'use strict';

const { pick } = require('../utils/random');

const DEVICE_TYPES = ['desktop', 'mobile', 'tablet'];
const DEFAULT_TYPE = 'desktop';

/**
 * Parseia WORKER_SLOTS=mobile:au,desktop:de,mobile:us → [{ type, country }, ...]
 * País opcional (ISO-2). Entradas inválidas são ignoradas.
 */
function parseWorkerSlots(raw) {
  if (!raw || !String(raw).trim()) return [];
  const slots = [];
  for (const part of String(raw).split(',')) {
    const token = part.trim();
    if (!token) continue;
    const m = token.match(/^(desktop|mobile|tablet)(?::([a-zA-Z]{2}))?$/i);
    if (!m) continue;
    slots.push({
      type: m[1].toLowerCase(),
      country: m[2] ? m[2].toLowerCase() : '',
    });
  }
  return slots;
}

function serializeWorkerSlots(slots) {
  if (!Array.isArray(slots) || !slots.length) return '';
  return slots
    .map((slot) => {
      const type = DEVICE_TYPES.includes(slot.type) ? slot.type : DEFAULT_TYPE;
      const cc = String(slot.country || '')
        .trim()
        .toLowerCase();
      return cc && /^[a-z]{2}$/.test(cc) ? `${type}:${cc}` : type;
    })
    .join(',');
}

/**
 * Parseia DEVICE_MIX=desktop:2,mobile:3,tablet:1 → [{ type, count }, ...]
 * Entradas inválidas são ignoradas.
 */
function parseDeviceMixRaw(raw) {
  if (!raw || !String(raw).trim()) return [];

  const parts = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const counts = new Map();
  for (const part of parts) {
    const m = part.match(/^([a-zA-Z]+)\s*:\s*(\d+)$/);
    if (!m) continue;
    const type = m[1].toLowerCase();
    const count = Number.parseInt(m[2], 10);
    if (!DEVICE_TYPES.includes(type) || !Number.isFinite(count) || count <= 0) continue;
    counts.set(type, (counts.get(type) || 0) + count);
  }

  return DEVICE_TYPES.filter((t) => counts.has(t)).map((type) => ({
    type,
    count: counts.get(type),
  }));
}

/**
 * Expande o mix em uma lista ordenada de tipos (ex.: ['mobile','mobile','desktop']).
 */
function expandMix(entries) {
  const list = [];
  for (const { type, count } of entries) {
    for (let i = 0; i < count; i += 1) list.push(type);
  }
  return list;
}

/**
 * Mix padrão quando DEVICE_MIX está vazio (~55% mobile, ~35% desktop, ~10% tablet).
 * Tráfego de ads costuma ser majoritariamente mobile.
 */
function defaultDeviceTypes(concurrency) {
  const n = Math.max(1, concurrency || 1);
  if (n === 1) return ['mobile'];
  if (n === 2) return ['mobile', 'desktop'];

  let mobile = Math.round(n * 0.55);
  let tablet = n >= 5 ? Math.max(1, Math.round(n * 0.1)) : 0;
  let desktop = n - mobile - tablet;

  if (desktop < 1) {
    desktop = 1;
    mobile = Math.max(1, n - desktop - tablet);
  }
  if (mobile + desktop + tablet !== n) {
    mobile = Math.max(1, n - desktop - tablet);
  }

  return expandMix(
    [
      { type: 'desktop', count: desktop },
      { type: 'mobile', count: mobile },
      { type: 'tablet', count: tablet },
    ].filter((e) => e.count > 0)
  );
}

/**
 * Trunca mantendo proporção aproximada (intercala por tipo).
 */
function truncateProportional(types, max) {
  if (types.length <= max) return types;
  if (max <= 0) return [];

  const buckets = new Map();
  for (const t of types) {
    if (!buckets.has(t)) buckets.set(t, []);
    buckets.get(t).push(t);
  }

  const result = [];
  const keys = [...buckets.keys()];
  let i = 0;
  while (result.length < max) {
    const key = keys[i % keys.length];
    const bucket = buckets.get(key);
    if (bucket && bucket.length) {
      result.push(bucket.shift());
    }
    i += 1;
    if (keys.every((k) => !buckets.get(k)?.length)) break;
  }
  return result;
}

/**
 * Resolve a lista de deviceTypes para os workers.
 *
 * - WORKER_SLOTS setado → 1:1 (device + país), ordem do painel
 * - DEVICE_MIX vazio → mix padrão (mobile-heavy) com tamanho = CONCURRENCY
 * - DEVICE_MIX setado → soma do mix manda; se proxy capar (`maxWorkers`), trunca
 *
 * @returns {{ types: string[], fromMix: boolean, slots: { type: string, country: string }[] }}
 */
function assignDeviceTypes({
  workerSlotsRaw,
  deviceMixRaw,
  concurrency,
  maxWorkers,
  logger,
}) {
  const parsedSlots = parseWorkerSlots(workerSlotsRaw);
  if (parsedSlots.length) {
    let slots = parsedSlots;
    const cap = maxWorkers != null ? maxWorkers : slots.length;
    if (slots.length > cap) {
      const before = slots.length;
      slots = slots.slice(0, cap);
      if (logger) {
        logger.warn(
          `WORKER_SLOTS=${before} workers reduzido para ${slots.length} (cap=${cap}).`
        );
      }
    }
    return {
      types: slots.map((s) => s.type),
      fromMix: true,
      slots,
    };
  }

  const entries = parseDeviceMixRaw(deviceMixRaw);
  let types;

  if (!entries.length) {
    types = defaultDeviceTypes(concurrency);
    if (logger) {
      const summary = summarizeDevices(types);
      const label = Object.entries(summary)
        .map(([k, v]) => `${k}:${v}`)
        .join(',');
      logger.info(`DEVICE_MIX vazio — usando mix padrão {${label}}`);
    }
  } else {
    types = expandMix(entries);
  }

  const cap = maxWorkers != null ? maxWorkers : types.length;

  if (types.length > cap) {
    const before = types.length;
    types = truncateProportional(types, cap);
    if (logger) {
      logger.warn(
        `DEVICE_MIX=${before} workers reduzido para ${types.length} (cap=${cap}).`
      );
    }
  }

  return {
    types,
    fromMix: Boolean(entries.length),
    slots: types.map((type) => ({ type, country: '' })),
  };
}

function summarizeDevices(types) {
  const summary = {};
  for (const t of types) {
    summary[t] = (summary[t] || 0) + 1;
  }
  return summary;
}

/**
 * Escolhe viewport + UA coerentes com o perfil (troca a cada sessão/aba).
 */
function pickSessionPersona(profile) {
  if (!profile) {
    throw new Error('device profile ausente');
  }
  const vp = pick(profile.viewports);
  const userAgent = pick(profile.userAgents);
  return {
    viewport: {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: vp.deviceScaleFactor || 1,
      isMobile: Boolean(profile.isMobile),
      hasTouch: Boolean(profile.hasTouch),
    },
    userAgent,
    isMobile: Boolean(profile.isMobile),
    hasTouch: Boolean(profile.hasTouch),
  };
}

function getProfile(deviceProfiles, deviceType) {
  const type = DEVICE_TYPES.includes(deviceType) ? deviceType : DEFAULT_TYPE;
  const profile = deviceProfiles?.[type];
  if (!profile) {
    throw new Error(`Perfil de device desconhecido: ${type}`);
  }
  return { type, profile };
}

module.exports = {
  DEVICE_TYPES,
  DEFAULT_TYPE,
  parseWorkerSlots,
  serializeWorkerSlots,
  parseDeviceMixRaw,
  defaultDeviceTypes,
  assignDeviceTypes,
  summarizeDevices,
  pickSessionPersona,
  getProfile,
};
