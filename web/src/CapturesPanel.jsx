import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchWorkerPreview } from './api.js';
import DeviceFilterTabs, { filterWorkersByDevice } from './DeviceFilterTabs.jsx';

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

  const refresh = useCallback(async () => {
    if (!status.running || status.strategy === 'dryRun' || !workers.length) return;
    setRefreshing(true);
    // Só captura os da aba ativa (menos carga no bot).
    const targets = filterWorkersByDevice(workers, activeFilter);
    await Promise.all(
      targets.map(async (worker) => {
        try {
          const result = await fetchWorkerPreview(worker.workerId);
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
      })
    );
    setRefreshing(false);
  }, [status.running, status.strategy, workerIds, activeFilter]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

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

  return (
    <section className="panel preview-panel">
      <div className="preview-header">
        <div>
          <h2>{title}</h2>
          <p className="muted">
            Capturas do viewport atual (só a aba ativa), a cada 5 segundos.
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
          {activeFilter === 'desktop'
            ? ' Desktop costuma levar “proxy detected” — prefira Mobile ou DEVICE_MIX só mobile.'
            : null}
        </p>
      ) : (
        <div className={`preview-grid ${activeFilter === 'mobile' || activeFilter === 'tablet' ? 'preview-grid-mobile' : ''}`}>
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
