export default function ConfigPanel({ config, busy, onChange, onSave }) {
  if (!config) {
    return (
      <section className="panel">
        <h2>Config</h2>
        <p className="muted">Carregando config…</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Config</h2>
      <p className="muted">
        Ajustes avançados. Não aparece na Operação. Aplicam no próximo
        Start/Restart.
      </p>
      <form className="form" onSubmit={onSave}>
        <div className="field">
          <label>STRATEGY</label>
          <select
            value={config.STRATEGY}
            onChange={(e) => onChange('STRATEGY', e.target.value)}
          >
            <option value="dryRun">dryRun</option>
            <option value="directLink">directLink</option>
          </select>
        </div>

        <div className="field">
          <label>BANDWIDTH_SAVER</label>
          <select
            value={config.BANDWIDTH_SAVER || 'light'}
            onChange={(e) => onChange('BANDWIDTH_SAVER', e.target.value)}
          >
            <option value="off">off (máx. qualidade)</option>
            <option value="light">light (recomendado)</option>
            <option value="aggressive">aggressive (economiza MB)</option>
          </select>
        </div>
        <div className="field">
          <label>INTERVAL_MIN_SEC</label>
          <input
            value={config.INTERVAL_MIN_SEC}
            onChange={(e) => onChange('INTERVAL_MIN_SEC', e.target.value)}
          />
        </div>
        <div className="field">
          <label>INTERVAL_MAX_SEC</label>
          <input
            value={config.INTERVAL_MAX_SEC}
            onChange={(e) => onChange('INTERVAL_MAX_SEC', e.target.value)}
          />
        </div>
        <div className="field">
          <label>BROWSER_RESTART_EVERY</label>
          <input
            value={config.BROWSER_RESTART_EVERY}
            onChange={(e) => onChange('BROWSER_RESTART_EVERY', e.target.value)}
          />
        </div>
        <div className="field">
          <label>HEADLESS</label>
          <select
            value={config.HEADLESS}
            onChange={(e) => onChange('HEADLESS', e.target.value)}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>
        <div className="field">
          <label>TUXLER_ENABLED (Windows)</label>
          <select
            value={config.TUXLER_ENABLED || 'false'}
            onChange={(e) => onChange('TUXLER_ENABLED', e.target.value)}
          >
            <option value="true">true (Tuxler residencial gratuito)</option>
            <option value="false">false</option>
          </select>
          <p className="muted">
            true = VPN Tuxler no Windows; PROXY_* pago é ignorado. 1 IP por vez; rotação por worker.
          </p>
        </div>
        <div className="field">
          <label>PROXY_ENABLED</label>
          <select
            value={config.PROXY_ENABLED}
            onChange={(e) => onChange('PROXY_ENABLED', e.target.value)}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>
        <div className="field">
          <label>BROWSE_PAGES_MIN</label>
          <input
            value={config.BROWSE_PAGES_MIN || '0'}
            onChange={(e) => onChange('BROWSE_PAGES_MIN', e.target.value)}
          />
        </div>
        <div className="field">
          <label>BROWSE_PAGES_MAX</label>
          <input
            value={config.BROWSE_PAGES_MAX || '0'}
            onChange={(e) => onChange('BROWSE_PAGES_MAX', e.target.value)}
          />
        </div>
        <div className="field">
          <label>INCLUDE_REFERRER</label>
          <select
            value={config.INCLUDE_REFERRER}
            onChange={(e) => onChange('INCLUDE_REFERRER', e.target.value)}
          >
            <option value="true">true (entrada via Google/Bing)</option>
            <option value="false">false (só header Referer)</option>
          </select>
          <p className="muted">
            true = warmup no buscador da geo. false = ainda envia Referer, sem visitar o Google.
          </p>
        </div>
        <p className="muted">{config.PROXY_LIST_MASKED}</p>
        <button type="submit" className="primary" disabled={busy}>
          Salvar no .env
        </button>
      </form>
    </section>
  );
}
