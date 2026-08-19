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
- [ ] Docker opcional p/ servers
- [ ] Rotação real de proxy (quando houver orçamento)
- [ ] Novas strategies sob demanda
- [ ] Commit da refatoração (quando usuário pedir)

---

## Anti-padrões

- Hardcodar secrets/URLs
- Implementar proxy “de verdade” sem pedido
- Monólitos copy-paste
- Pastas fora da arquitetura documentada
