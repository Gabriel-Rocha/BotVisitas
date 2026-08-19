# Checklist de Refatoração — BotVisitas

> **FONTE DA VERDADE.** Consultar sempre antes de alterar código.

**Status geral:** `v2 rebuild` — stealth anti-detecção ligado no default

---

## Decisões fechadas

| # | Decisão | Valor |
|---|----------|-------|
| 1 | Escopo | Reescrita do zero; colaborativo + multi-dispositivo |
| 2 | Direct Link | **default = directLink** |
| 3 | Proxies | Lista via env; endpoint fixo por identidade de sessão |
| 4 | JS | **CommonJS** |
| 5 | Chromium | Chrome do sistema (autodetect) ou Puppeteer; opcional `CHROME_EXECUTABLE_PATH` |
| 6 | Blog / GH Pages / fetch | Fora do v1 |
| 7 | Headless | `HEADLESS=true` default; `start:headed` p/ debug |
| 8 | Intervalo | `INTERVAL_*=0` usa `STEALTH_GAP_*` (padrão humano irregular) |
| 9 | Restart do browser | Default 0 (nunca), configurável via env |
| 10 | Stealth | Ligado por default; identidade + cookies persistentes |

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
- [x] Lista + auth + WebRTC lock (sem health-check)

### FASE 6 — Robustez
- [x] Contadores + restart periódico (opt-in)
- [x] Timeouts finitos + sleep Promise
- [x] SIGINT / SIGTERM

### FASE 7 — Docs
- [x] Docs alinhadas ao v2

### FASE 8 — Sem restrições operacionais
- [x] Default `STRATEGY=directLink`
- [x] Intervalo default 0 (cai no gap stealth)
- [x] Sem restart periódico obrigatório
- [x] Sem aviso de “links fora de uso”
- [x] `dryRun` permanece só como opt-in

### FASE 9 — Stealth / anti-detecção
- [x] User-Agent + headers HTTP / client hints alinhados ao Chrome real
- [x] Cookies + `userDataDir` persistentes
- [x] Frequência irregular (`STEALTH_GAP_*`)
- [x] Proxy + flags WebRTC (IP)
- [x] Navegação humana (mouse, scroll, dwell)
- [x] Fingerprint JS (platform, WebGL, tela, hardware)
- [x] Sinais de automação (stealth plugin + flags)
- [x] TLS via Chrome do sistema (JA3 = binário; sem spoof de TLS)

---

## Backlog (pós-v2)

- [x] Script `npm test` smoke (stealth/config)
- [ ] Lint (eslint)
- [ ] Docker opcional p/ servers
- [ ] Health-check / rotação automática de proxy
- [ ] Novas strategies sob demanda

---

## Anti-padrões

- Hardcodar secrets/URLs
- Rotacionar UA/IP/cookies a cada visita (quebra sessão)
- Fingir Firefox/UA móvel no Chromium
- Monólitos copy-paste
- Pastas fora da arquitetura documentada
