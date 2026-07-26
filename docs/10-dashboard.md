# Dashboard UI — BotVisitas

Painel de operação: monitorar workers, start/stop, config segura, logs ao vivo,
**visualização da página aberta** e histórico persistente (Postgres).

## Subir (local)

```bash
npm install
npm run web:build          # gera web/dist
# Suba o Postgres (Compose) se for usar histórico:
docker compose up -d db
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

Compose define `DASHBOARD_HOST=0.0.0.0`, publica `3847` e sobe o Postgres com volume
`botvisitas_pg_data` (dados sobrevivem a stop/restart/`down` sem `-v`).

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
| GET | `/api/health` | ping + status do Postgres |
| GET | `/api/status` | running + stats/workers + `runId` |
| GET | `/api/workers/:workerId/preview` | JPEG do viewport atual do worker |
| GET | `/api/metrics` | agregados históricos + status de disponibilidade do Postgres |
| POST | `/api/bot/start\|stop\|restart` | controla o loop in-process (body opcional: `targetUrls`) |
| GET/PUT | `/api/config` | config segura (sem PROXY_LIST) |
| GET | `/api/logs/stream` | SSE de logs |
| GET | `/api/runs` | lista paginada (`limit`, `offset`, `status`) |
| GET | `/api/runs/:id` | detalhe do run |
| GET | `/api/runs/:id/logs` | logs do run (`limit`, `before`, `level`) |
| GET | `/api/runs/:id/snapshots` | timeline de métricas |

Config editável: STRATEGY, CONCURRENCY, DEVICE_MIX, intervalos, HEADLESS, PROXY_ENABLED, BROWSE_PAGES_MIN/MAX, INCLUDE_REFERRER.

Links de destino preferencialmente colados no painel (runtime, não gravam no `.env`).
Não editável na UI: PROXY_LIST / PROXY_SERVER / credenciais do banco.

Alterações de config valem no próximo Start/Restart.

## Visualização

A aba **Visualização** captura o viewport atual de cada worker com browser e atualiza
a imagem a cada 5 segundos enquanto estiver aberta. A URL, o título e o horário da
captura aparecem junto da imagem.

As capturas são entregues diretamente da memória, protegidas pelo mesmo
`DASHBOARD_TOKEN` da API. Elas não são gravadas em disco nem nos snapshots do
Postgres. Em `dryRun` não há visualização porque essa estratégia não abre Chromium.

## Indicadores

A aba **Indicadores** mostra métricas da sessão ao vivo (taxa de sucesso/erro,
throughput OK/hora, uptime, workers, devices, URL atual) e agregados do Postgres
(total histórico, últimas 24h, runs recentes). Endpoint: `GET /api/metrics`.
Se o banco estiver offline, a aba continua com os indicadores ao vivo.

## Histórico

Cada Start cria um `bot_runs`. Enquanto roda: logs assíncronos + snapshots a cada
`SNAPSHOT_INTERVAL_SEC` (default 10s). No Stop: métricas finais + snapshot final.
A seção **Histórico** no painel lista runs anteriores e abre detalhe (targets, workers,
sparkline, logs). Se o Postgres estiver offline, o dashboard continua; só o histórico
fica indisponível (503).

## Arquivos

- `src/dashboard/server.js` — entrypoint (+ init DB)
- `src/dashboard/botRuntime.js` — start/stop + lifecycle do run
- `src/db/` — pool, schema, queries, fila de logs
- `web/` — React + Vite (`HistoryPanel.jsx`, `MetricsPanel.jsx`, `CapturesPanel.jsx`)
