# Checklist de Refatoração — BotVisitas

> **FONTE DA VERDADE.** Consultar sempre antes de alterar código.

**Status geral:** `v2 rebuild` — base pronta; restrições de dryRun/intervalo removidas

---

## Decisões fechadas

| # | Decisão | Valor |
|---|----------|-------|
| 1 | Escopo | Reescrita do zero; colaborativo + multi-dispositivo |
| 2 | Direct Link | **default = directLink** (2026-08-19: restrições de dryRun/intervalo removidas) |
| 3 | Proxies | Interface pronta; `PROXY_ENABLED=false` até haver servidor |
| 4 | JS | **CommonJS** |
| 5 | Chromium | Embutido no Puppeteer; opcional `CHROME_EXECUTABLE_PATH` |
| 6 | Blog / GH Pages / fetch | Fora do v1 |
| 7 | Headless | `HEADLESS=true` default; `start:headed` p/ debug |
| 8 | Intervalo | Default 0–0 s (sem espera entre iterações) |
| 9 | Restart do browser | Default 0 (nunca), configurável via env |

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
- [x] dryRun (opt-in)
- [x] directLink (default)
- [x] registry

### FASE 5 — Proxies
- [x] Stub documentado (sem rotação real)

### FASE 6 — Robustez
- [x] Contadores + restart periódico (opt-in)
- [x] Timeouts finitos + sleep Promise
- [x] SIGINT / SIGTERM

### FASE 7 — Docs
- [x] Docs alinhadas ao v2

### FASE 8 — Sem restrições operacionais
- [x] Default `STRATEGY=directLink`
- [x] Intervalo default 0 (sem espera)
- [x] Sem restart periódico obrigatório
- [x] Sem aviso de “links fora de uso”
- [x] `dryRun` permanece só como opt-in

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
- [x] Ofuscação de visitas (stealth + humanize + doc crítica `11-ofuscacao.md` + cláusula pétrea #2)
- [x] Timezone/locale automático pela região do IP (`src/core/geo.js` + `STEALTH_GEO_TZ`)
- [x] Stealth sem quebrar JS do site (WebRTC suave; sem disable site-per-process)
- [x] Aviso de reputação IP (`proxy`/`hosting`) + `PROXY_SKIP_FLAGGED` + doc "anonymous proxy detected"
- [ ] Health-check de proxy (pular IP morto)
- [ ] Rotação premium / residencial (quando houver orçamento)
- [ ] Novas strategies sob demanda
- [ ] Commit (quando usuário pedir)

---

## Anti-padrões

- Hardcodar secrets/URLs
- Implementar proxy “de verdade” sem pedido
- Monólitos copy-paste
- Pastas fora da arquitetura documentada
- Expor automação / IP real (regressão de ofuscação) — ver `docs/11-ofuscacao.md`
- UAs de outro motor (Firefox/Safari) no Chromium
