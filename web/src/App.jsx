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
import CapturesPanel from './CapturesPanel.jsx';
import ConfigPanel from './ConfigPanel.jsx';
import HistoryPanel from './HistoryPanel.jsx';
import MetricsPanel from './MetricsPanel.jsx';
import WorkersMixer from './WorkersMixer.jsx';

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
    tuxlerEnabled: true,
    proxyLabels: [],
    stats: emptyMetrics,
  });
  const [config, setConfig] = useState(null);
  const [targetLinks, setTargetLinks] = useState('');
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tokenInput, setTokenInput] = useState(getDashboardToken());
  const [historyKey, setHistoryKey] = useState(0);
  const [activeTab, setActiveTab] = useState('operation');
  const [followLogs, setFollowLogs] = useState(false);
  const logsBox = useRef(null);
  const pageScrollY = useRef(0);
  const configRef = useRef(null);
  const configDirtyRef = useRef(false);
  configRef.current = config;

  const refresh = useCallback(async ({ includeConfig = true } = {}) => {
    try {
      const s = await fetchStatus();
      setStatus(s);
      if (includeConfig && !configDirtyRef.current) {
        const c = await fetchConfig();
        setConfig(c);
      }
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(() => refresh({ includeConfig: false }), 2000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const close = openLogStream((entry) => {
      setLogs((prev) => [...prev.slice(-400), entry]);
    });
    return close;
  }, []);

  // Congela a posição da página: refresh de status/logs não pode puxar o viewport.
  useEffect(() => {
    const onScroll = () => {
      pageScrollY.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const y = pageScrollY.current;
    const restore = () => {
      if (Math.abs(window.scrollY - y) > 2) {
        window.scrollTo(0, y);
      }
    };
    restore();
    const id = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(id);
  }, [status, logs, config, historyKey]);

  // Auto-seguir logs: DESLIGADO por padrão. Só rola a caixa interna, nunca a página.
  useEffect(() => {
    if (!followLogs) return;
    const box = logsBox.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
  }, [logs, followLogs]);

  async function onAction(action) {
    setBusy(true);
    setError('');
    try {
      if (action !== 'stop') {
        const strategy = configRef.current?.STRATEGY || status.strategy;
        const urls = String(targetLinks || '')
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (strategy === 'directLink' && !urls.length) {
          throw new Error('Cole pelo menos um link de destino antes de iniciar.');
        }
      }
      const body =
        action === 'stop' ? undefined : { targetUrls: targetLinks };
      await botAction(action, body);
      await refresh();
      if (action === 'stop' || action === 'restart' || action === 'start') {
        setHistoryKey((k) => k + 1);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function buildConfigBody(source) {
    return {
      STRATEGY: source.STRATEGY,
      CONCURRENCY: source.CONCURRENCY,
      DEVICE_MIX: source.DEVICE_MIX,
      WORKER_SLOTS: source.WORKER_SLOTS || '',
      PROXY_COUNTRIES: source.PROXY_COUNTRIES || '',
      INTERVAL_MIN_SEC: source.INTERVAL_MIN_SEC,
      INTERVAL_MAX_SEC: source.INTERVAL_MAX_SEC,
      BROWSER_RESTART_EVERY: source.BROWSER_RESTART_EVERY,
      HEADLESS: source.HEADLESS,
      TUXLER_ENABLED: source.TUXLER_ENABLED,
      BROWSE_PAGES_MIN: source.BROWSE_PAGES_MIN,
      BROWSE_PAGES_MAX: source.BROWSE_PAGES_MAX,
      INCLUDE_REFERRER: source.INCLUDE_REFERRER,
      BANDWIDTH_SAVER: source.BANDWIDTH_SAVER,
    };
  }

  async function persistConfig(patch = {}) {
    const source = { ...(configRef.current || {}), ...patch };
    if (!source.STRATEGY) return;
    setBusy(true);
    setError('');
    try {
      const result = await saveConfig(buildConfigBody(source));
      configDirtyRef.current = false;
      setConfig(result.config);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveConfig(e) {
    e.preventDefault();
    await persistConfig();
  }

  function updateField(key, value) {
    configDirtyRef.current = true;
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function updateFields(patch) {
    configDirtyRef.current = true;
    setConfig((prev) => ({ ...prev, ...patch }));
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
          <p className="tagline">Console de operação — workers, Tuxler e logs</p>
        </div>
        <div className="status-pills">
          <div className="status-pill">
            <span className={`dot ${running ? 'on' : 'off'}`} />
            {running ? 'running' : 'stopped'}
          </div>
          {status.memory ? (
            <div
              className={`status-pill ram-pill level-${status.memory.level || 'ok'}`}
              title="RAM do PC (os.freemem). Custo ~0. Node RSS = processo dashboard, não os Chromiums."
            >
              RAM {Math.round((status.memory.usedPct || 0) * 100)}%
              <span className="ram-pill-detail">
                {(status.memory.usedMb / 1024).toFixed(1)}/
                {(status.memory.totalMb / 1024).toFixed(1)} GB
                {status.memory.nodeRssMb
                  ? ` · node ${status.memory.nodeRssMb} MB`
                  : ''}
              </span>
            </div>
          ) : null}
        </div>
      </header>

      <nav className="tabs" aria-label="Seções do dashboard">
        <button
          type="button"
          className={activeTab === 'operation' ? 'active' : ''}
          onClick={() => setActiveTab('operation')}
        >
          Operação
        </button>
        <button
          type="button"
          className={activeTab === 'metrics' ? 'active' : ''}
          onClick={() => setActiveTab('metrics')}
        >
          Indicadores
        </button>
        <button
          type="button"
          className={activeTab === 'config' ? 'active' : ''}
          onClick={() => setActiveTab('config')}
        >
          Config
        </button>
        <button
          type="button"
          className={activeTab === 'preview-mobile' ? 'active' : ''}
          onClick={() => setActiveTab('preview-mobile')}
        >
          Mobile
        </button>
        <button
          type="button"
          className={activeTab === 'preview-desktop' ? 'active' : ''}
          onClick={() => setActiveTab('preview-desktop')}
        >
          Desktop
        </button>
      </nav>

      {error ? <div className="error-banner">{error}</div> : null}

      {activeTab === 'operation' ? (
        <>
      <section className="panel target-links">
        <h2>Links de destino</h2>
        <p className="muted">
          Cole um link por linha (ou separados por vírgula). Os links valem só para
          esta execução — <strong>não são gravados no .env</strong>. O Start exige
          pelo menos um link quando <code>STRATEGY=directLink</code>.
        </p>
        <textarea
          className="links-area"
          rows={4}
          value={targetLinks}
          disabled={running}
          onChange={(e) => setTargetLinks(e.target.value)}
          placeholder={'https://seu-dominio.com/pagina\nhttps://seu-dominio.com/outra'}
        />
        <p className="muted">
          Em uso ({status.targetSource || 'none'}):{' '}
          {status.targetUrls && status.targetUrls.length
            ? status.targetUrls.join(' · ')
            : '(nenhum)'}
        </p>
      </section>

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
        <div className={`metric metric-ram level-${status.memory?.level || 'ok'}`}>
          <div className="label">RAM PC</div>
          <div className="value value-sm">
            {status.memory
              ? `${Math.round((status.memory.usedPct || 0) * 100)}%`
              : '—'}
          </div>
          {status.memory ? (
            <>
              <div className="indicator-bar-track ram-track">
                <div
                  className={`indicator-bar-fill tone-${status.memory.level || 'ok'}`}
                  style={{
                    width: `${Math.min(100, Math.round((status.memory.usedPct || 0) * 100))}%`,
                  }}
                />
              </div>
              <p className="muted ram-caption">
                {(status.memory.usedMb / 1024).toFixed(1)} /{' '}
                {(status.memory.totalMb / 1024).toFixed(1)} GB · livre{' '}
                {status.memory.freeMb} MB
                {typeof stats.browserRestarts === 'number'
                  ? ` · reciclagens ${stats.browserRestarts}`
                  : ''}
              </p>
            </>
          ) : null}
        </div>
      </div>

      <div className="panels">
        <section className="panel full">
          {config ? (
            <WorkersMixer
              config={config}
              onChange={updateFields}
              onPersist={persistConfig}
              liveWorkers={stats.workers || []}
              running={running}
              busy={busy}
            />
          ) : (
            <p className="muted">Carregando workers…</p>
          )}
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            strategy={status.strategy} · concurrency={status.concurrency} · tuxler=
            {status.tuxlerEnabled ? 'on' : 'off'}
            {stats.devices && Object.keys(stats.devices).length
              ? ` · devices=${Object.entries(stats.devices)
                  .map(([k, v]) => `${k}:${v}`)
                  .join(',')}`
              : ''}
          </p>
        </section>

        <section className="panel full">
          <div className="logs-header">
            <h2>Logs</h2>
            <label className="follow-logs">
              <input
                type="checkbox"
                checked={followLogs}
                onChange={(e) => setFollowLogs(e.target.checked)}
              />
              Seguir novos logs
            </label>
          </div>
          <div className="logs" ref={logsBox}>
            {logs.map((line, i) => (
              <div key={`${line.ts}-${i}`} className={`line level-${line.level}`}>
                [{line.ts}] [{line.level}] {line.message}
              </div>
            ))}
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

        <HistoryPanel
          refreshKey={historyKey}
          onReuseTargets={(urls) => setTargetLinks((urls || []).join('\n'))}
        />
      </div>
        </>
      ) : null}

      {activeTab === 'metrics' ? <MetricsPanel status={status} /> : null}

      {activeTab === 'config' ? (
        <ConfigPanel
          config={config}
          busy={busy}
          onChange={updateField}
          onSave={onSaveConfig}
        />
      ) : null}

      {activeTab === 'preview-mobile' ? (
        <CapturesPanel status={status} deviceFilter="mobile" />
      ) : null}

      {activeTab === 'preview-desktop' ? (
        <CapturesPanel status={status} deviceFilter="desktop" />
      ) : null}
    </div>
  );
}
