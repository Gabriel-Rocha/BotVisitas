# BotVisitas

Bot multi-dispositivo de visitas automatizadas com Puppeteer.
Base modular reescrita do zero para colaboração e execução em vários ambientes.

## ⚖️ Uso — cláusula pétrea

Este projeto automatiza navegação e cliques. `TARGET_URLS` pode apontar para
infra interna, externa ou **smartlinks** (próprios ou de terceiros).

**Ofuscação (obrigatória):** cada acesso deve parecer visita humana — sem
aparentar bot nem uso de proxy/VPN. Ver [`docs/11-ofuscacao.md`](docs/11-ofuscacao.md).

Regra completa: [`docs/07-clausula-petrea.md`](docs/07-clausula-petrea.md).

## Requisitos

- Node.js **>= 18**
- npm
- **Browser é necessário** na strategy padrão (`directLink`)
  - Chromium do Puppeteer (`npm run browsers:install`) **ou** `CHROME_EXECUTABLE_PATH`
  - `dryRun` é opt-in e roda sem Chromium (só para validar pipeline)

## Setup rápido (Docker — recomendado)

```bash
cp .env.example .env
# preencha TARGET_URLS no .env
npm install
npm start
```

Default: `STRATEGY=directLink` — visita as URLs de `TARGET_URLS` em loop, sem espera entre iterações.

Para só validar o pipeline, sem browser:

```bash
npm run start:dry
```

## Scripts

| Comando | O que faz |
|---------|-----------|
| `npm start` | Sobe com a strategy do `.env` (`directLink` por padrão) |
| `npm run start:dry` | Força dryRun (sem browser) |
| `npm run start:headed` | Abre janela do browser (debug) |

## Multi-dispositivo

1. Clone o repo
2. `cp .env.example .env` e ajuste (`TARGET_URLS` obrigatório em `directLink`)
3. `npm install && npm start`

### Usando a `directLink`

```env
STRATEGY=directLink
TARGET_URLS=https://exemplo.com/smartlink
INCLUDE_REFERRER=false
INTERVAL_MIN_SEC=30
INTERVAL_MAX_SEC=60
```

```bash
npm run start:headed    # abre a janela p/ acompanhar (dev no host)
```

Fixture local opcional: `npm run test:server` + `TARGET_URLS=http://localhost:3000`.

| Nome | Status |
|------|--------|
| `directLink` | **Default** — acessa `TARGET_URLS` e clica |
| `dryRun` | Opt-in — valida pipeline sem smartlinks |

Cada worker é um agente com perfil (`desktop` / `mobile` / `tablet`): viewport + UA + touch coerentes. Ver [`docs/01-arquitetura.md`](docs/01-arquitetura.md).

Configuráveis via `PROXY_ENABLED` / `PROXY_SERVER`.
Ver `src/core/proxy.js`.

## Documentação

- ⚖️ **[`docs/07-clausula-petrea.md`](docs/07-clausula-petrea.md)** — fundacional (uso + registro de alterações)
- 🔒 **[`docs/11-ofuscacao.md`](docs/11-ofuscacao.md)** — visita humana / anti-detecção (crítico)
- [`docs/10-dashboard.md`](docs/10-dashboard.md) — painel web de operação
- [`docs/08-docker.md`](docs/08-docker.md) — rodar sempre no container
- [`docs/05-referencia-tecnica.md`](docs/05-referencia-tecnica.md) — referência técnica completa
- [`docs/README.md`](docs/README.md) — índice e ordem de leitura
- [`docs/REFACTOR_CHECKLIST.md`](docs/REFACTOR_CHECKLIST.md) — histórico do rebuild

## Estrutura

```
src/
  index.js          # CLI entrypoint (loop)
  dashboard/        # API Express + botRuntime
  db/               # Postgres (histórico: runs, logs, snapshots)
  config/           # env → config
  core/             # browser, session, loop, proxy
  strategies/       # dryRun, directLink
  data/             # UAs, referrers
  utils/            # logger, random, sleep
web/                # React + Vite (dashboard UI)
scripts/
  test-server.js    # página de teste local :3000
```

## Colaborando

- Não hardcode URLs/keys — use `.env`
- Novo comportamento = nova strategy em `src/strategies/` + registro no `index.js`
- Alvos em `.env` / painel — ver a cláusula pétrea
- Ofuscação: reutilizar `src/core/stealth.js`; não remover WebRTC block sem decisão documentada
- Não commitar `.env` nem `logs/`
