import { useCallback, useEffect, useState } from 'react';
import { fetchMetrics } from './api.js';

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function formatUptime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
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

function ratePerHour(count, uptimeSec) {
  if (!uptimeSec || uptimeSec < 1) return 0;
  return Math.round((count / uptimeSec) * 3600 * 10) / 10;
}

function Bar({ value, max, tone = 'ok' }) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="indicator-bar-track">
      <div
        className={`indicator-bar-fill tone-${tone}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export default function MetricsPanel({ status }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMetrics();
      setSummary(data);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [refresh]);

  const stats = status.stats || {
    ok: 0,
    errors: 0,
    iterations: 0,
    uptimeSec: 0,
    workers: [],
    devices: {},
  };
  const workers = stats.workers || [];
  const liveTotal = (stats.ok || 0) + (stats.errors || 0);
  const successRate = pct(stats.ok || 0, liveTotal);
  const errorRate = pct(stats.errors || 0, liveTotal);
  const throughput = ratePerHour(stats.ok || 0, stats.uptimeSec || 0);
  const maxWorkerOk = Math.max(1, ...workers.map((w) => w.ok || 0));
  const devices = stats.devices || {};
  const deviceTotal = Object.values(devices).reduce((s, n) => s + n, 0) || 1;

  const hist = summary?.totals;
  const histTotal = hist ? hist.ok + hist.errors : 0;
  const histSuccess = hist ? pct(hist.ok, histTotal) : 0;
  const day = summary?.last24h;
  const dayTotal = day ? day.ok + day.errors : 0;

  return (
    <div className="metrics-page">
      <section className="panel metrics-intro">
        <div className="preview-header">
          <div>
            <h2>Indicadores</h2>
            <p className="muted">
              Sessão ao vivo + agregados do histórico Postgres.
            </p>
          </div>
          <button type="button" disabled={loading} onClick={refresh}>
            {loading ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
      </section>

      <div className="grid metrics-grid">
        <div className="metric">
          <div className="label">Taxa de sucesso</div>
          <div className="value">{successRate}%</div>
        </div>
        <div className="metric">
          <div className="label">Taxa de erro</div>
          <div className="value">{errorRate}%</div>
        </div>
        <div className="metric">
          <div className="label">OK / hora</div>
          <div className="value">{throughput}</div>
        </div>
        <div className="metric">
          <div className="label">Uptime</div>
          <div className="value value-sm">{formatUptime(stats.uptimeSec)}</div>
        </div>
        <div className="metric">
          <div className="label">Workers</div>
          <div className="value">{workers.length}</div>
        </div>
        <div className="metric">
          <div className="label">Targets</div>
          <div className="value">{status.targetUrls?.length || 0}</div>
        </div>
        <div className="metric">
          <div className="label">Proxy pool</div>
          <div className="value">{status.proxyEnabled ? status.proxyPoolSize || 0 : 0}</div>
        </div>
        <div className="metric">
          <div className="label">Iterações</div>
          <div className="value">{stats.iterations || 0}</div>
        </div>
      </div>

      <div className="panels">
        <section className="panel">
          <h2>Sessão atual</h2>
          <ul className="indicator-list">
            <li>
              <span>Status</span>
              <strong>{status.running ? 'running' : 'stopped'}</strong>
            </li>
            <li>
              <span>Strategy</span>
              <strong>{status.strategy}</strong>
            </li>
            <li>
              <span>Headless</span>
              <strong>{String(status.headless)}</strong>
            </li>
            <li>
              <span>Fonte dos links</span>
              <strong>{status.targetSource || 'none'}</strong>
            </li>
            <li>
              <span>Run ID</span>
              <code className="indicator-code">{status.runId || '—'}</code>
            </li>
          </ul>
        </section>

        <section className="panel">
          <h2>Devices</h2>
          {Object.keys(devices).length ? (
            <div className="device-bars">
              {Object.entries(devices).map(([type, count]) => (
                <div key={type} className="device-bar-row">
                  <div className="device-bar-label">
                    <span className={`device-badge device-${type}`}>{type}</span>
                    <span>{count}</span>
                  </div>
                  <Bar value={count} max={deviceTotal} tone="cyan" />
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Sem mix ativo nesta sessão.</p>
          )}
        </section>

        <section className="panel full">
          <h2>Workers — desempenho</h2>
          {workers.length ? (
            <div className="worker-bars">
              {workers.map((w) => {
                const total = (w.ok || 0) + (w.errors || 0);
                return (
                  <div key={w.workerId} className="worker-bar-row">
                    <div className="worker-bar-meta">
                      <strong>w{w.workerId}</strong>
                      <span className={`device-badge device-${w.deviceType || 'desktop'}`}>
                        {w.deviceType || 'desktop'}
                      </span>
                      <span className="muted">
                        ok={w.ok} · err={w.errors} · {pct(w.ok || 0, total)}%
                      </span>
                    </div>
                    <Bar value={w.ok || 0} max={maxWorkerOk} tone="ok" />
                    {w.currentUrl ? (
                      <a
                        className="worker-url"
                        href={w.currentUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {w.currentUrl}
                      </a>
                    ) : (
                      <span className="muted worker-url">URL indisponível</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">Inicie o bot para ver indicadores por worker.</p>
          )}
        </section>

        <section className="panel">
          <h2>Histórico (total)</h2>
          {!summary?.available ? (
            <p className="muted">Postgres indisponível — só métricas ao vivo.</p>
          ) : (
            <ul className="indicator-list">
              <li>
                <span>Runs</span>
                <strong>{hist.runs}</strong>
              </li>
              <li>
                <span>OK acumulado</span>
                <strong>{hist.ok}</strong>
              </li>
              <li>
                <span>Erros acumulados</span>
                <strong>{hist.errors}</strong>
              </li>
              <li>
                <span>Sucesso histórico</span>
                <strong>{histSuccess}%</strong>
              </li>
              <li>
                <span>Média iterações/run</span>
                <strong>{hist.avgIterations}</strong>
              </li>
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Últimas 24h</h2>
          {!summary?.available || !day ? (
            <p className="muted">Sem dados de período.</p>
          ) : (
            <ul className="indicator-list">
              <li>
                <span>Runs</span>
                <strong>{day.runs}</strong>
              </li>
              <li>
                <span>OK</span>
                <strong>{day.ok}</strong>
              </li>
              <li>
                <span>Erros</span>
                <strong>{day.errors}</strong>
              </li>
              <li>
                <span>Sucesso 24h</span>
                <strong>{pct(day.ok, dayTotal)}%</strong>
              </li>
              <li>
                <span>Por status</span>
                <strong>
                  {Object.entries(summary.byStatus || {})
                    .map(([k, v]) => `${k}:${v}`)
                    .join(' · ') || '—'}
                </strong>
              </li>
            </ul>
          )}
        </section>

        <section className="panel full">
          <h2>Runs recentes</h2>
          {summary?.recent?.length ? (
            <table>
              <thead>
                <tr>
                  <th>Início</th>
                  <th>Status</th>
                  <th>Strategy</th>
                  <th>OK</th>
                  <th>Err</th>
                  <th>Iter</th>
                  <th>Sucesso</th>
                </tr>
              </thead>
              <tbody>
                {summary.recent.map((run) => {
                  const total = (run.ok_total || 0) + (run.errors_total || 0);
                  return (
                    <tr key={run.id}>
                      <td>{formatTs(run.started_at)}</td>
                      <td>
                        <span className={`run-status status-${run.status}`}>
                          {run.status}
                        </span>
                      </td>
                      <td>{run.strategy}</td>
                      <td>{run.ok_total}</td>
                      <td>{run.errors_total}</td>
                      <td>{run.iterations_total}</td>
                      <td>{pct(run.ok_total || 0, total)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="muted">Nenhum run no histórico ainda.</p>
          )}
        </section>
      </div>
    </div>
  );
}
