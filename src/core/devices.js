'use strict';

const { pick } = require('../utils/random');

const DEVICE_TYPES = ['desktop', 'mobile', 'tablet'];
const DEFAULT_TYPE = 'desktop';

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
 * Trunca mantendo proporção aproximada (amostra os primeiros N do array expandido
 * depois de intercalar por tipo para não perder uma categoria inteira).
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
 * - DEVICE_MIX vazio → `concurrency` workers todos desktop
 * - DEVICE_MIX setado → soma do mix manda; se proxy capar (`maxWorkers`), trunca
 *
 * @returns {{ types: string[], fromMix: boolean }}
 */
function assignDeviceTypes({ deviceMixRaw, concurrency, maxWorkers, logger }) {
  const entries = parseDeviceMixRaw(deviceMixRaw);
  let types;

  if (!entries.length) {
    const n = Math.max(1, concurrency || 1);
    types = Array.from({ length: n }, () => DEFAULT_TYPE);
    return { types, fromMix: false };
  }

  types = expandMix(entries);
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

  return { types, fromMix: true };
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
  parseDeviceMixRaw,
  assignDeviceTypes,
  summarizeDevices,
  pickSessionPersona,
  getProfile,
};
