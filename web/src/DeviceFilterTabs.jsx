import { useMemo, useState } from 'react';

const FILTERS = [
  { id: 'mobile', label: 'Mobile', match: (t) => t === 'mobile' },
  { id: 'desktop', label: 'Desktop', match: (t) => t === 'desktop' || !t },
  { id: 'tablet', label: 'Tablet', match: (t) => t === 'tablet' },
  { id: 'all', label: 'Todos', match: () => true },
];

export function deviceTypeOf(worker) {
  return worker?.deviceType || 'desktop';
}

export function filterWorkersByDevice(workers, filterId) {
  const filter = FILTERS.find((f) => f.id === filterId) || FILTERS[0];
  return (workers || []).filter((w) => filter.match(deviceTypeOf(w)));
}

export function countByDevice(workers) {
  const counts = { mobile: 0, desktop: 0, tablet: 0 };
  for (const w of workers || []) {
    const t = deviceTypeOf(w);
    if (t === 'mobile') counts.mobile += 1;
    else if (t === 'tablet') counts.tablet += 1;
    else counts.desktop += 1;
  }
  return counts;
}

/**
 * Abas Mobile / Desktop / Tablet / Todos para filtrar workers.
 */
export default function DeviceFilterTabs({
  workers = [],
  value,
  onChange,
  showAll = true,
  className = '',
}) {
  const counts = useMemo(() => countByDevice(workers), [workers]);
  const [internal, setInternal] = useState('mobile');
  const active = value ?? internal;

  function setFilter(id) {
    if (onChange) onChange(id);
    else setInternal(id);
  }

  const tabs = FILTERS.filter((f) => {
    if (f.id === 'all') return showAll;
    if (f.id === 'tablet') return counts.tablet > 0 || active === 'tablet';
    return true;
  });

  return (
    <div className={`device-filter-tabs ${className}`.trim()} role="tablist" aria-label="Filtrar por device">
      {tabs.map((tab) => {
        const count =
          tab.id === 'all'
            ? workers.length
            : tab.id === 'mobile'
              ? counts.mobile
              : tab.id === 'tablet'
                ? counts.tablet
                : counts.desktop;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            className={active === tab.id ? 'active' : ''}
            onClick={() => setFilter(tab.id)}
          >
            {tab.label}
            <span className="device-filter-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
