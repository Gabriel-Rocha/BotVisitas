import { useCallback, useEffect, useRef, useState } from 'react';
import {
  botAction,
  fetchConfig,
  fetchStatus,
  getDashboardToken,
  openLogStream,
  saveConfig,
  setDashboardToken,
} from './api.js';

const emptyMetrics = {
  ok: 0,
  errors: 0,
  iterations: 0,
  uptimeSec: 0,
  workers: [],
};

export default function App() {
  const [status, setStatus] = useState({
    running: false,
    strategy: 'dryRun',
    concurrency: 5,
    proxyEnabled: false,
    proxyLabels: [],
    stats: emptyMetrics,
  });
  const [config, setConfig] = useState(null);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tokenInput, setTokenInput] = useState(getDashboardToken());
  const logEnd = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([fetchStatus(), fetchConfig()]);
      setStatus(s);
      setConfig(c);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const close = openLogStream((entry) => {
      setLogs((prev) => [...prev.slice(-400), entry]);
    });
    return close;
  }, []);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  async function onAction(action) {
    setBusy(true);
    setError('');
    try {
      await botAction(action);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveConfig(e) {
    e.preventDefault();
    if (!config) return;
    setBusy(true);
    setError('');
    try {
      const body = {
        STRATEGY: config.STRATEGY,
        CONCURRENCY: config.CONCURRENCY,
        DEVICE_MIX: config.DEVICE_MIX,
        INTERVAL_MIN_SEC: config.INTERVAL_MIN_SEC,
        INTERVAL_MAX_SEC: config.INTERVAL_MAX_SEC,
        BROWSER_RESTART_EVERY: config.BROWSER_RESTART_EVERY,
        HEADLESS: config.HEADLESS,
        PROXY_ENABLED: config.PROXY_ENABLED,
        TARGET_URLS: config.TARGET_URLS,
        BROWSE_PAGES_MIN: config.BROWSE_PAGES_MIN,
        BROWSE_PAGES_MAX: config.BROWSE_PAGES_MAX,
        INCLUDE_REFERRER: config.INCLUDE_REFERRER,
      };
      const result = await saveConfig(body);
      setConfig(result.config);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function updateField(key, value) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  const stats = status.stats || emptyMetrics;
  const running = status.running;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1 className="brand">
            Bot<span>Visitas</span>
          </h1>
          <p className="tagline">Console de operação — workers, proxies e logs</p>
        </div>
        <div className="status-pill">
          <span className={`dot ${running ? 'on' : 'off'}`} />
          {running ? 'running' : 'stopped'}
        </div>
      </header>

      <div className="banner">
        <strong>Cláusula pétrea:</strong> use apenas contra infraestrutura que você
        controla (localhost, staging, domínio seu). Não aponte para smartlinks de ads
        de terceiros.
      </div>

      <div className="controls">
        <button
          className="primary"
          disabled={busy || running}
          onClick={() => onAction('start')}
        >
          Start
        </button>
        <button
          className="danger"
          disabled={busy || !running}
          onClick={() => onAction('stop')}
        >
          Stop
        </button>
        <button disabled={busy} onClick={() => onAction('restart')}>
          Restart
        </button>
        <button disabled={busy} onClick={refresh}>
          Refresh
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="grid">
        <div className="metric">
          <div className="label">OK</div>
          <div className="value">{stats.ok}</div>
        </div>
        <div className="metric">
          <div className="label">Errors</div>
          <div className="value">{stats.errors}</div>
        </div>
        <div className="metric">
          <div className="label">Iterations</div>
          <div className="value">{stats.iterations}</div>
        </div>
        <div className="metric">
          <div className="label">Uptime (s)</div>
          <div className="value">{stats.uptimeSec || 0}</div>
        </div>
      </div>

      <div className="panels">
        <section className="panel">
          <h2>Workers</h2>
          {stats.workers?.length ? (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Device</th>
                  <th>Proxy</th>
                  <th>OK</th>
                  <th>Err</th>
                  <th>Iter</th>
                </tr>
              </thead>
              <tbody>
                {stats.workers.map((w) => (
                  <tr key={w.workerId}>
                    <td>w{w.workerId}</td>
                    <td>
                      <span className={`device-badge device-${w.deviceType || 'desktop'}`}>
                        {w.deviceType || 'desktop'}
                      </span>
                    </td>
                    <td>{w.proxyLabel || '—'}</td>
                    <td>{w.ok}</td>
                    <td>{w.errors}</td>
                    <td>{w.iterations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Nenhum worker ativo. Inicie o bot.</p>
          )}
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            strategy={status.strategy} · concurrency={status.concurrency} · proxy=
            {status.proxyEnabled ? 'on' : 'off'} · pool=
            {status.proxyPoolSize ?? 0}
            {stats.devices && Object.keys(stats.devices).length
              ? ` · devices=${Object.entries(stats.devices)
                  .map(([k, v]) => `${k}:${v}`)
                  .join(',')}`
              : ''}
          </p>
        </section>

        <section className="panel">
          <h2>Config (segura)</h2>
          {config ? (
            <form className="form" onSubmit={onSaveConfig}>
              <div className="field">
                <label>STRATEGY</label>
                <select
                  value={config.STRATEGY}
                  onChange={(e) => updateField('STRATEGY', e.target.value)}
                >
                  <option value="dryRun">dryRun</option>
                  <option value="directLink">directLink</option>
                </select>
              </div>
              <div className="field">
                <label>CONCURRENCY</label>
                <input
                  value={config.CONCURRENCY}
                  onChange={(e) => updateField('CONCURRENCY', e.target.value)}
                />
              </div>
              <div className="field">
                <label>DEVICE_MIX</label>
                <input
                  value={config.DEVICE_MIX || ''}
                  onChange={(e) => updateField('DEVICE_MIX', e.target.value)}
                  placeholder="desktop:2,mobile:2,tablet:1"
                />
                <p className="muted">
                  Vazio = todos desktop (usa CONCURRENCY). Com mix, a soma manda.
                </p>
              </div>
              <div className="field">
                <label>INTERVAL_MIN_SEC</label>
                <input
                  value={config.INTERVAL_MIN_SEC}
                  onChange={(e) => updateField('INTERVAL_MIN_SEC', e.target.value)}
                />
              </div>
              <div className="field">
                <label>INTERVAL_MAX_SEC</label>
                <input
                  value={config.INTERVAL_MAX_SEC}
                  onChange={(e) => updateField('INTERVAL_MAX_SEC', e.target.value)}
                />
              </div>
              <div className="field">
                <label>BROWSER_RESTART_EVERY</label>
                <input
                  value={config.BROWSER_RESTART_EVERY}
                  onChange={(e) =>
                    updateField('BROWSER_RESTART_EVERY', e.target.value)
                  }
                />
              </div>
              <div className="field">
                <label>HEADLESS</label>
                <select
                  value={config.HEADLESS}
                  onChange={(e) => updateField('HEADLESS', e.target.value)}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </div>
              <div className="field">
                <label>PROXY_ENABLED</label>
                <select
                  value={config.PROXY_ENABLED}
                  onChange={(e) => updateField('PROXY_ENABLED', e.target.value)}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </div>
              <div className="field">
                <label>TARGET_URLS</label>
                <input
                  value={config.TARGET_URLS}
                  onChange={(e) => updateField('TARGET_URLS', e.target.value)}
                  placeholder="só infra sua — salve ou edite o .env e dê Start"
                />
                <p className="muted">
                  O worker entra no link e navega páginas internas do mesmo domínio.
                </p>
              </div>
              <div className="field">
                <label>BROWSE_PAGES_MIN</label>
                <input
                  value={config.BROWSE_PAGES_MIN || '1'}
                  onChange={(e) => updateField('BROWSE_PAGES_MIN', e.target.value)}
                />
              </div>
              <div className="field">
                <label>BROWSE_PAGES_MAX</label>
                <input
                  value={config.BROWSE_PAGES_MAX || '3'}
                  onChange={(e) => updateField('BROWSE_PAGES_MAX', e.target.value)}
                />
              </div>
              <div className="field">
                <label>INCLUDE_REFERRER</label>
                <select
                  value={config.INCLUDE_REFERRER}
                  onChange={(e) => updateField('INCLUDE_REFERRER', e.target.value)}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </div>
              <p className="muted">{config.PROXY_LIST_MASKED}</p>
              <button type="submit" className="primary" disabled={busy}>
                Salvar no .env
              </button>
              <p className="muted">
                Alterações de config aplicam no próximo Start/Restart.
              </p>
            </form>
          ) : (
            <p className="muted">Carregando config…</p>
          )}
        </section>

        <section className="panel full">
          <h2>Logs</h2>
          <div className="logs">
            {logs.map((line, i) => (
              <div key={`${line.ts}-${i}`} className={`line level-${line.level}`}>
                [{line.ts}] [{line.level}] {line.message}
              </div>
            ))}
            <div ref={logEnd} />
          </div>
          <div className="token-row">
            <input
              type="password"
              placeholder="DASHBOARD_TOKEN (se configurado)"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />
            <button
              type="button"
              onClick={() => {
                setDashboardToken(tokenInput.trim());
                refresh();
              }}
            >
              Salvar token
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
