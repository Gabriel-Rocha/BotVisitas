import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchWorkerPreview } from './api.js';
import DeviceFilterTabs, { filterWorkersByDevice } from './DeviceFilterTabs.jsx';

const PREVIEW_BATCH = 2;
const PREVIEW_FETCH_TIMEOUT_MS = 20_000;

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index;
      index += 1;
      results[i] = await fn(items[i], i);
    }
  }

  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function previewIntervalMs(count) {
  return Math.min(30_000, Math.max(8_000, 6_000 + count * 1_500));
}

export default function CapturesPanel({ status, deviceFilter: lockedFilter = null }) {
  const workers = status.stats?.workers || [];
  const workerIds = workers.map((worker) => worker.workerId).join(',');
  const [deviceFilter, setDeviceFilter] = useState(lockedFilter || 'mobile');
  const activeFilter = lockedFilter || deviceFilter;
  const visibleWorkers = useMemo(
    () => filterWorkersByDevice(workers, activeFilter),
    [workers, activeFilter]
  );

  const [previews, setPreviews] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const objectUrls = useRef(new Set());
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    if (!status.running || status.strategy === 'dryRun' || !workers.length) return;

    const targets = filterWorkersByDevice(workers, activeFilter);
    if (!targets.length) return;

    refreshInFlight.current = true;
    setRefreshing(true);

    try {
      await mapPool(targets, PREVIEW_BATCH, async (worker) => {
        try {
          const result = await fetchWorkerPreview(worker.workerId, PREVIEW_FETCH_TIMEOUT_MS);
          const imageUrl = URL.createObjectURL(result.blob);
          objectUrls.current.add(imageUrl);
          setPreviews((current) => {
            const previous = current[worker.workerId]?.imageUrl;
            if (previous) {
              URL.revokeObjectURL(previous);
              objectUrls.current.delete(previous);
            }
            return {
              ...current,
              [worker.workerId]: {
                imageUrl,
                capturedAt: result.capturedAt || new Date().toISOString(),
                error: '',
              },
            };
          });
        } catch (err) {
          setPreviews((current) => ({
            ...current,
            [worker.workerId]: {
              ...current[worker.workerId],
              error: err.message,
            },
          }));
        }
      });
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [status.running, status.strategy, workerIds, activeFilter, workers]);

  useEffect(() => {
    refresh();
    const intervalMs = previewIntervalMs(visibleWorkers.length || 1);
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, visibleWorkers.length]);

  useEffect(
    () => () => {
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      objectUrls.current.clear();
    },
    []
  );

  if (!status.running) {
    return <p className="muted">Inicie o bot para visualizar as páginas.</p>;
  }
  if (status.strategy === 'dryRun') {
    return <p className="muted">A estratégia dryRun não abre um navegador.</p>;
  }
  if (!workers.length) {
    return <p className="muted">Aguardando os workers iniciarem…</p>;
  }

  const title =
    activeFilter === 'mobile'
      ? 'Visualização — Mobile'
      : activeFilter === 'desktop'
        ? 'Visualização — Desktop'
        : activeFilter === 'tablet'
          ? 'Visualização — Tablet'
          : 'Visualização — Todos';

  const intervalSec = Math.round(previewIntervalMs(visibleWorkers.length || 1) / 1000);

  return (
    <section className="panel preview-panel">
      <div className="preview-header">
        <div>
          <h2>{title}</h2>
          <p className="muted">
            Capturas em lotes de {PREVIEW_BATCH} (aba ativa), a cada ~{intervalSec}s — evita
            travar com muitos workers.
          </p>
        </div>
        <button type="button" disabled={refreshing} onClick={refresh}>
          {refreshing ? 'Capturando…' : 'Atualizar agora'}
        </button>
      </div>

      {!lockedFilter ? (
        <DeviceFilterTabs
          workers={workers}
          value={deviceFilter}
          onChange={setDeviceFilter}
          showAll
        />
      ) : null}

      {!visibleWorkers.length ? (
        <p className="muted">
          Nenhum worker {activeFilter === 'all' ? '' : activeFilter} ativo nesta aba.
        </p>
      ) : (
        <div
          className={`preview-grid ${activeFilter === 'mobile' || activeFilter === 'tablet' ? 'preview-grid-mobile' : ''}`}
        >
          {visibleWorkers.map((worker) => {
            const preview = previews[worker.workerId] || {};
            const dtype = worker.deviceType || 'desktop';
            return (
              <article className={`preview-card preview-card-${dtype}`} key={worker.workerId}>
                <div className="preview-card-head">
                  <strong>w{worker.workerId}</strong>
                  <span className={`device-badge device-${dtype}`}>{dtype}</span>
                </div>

                <div className={`preview-frame preview-frame-${dtype}`}>
                  {preview.imageUrl ? (
                    <img
                      src={preview.imageUrl}
                      alt={`Página atual do worker ${worker.workerId}`}
                      loading="lazy"
                    />
                  ) : (
                    <span className="muted">Aguardando primeira captura…</span>
                  )}
                </div>

                <div className="preview-meta">
                  <strong>{worker.pageTitle || 'Página sem título'}</strong>
                  <a href={worker.currentUrl || undefined} target="_blank" rel="noreferrer">
                    {worker.currentUrl || 'URL ainda indisponível'}
                  </a>
                  <span className="muted">
                    {preview.capturedAt
                      ? `Capturado em ${new Date(preview.capturedAt).toLocaleString()}`
                      : 'Ainda não capturado'}
                  </span>
                  {preview.error ? (
                    <span className="preview-error">{preview.error}</span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
