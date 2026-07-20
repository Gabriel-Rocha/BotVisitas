const TOKEN_KEY = 'bv_dashboard_token';

function headers(json = false) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  const token = localStorage.getItem(TOKEN_KEY) || '';
  if (token) h['X-Dashboard-Token'] = token;
  return h;
}

export function setDashboardToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getDashboardToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export async function fetchStatus() {
  const res = await fetch('/api/status', { headers: headers() });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export async function fetchConfig() {
  const res = await fetch('/api/config', { headers: headers() });
  if (!res.ok) throw new Error(`config ${res.status}`);
  return res.json();
}

export async function saveConfig(body) {
  const res = await fetch('/api/config', {
    method: 'PUT',
    headers: headers(true),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `save ${res.status}`);
  return data;
}

export async function botAction(action) {
  const res = await fetch(`/api/bot/${action}`, {
    method: 'POST',
    headers: headers(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${action} ${res.status}`);
  return data;
}

export function openLogStream(onEvent) {
  const token = getDashboardToken();
  const url = token
    ? `/api/logs/stream?token=${encodeURIComponent(token)}`
    : '/api/logs/stream';
  // EventSource cannot set custom headers — token via query only as fallback;
  // primary auth uses header on other routes. For SSE we also accept query in server.
  const es = new EventSource(url);
  es.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data));
    } catch {
      // ignore
    }
  };
  return () => es.close();
}
