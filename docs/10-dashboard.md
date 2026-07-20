# Dashboard UI — BotVisitas

Painel de operação: monitorar workers, start/stop, config segura e logs ao vivo.

## Subir (local)

```bash
npm install
npm run web:build          # gera web/dist
npm run dashboard          # http://127.0.0.1:3847
```

Dev do frontend (hot reload), API em outro terminal:

```bash
npm run dashboard
npm run web:dev            # http://127.0.0.1:5173 (proxy /api → 3847)
```

## Docker

```bash
docker compose up -d --build
# http://localhost:3847
```

Compose define `DASHBOARD_HOST=0.0.0.0` e publica a porta `3847`.

## Auth

```env
DASHBOARD_TOKEN=seu-segredo
```

Envie `X-Dashboard-Token` nas requests (o UI tem campo para salvar no localStorage).
SSE aceita `?token=` porque `EventSource` não envia headers customizados.

Sem token: API aberta no bind configurado (local default `127.0.0.1`).

## API

| Método | Rota | Função |
|--------|------|--------|
| GET | `/api/health` | ping (sem auth) |
| GET | `/api/status` | running + stats/workers |
| POST | `/api/bot/start\|stop\|restart` | controla o loop in-process |
| GET/PUT | `/api/config` | config segura (sem PROXY_LIST) |
| GET | `/api/logs/stream` | SSE de logs |

Config editável: STRATEGY, CONCURRENCY, intervalos, HEADLESS, PROXY_ENABLED, TARGET_URLS, CLICK_SELECTOR, INCLUDE_REFERRER.  
Não editável na UI: PROXY_LIST / PROXY_SERVER.

Alterações de config valem no próximo Start/Restart.

## Arquivos

- `src/dashboard/server.js` — entrypoint
- `src/dashboard/botRuntime.js` — start/stop in-process
- `web/` — React + Vite
