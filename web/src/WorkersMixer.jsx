import { useEffect, useRef, useState } from 'react';

const MAX_WORKERS = 40;
const DEFAULT_GEOS = ['au', 'de', 'us'];

export function parseDeviceMix(raw, concurrencyFallback = 1) {
  const text = String(raw || '').trim();
  const counts = { desktop: 0, mobile: 0, tablet: 0 };
  if (!text) {
    const n = Math.max(0, Number.parseInt(concurrencyFallback, 10) || 0);
    counts.desktop = Math.min(MAX_WORKERS, n);
    return counts;
  }
  for (const part of text.split(',')) {
    const m = part.trim().match(/^(desktop|mobile|tablet)\s*:\s*(\d+)$/i);
    if (!m) continue;
    const type = m[1].toLowerCase();
    const n = Number.parseInt(m[2], 10);
    if (Number.isFinite(n) && n > 0) counts[type] = (counts[type] || 0) + n;
  }
  return counts;
}

export function parseWorkerSlots(raw) {
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

export function serializeWorkerSlots(slots) {
  return (slots || [])
    .map((slot) => {
      const type = ['desktop', 'mobile', 'tablet'].includes(slot.type)
        ? slot.type
        : 'mobile';
      const cc = String(slot.country || '')
        .trim()
        .toLowerCase();
      return cc && /^[a-z]{2}$/.test(cc) ? `${type}:${cc}` : type;
    })
    .join(',');
}

function parseCountries(raw) {
  return String(raw || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z]{2}$/.test(s));
}

export function slotsFromConfig(config) {
  const parsed = parseWorkerSlots(config?.WORKER_SLOTS);
  if (parsed.length) {
    return parsed.map((slot, i) => ({
      type: slot.type,
      country: slot.country || DEFAULT_GEOS[i % DEFAULT_GEOS.length],
    }));
  }
  const counts = parseDeviceMix(config?.DEVICE_MIX, config?.CONCURRENCY);
  const types = [];
  for (const type of ['desktop', 'mobile', 'tablet']) {
    for (let i = 0; i < (counts[type] || 0); i += 1) types.push(type);
  }
  const geos = parseCountries(config?.PROXY_COUNTRIES);
  const cycle = geos.length ? geos : DEFAULT_GEOS;
  return types.map((type, i) => ({
    type,
    country: cycle[i % cycle.length],
  }));
}

export function slotsToPatch(slots) {
  const counts = { desktop: 0, mobile: 0, tablet: 0 };
  for (const slot of slots) {
    counts[slot.type] = (counts[slot.type] || 0) + 1;
  }
  const mix = ['desktop', 'mobile', 'tablet']
    .filter((type) => counts[type] > 0)
    .map((type) => `${type}:${counts[type]}`)
    .join(',');
  const n = Math.max(0, slots.length);
  return {
    WORKER_SLOTS: serializeWorkerSlots(slots),
    DEVICE_MIX: mix,
    CONCURRENCY: String(Math.max(1, n)),
    PROXY_MAX: String(Math.max(1, n)),
    PROXY_COUNTRIES: slots.map((slot) => slot.country).filter(Boolean).join(','),
  };
}

function pickDevice(slots) {
  const mobile = slots.filter((s) => s.type === 'mobile').length;
  const desktop = slots.filter((s) => s.type === 'desktop').length;
  return mobile <= desktop ? 'mobile' : 'desktop';
}

function pickCountry(slots, pool) {
  const geos = pool.length ? pool : DEFAULT_GEOS;
  if (geos.length === 1) return geos[0];
  const last = slots[slots.length - 1]?.country;
  const choices = last && geos.length > 1 ? geos.filter((cc) => cc !== last) : geos;
  return choices[Math.floor(Math.random() * choices.length)];
}

/**
 * Painel mínimo: Adicionar / Remover. VPN sorteada; device equilibra mobile/desktop.
 */
export default function WorkersMixer({
  config,
  onChange,
  onPersist,
  busy = false,
}) {
  const [slots, setSlots] = useState(() => slotsFromConfig(config));
  const dirtyRef = useRef(false);
  const persistChain = useRef(Promise.resolve());

  const remoteKey = [
    config?.WORKER_SLOTS,
    config?.DEVICE_MIX,
    config?.PROXY_COUNTRIES,
    config?.CONCURRENCY,
  ].join('|');

  useEffect(() => {
    if (dirtyRef.current) return;
    setSlots(slotsFromConfig(config));
  }, [remoteKey, config]);

  const geoPool = parseCountries(config?.PROXY_COUNTRIES);

  function emit(nextSlots) {
    dirtyRef.current = true;
    setSlots(nextSlots);
    const patch = slotsToPatch(nextSlots);
    onChange?.(patch);
    if (onPersist) {
      persistChain.current = persistChain.current
        .then(() => onPersist(patch))
        .catch(() => {});
    }
  }

  function addWorker() {
    if (slots.length >= MAX_WORKERS) return;
    emit([
      ...slots,
      {
        type: pickDevice(slots),
        country: pickCountry(slots, geoPool),
      },
    ]);
  }

  function removeWorker() {
    if (!slots.length) return;
    emit(slots.slice(0, -1));
  }

  const mobile = slots.filter((s) => s.type === 'mobile').length;
  const desktop = slots.filter((s) => s.type === 'desktop').length;
  const tablet = slots.filter((s) => s.type === 'tablet').length;

  return (
    <div className="workers-panel">
      <div className="workers-panel-head">
        <div>
          <h2>Workers</h2>
          <p className="muted">
            Adiciona ou tira um worker. A VPN (país) é sorteada. Vale no próximo
            Start/Restart.
          </p>
        </div>
        <div className={`workers-total ${slots.length >= MAX_WORKERS ? 'at-cap' : ''}`}>
          <span className="workers-total-num">{slots.length}</span>
          <span className="muted">/ {MAX_WORKERS}</span>
        </div>
      </div>

      <div className="workers-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || slots.length >= MAX_WORKERS}
          onClick={addWorker}
        >
          Adicionar worker
        </button>
        <button
          type="button"
          disabled={busy || slots.length === 0}
          onClick={removeWorker}
        >
          Remover worker
        </button>
      </div>

      <p className="muted workers-summary">
        {slots.length
          ? [
              mobile ? `${mobile} mobile` : null,
              desktop ? `${desktop} desktop` : null,
              tablet ? `${tablet} tablet` : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : 'Nenhum worker. Clique em Adicionar.'}
      </p>
    </div>
  );
}
