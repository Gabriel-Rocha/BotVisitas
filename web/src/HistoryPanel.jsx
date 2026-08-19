import { useCallback, useEffect, useState } from 'react';
import {
  fetchRun,
  fetchRunLogs,
  fetchRunSnapshots,
  fetchRuns,
} from './api.js';

function formatDuration(start, end) {
  if (!start) return '—';
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  const sec = Math.max(0, Math.round((b - a) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatTs(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function HistoryPanel({ refreshKey = 0, onReuseTargets }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [logs, setLogs] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchRuns({
        limit: 25,
        offset: 0,
        status: filter || undefined,
      });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadList();
  }, [loadList, refreshKey]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setLogs([]);
      setSnapshots([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [runRes, logsRes, snapsRes] = await Promise.all([
          fetchRun(selectedId),
          fetchRunLogs(selectedId, { limit: 150 }),
          fetchRunSnapshots(selectedId, { limit: 200 }),
        ]);
        if (cancelled) return;
        setDetail(runRes.run);
        setLogs(logsRes.items || []);
        setSnapshots(snapsRes.items || []);
        setError('');
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, refreshKey]);

  const lastSnap = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const workers = lastSnap?.payload?.stats?.workers || [];

  const maxOk = Math.max(1, ...snapshots.map((s) => s.payload?.stats?.ok || 0));
  const maxErr = Math.max(
    1,
    ...snapshots.map((s) => s.payload?.stats?.errors || 0)
  );

  return (
    <section className="panel full history-panel">
      <div className="history-header">
        <h2>Histórico</h2>
        <div className="history-toolbar">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filtrar status"
          >
            <option value="">todos</option>
            <option value="running">running</option>
            <option value="stopped">stopped</option>
            <option value="error">error</option>
            <option value="crashed">crashed</option>
          </select>
          <button type="button" disabled={loading} onClick={loadList}>
            Atualizar
          </button>
        </div>
      </div>

      <p className="muted">
        Execuções persistidas no Postgres. Total: {total}
        {loading ? ' · carregando…' : ''}
      </p>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="history-layout">
        <div className="history-list">
          {items.length ? (
            <table>
              <thead>
                <tr>
                  <th>Início</th>
                  <th>Status</th>
                  <th>Strategy</th>
                  <th>OK</th>
                  <th>Err</th>
                  <th>Dur.</th>
                </tr>
              </thead>
              <tbody>
                {items.map((run) => (
                  <tr
                    key={run.id}
                    className={selectedId === run.id ? 'selected' : ''}
                    onClick={() => setSelectedId(run.id)}
                  >
                    <td>{formatTs(run.started_at)}</td>
                    <td>
                      <span className={`run-status status-${run.status}`}>
                        {run.status}
                      </span>
                    </td>
                    <td>{run.strategy}</td>
                    <td>{run.ok_total}</td>
                    <td>{run.errors_total}</td>
                    <td>{formatDuration(run.started_at, run.ended_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Nenhuma execução salva ainda.</p>
          )}
        </div>

        <div className="history-detail">
          {detail ? (
            <>
              <h3>Detalhe</h3>
              <p className="muted">
                <code>{detail.id}</code>
              </p>
              <ul className="history-meta">
                <li>
                  <strong>Status:</strong> {detail.status}
                </li>
                <li>
                  <strong>Strategy:</strong> {detail.strategy}
                </li>
                <li>
                  <strong>Concorrência:</strong> {detail.concurrency ?? '—'}
                </li>
                <li>
                  <strong>Proxy:</strong> {detail.proxy_enabled ? 'on' : 'off'}
                </li>
                <li>
                  <strong>Targets ({detail.target_source}):</strong>{' '}
                  {(detail.target_urls || []).join(' · ') || '(nenhum)'}
                </li>
                <li>
                  <strong>Totais:</strong> ok={detail.ok_total} · err=
                  {detail.errors_total} · iter={detail.iterations_total}
                </li>
                {detail.error_message ? (
                  <li className="error-banner">{detail.error_message}</li>
                ) : null}
              </ul>

              {typeof onReuseTargets === 'function' &&
              detail.target_urls?.length ? (
                <button
                  type="button"
                  onClick={() => onReuseTargets(detail.target_urls)}
                >
                  Copiar targets para o painel
                </button>
              ) : null}

              {workers.length ? (
                <>
                  <h3>Workers (último snapshot)</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Device</th>
                        <th>Proxy</th>
                        <th>OK</th>
                        <th>Err</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workers.map((w) => (
                        <tr key={w.workerId}>
                          <td>w{w.workerId}</td>
                          <td>{w.deviceType || 'desktop'}</td>
                          <td>{w.proxyLabel || '—'}</td>
                          <td>{w.ok}</td>
                          <td>{w.errors}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}

              {snapshots.length ? (
                <>
                  <h3>Evolução (snapshots)</h3>
                  <div className="sparkline">
                    {snapshots.map((s) => {
                      const ok = s.payload?.stats?.ok || 0;
                      const err = s.payload?.stats?.errors || 0;
                      return (
                        <div key={s.id} className="spark-col" title={formatTs(s.captured_at)}>
                          <div
                            className="spark-ok"
                            style={{ height: `${Math.round((ok / maxOk) * 48)}px` }}
                          />
                          <div
                            className="spark-err"
                            style={{ height: `${Math.round((err / maxErr) * 48)}px` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <p className="muted">
                    {snapshots.length} amostras · verde=ok · vermelho=errors
                  </p>
                </>
              ) : null}

              <h3>Logs do run</h3>
              <div className="logs history-logs">
                {logs.length ? (
                  [...logs].reverse().map((line) => (
                    <div
                      key={line.id}
                      className={`line level-${line.level}`}
                    >
                      [{formatTs(line.ts)}] [{line.level}] {line.message}
                    </div>
                  ))
                ) : (
                  <p className="muted">Sem logs gravados para este run.</p>
                )}
              </div>
            </>
          ) : (
            <p className="muted">Selecione uma execução na lista.</p>
          )}
        </div>
      </div>
    </section>
  );
}
