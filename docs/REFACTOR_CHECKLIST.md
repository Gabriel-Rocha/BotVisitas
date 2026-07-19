# Checklist de Refatoração — BotVisitas

> **FONTE DA VERDADE.** Consultar sempre antes de alterar código.

**Status geral:** `v2 rebuild` — base pronta

---

## Decisões fechadas (2026-07-19)

| # | Decisão | Valor |
|---|----------|-------|
| 1 | Escopo | Reescrita do zero; colaborativo + multi-dispositivo |
| 2 | Direct Link | Código existe; **default = dryRun** (links fora de uso de propósito) |
| 3 | Proxies | Stub pronto; `PROXY_ENABLED=false` |
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
- [ ] Docker opcional p/ servers
- [ ] Rotação real de proxy (quando houver orçamento)
- [ ] Novas strategies sob demanda
- [ ] Commit da refatoração (quando usuário pedir)

---

## Anti-padrões

- Hardcodar secrets/URLs
- Tornar `directLink` default sem decisão explícita
- Implementar proxy “de verdade” sem pedido
- Monólitos copy-paste
- Pastas fora da arquitetura documentada
