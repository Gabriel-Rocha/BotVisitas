# Checklist de Refatoração — BotVisitas

> **FONTE DA VERDADE.** Consultar sempre antes de alterar código.

**Status geral:** `v2 rebuild` — base pronta

---

## Decisões fechadas (2026-07-19)

| # | Decisão | Valor |
|---|----------|-------|
| 1 | Escopo | Reescrita do zero; colaborativo + multi-dispositivo |
| 2 | Direct Link | Opt-in (`STRATEGY=directLink`); **default = dryRun** |
| 3 | Proxies | Webshare free (máx. 10); lease exclusivo por worker |
| 4 | JS | **CommonJS** |
| 5 | Chromium | Embutido no Puppeteer; opcional `CHROME_EXECUTABLE_PATH` |
| 6 | Blog / GH Pages / fetch | Fora do v1 |
| 7 | Headless | `HEADLESS=true` default; `start:headed` p/ debug |

---

## Fases

### FASE 0 — Fundação
- [x] Docs + pastas + regra Cursor
- [x] Escopo validado com usuário

### FASE 1 — Higiene + rebuild
- [x] `.gitignore` correto
- [x] `.env.example`
- [x] `package.json` limpo
- [x] `README.md`
- [x] Legado removido

### FASE 2 — Config
- [x] `src/config/index.js`
- [x] UA / referrers JSON
- [x] Flags / timeouts / intervalos via env
- [x] Hooks de proxy na config

### FASE 3 — Núcleo
- [x] browser / session / loop
- [x] proxy stub
- [x] utils + entrypoint + shutdown

### FASE 4 — Estratégias
- [x] dryRun (default)
- [x] directLink (opt-in)
- [x] registry

### FASE 5 — Proxies
- [x] Stub documentado (sem rotação real)

### FASE 6 — Robustez
- [x] Contadores + restart periódico
- [x] Timeouts finitos + sleep Promise
- [x] SIGINT / SIGTERM

### FASE 7 — Docs
- [x] Docs alinhadas ao v2

---

## Backlog (pós-v2)

- [ ] Lint (eslint) + script `npm test` smoke
- [x] Docker — forma padrão de execução (`Dockerfile` + `docker-compose.yml` + `docs/08-docker.md`)
- [x] Proxy Webshare free (máx. 10) — lease exclusivo + workers (`docs/09-proxies-webshare.md`)
- [x] Workers concorrentes (`CONCURRENCY`, default 5)
- [x] Multi-agentes por device (`DEVICE_MIX` + `device-profiles.json`)
- [x] Dashboard UI (Express + React) — `docs/10-dashboard.md`
- [x] Aba de visualização ao vivo do viewport por worker
- [x] Aba Indicadores (métricas ao vivo + agregados Postgres)
- [x] Histórico Postgres (runs + logs + snapshots, volume Docker persistente)
- [ ] Health-check de proxy (pular IP morto)
- [ ] Rotação premium / residencial (quando houver orçamento)
- [ ] Novas strategies sob demanda
- [ ] Commit (quando usuário pedir)

---

## Anti-padrões

- Hardcodar secrets/URLs
- Tornar `directLink` default sem decisão explícita
- Implementar proxy “de verdade” sem pedido
- Monólitos copy-paste
- Pastas fora da arquitetura documentada
