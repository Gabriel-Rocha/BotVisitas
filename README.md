# BotVisitas

Bot multi-dispositivo de visitas automatizadas com Puppeteer.
Base modular reescrita do zero para colaboração e execução em vários ambientes.

## ⚖️ Uso — cláusula pétrea

Este projeto automatiza navegação e cliques. `TARGET_URLS` pode apontar para
infra interna, externa ou **smartlinks** (próprios ou de terceiros).

Regra completa: [`docs/07-clausula-petrea.md`](docs/07-clausula-petrea.md).

## Requisitos

- **Docker + Compose** (forma padrão de execução)
- Node/npm só para desenvolvimento local
- **Browser só é necessário** se a strategy exigir (ex.: `directLink`)
  - Default `dryRun` roda **sem** Chromium
  - No Docker: Chromium do sistema já vem na imagem

## Setup rápido (Docker — recomendado)

```bash
cp .env.example .env
docker compose up -d --build
# Dashboard: http://localhost:3847
docker compose logs -f bot
```

Ou: `npm run docker:up` → abra o painel em `:3847`.

Default bot: `STRATEGY=dryRun`. Docs: [`docs/08-docker.md`](docs/08-docker.md) · [`docs/10-dashboard.md`](docs/10-dashboard.md).

O Compose também sobe **PostgreSQL** (volume persistente) para o histórico do dashboard.

## Dashboard (local sem Docker)

```bash
npm install
npm run web:build
npm run dashboard          # http://127.0.0.1:3847
```

## Setup local (sem Docker)

```bash
cp .env.example .env
npm install
npm start
```

## Scripts

| Comando | O que faz |
|---------|-----------|
| `npm run dashboard` | Sobe API + UI em `:3847` |
| `npm run web:dev` | Vite hot-reload (proxy `/api`) |
| `npm run web:build` | Build do frontend → `web/dist` |
| `npm run docker:up` | Build + sobe o container (dashboard) |
| `npm run docker:logs` | Logs do container |
| `npm run docker:down` | Para o container |
| `npm run docker:restart` | Reinicia o container |
| `npm start` | Sobe o bot no host (dev) |
| `npm run start:dry` | Força `dryRun` (sem browser) |
| `npm run start:headed` | Abre a janela do browser (debug no host) |
| `npm run test:server` | Sobe página de teste local em `:3000` (botão `#cta`) |
| `npm run browsers:install` | Baixa o Chromium do Puppeteer (só host) |

## Estratégias (bot principal)

| Nome | Status |
|------|--------|
| `dryRun` | **Default** — valida o pipeline sem browser e sem abrir URLs |
| `directLink` | Opt-in — acessa `TARGET_URLS` (smartlinks ou qualquer URL) |

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

## Proxies e concorrência

Plano free Webshare (máx. 10) + workers paralelos — ver [`docs/09-proxies-webshare.md`](docs/09-proxies-webshare.md).

```env
PROXY_ENABLED=true
CONCURRENCY=5          # fallback se DEVICE_MIX vazio
DEVICE_MIX=desktop:2,mobile:2,tablet:1   # soma manda; cada worker = 1 device
```

Cada worker é um agente com perfil (`desktop` / `mobile` / `tablet`): viewport + UA + touch coerentes. Ver [`docs/01-arquitetura.md`](docs/01-arquitetura.md).

`directLink` sem proxy força 1 worker. RAM: ~150–300MB por Chromium.

## Documentação

- ⚖️ **[`docs/07-clausula-petrea.md`](docs/07-clausula-petrea.md)** — fundacional (uso + registro de alterações)
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
  core/             # browser, session, worker, loop, devices, proxy
  strategies/       # dryRun (default), directLink
  data/             # device-profiles, UAs, referrers
  utils/            # logger, random, sleep
web/                # React + Vite (dashboard UI)
scripts/
  test-server.js    # página de teste local :3000
```

## Colaborando

- Não hardcode URLs/keys — use `.env`
- Novo comportamento = nova strategy em `src/strategies/` + registro no `index.js`
- Alvos em `.env` / painel — ver a cláusula pétrea
- Não commitar `.env` nem `logs/`
