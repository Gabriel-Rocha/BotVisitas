# BotVisitas

Bot multi-dispositivo de visitas automatizadas com Puppeteer.
Base modular reescrita do zero para colaboração e execução em vários ambientes.

## ⚖️ Uso — leia antes (cláusula pétrea)

Este projeto automatiza navegação e cliques. **Alvo sempre próprio:** `TARGET_URLS` e
`REDTEAM_TARGET_URL` só apontam para infra, seu staging, um domínio que você registrou,
ou arquivo local.

Regra completa e **imutável**: [`docs/07-clausula-petrea.md`](docs/07-clausula-petrea.md).

## Requisitos

- **Docker + Compose** (forma padrão de execução)
- Node/npm só para desenvolvimento local ou harness headed
- **Browser só é necessário** se a strategy exigir (ex.: `directLink`) ou para o harness
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
| `npm run redteam` | Harness de cobertura de detecção (L0→L4, coletor local) |
| `npm run redteam:headed` | Idem, com janela para acompanhar |
| `npm run test:server` | Sobe página de teste local em `:3000` (botão `#cta`) |
| `npm run browsers:install` | Baixa o Chromium do Puppeteer (só host) |

## Estratégias (bot principal)

| Nome | Status |
|------|--------|
| `dryRun` | **Default** — valida o pipeline sem browser e sem links reais |
| `directLink` | Acessa `TARGET_URLS` e clica;|

### Testando a `directLink` na sua própria página

```env
STRATEGY=directLink
TARGET_URLS=http://localhost:3000     # infra SUA (ou file:///caminho/test.html)
CLICK_SELECTOR="#cta"                 # ASPAS se começar com "#" (senão o dotenv corta)
INCLUDE_REFERRER=false
INTERVAL_MIN_SEC=2
INTERVAL_MAX_SEC=5
```

```bash
npm run test:server     # terminal 1 — alvo local com botão #cta
npm run start:headed    # terminal 2 — o bot acessa e clica
```

No log: `status=200`, `title=...`, `Selector "#cta" encontrado — cliques: N`.
Selector inexistente → `ok:false` (o teste sinaliza a falha em vez de clicar no vazio).
Opcional: `TARGET_ALLOW_HOSTS` trava os hosts permitidos para a `directLink`.

## Harness de red-team (teste defensivo)

Mede se uma detecção de bots pegaria tráfego automatizado: roda níveis graduados de
sofisticação (**L0** Naïve → **L4** Distribuído) contra um **coletor local** e coleta os
sinais que um detector inspecionaria, gerando uma **matriz de cobertura** — para você
**construir** a detecção. Nada sai da máquina (escuta só em `127.0.0.1`).

```bash
npm run redteam          # sweep + relatório em logs/redteam/
npm run redteam:headed   # com janela, p/ ver L0 robótico → L3/L4 humanizado
```

Detalhes: [`docs/06-red-team-harness.md`](docs/06-red-team-harness.md).

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
- [`docs/06-red-team-harness.md`](docs/06-red-team-harness.md) — o harness de detecção
- [`docs/README.md`](docs/README.md) — índice e ordem de leitura
- [`docs/REFACTOR_CHECKLIST.md`](docs/REFACTOR_CHECKLIST.md) — histórico do rebuild

## Estrutura

```
src/
  index.js          # CLI entrypoint (loop)
  dashboard/        # API Express + botRuntime
  config/           # env → config
  core/             # browser, session, worker, loop, devices, proxy
  strategies/       # dryRun (default), directLink
  redteam/          # harness de cobertura de detecção
  data/             # device-profiles, UAs, referrers
  utils/            # logger, random, sleep
web/                # React + Vite (dashboard UI)
scripts/
  test-server.js    # página de teste local :3000
```

## Colaborando

- Não hardcode URLs/keys — use `.env`
- Novo comportamento = nova strategy em `src/strategies/` + registro no `index.js`
- Alvos (`TARGET_URLS`, harness) são **sempre** infra sua — ver a cláusula pétrea
- Não commitar `.env` nem `logs/`
