# BotVisitas

Bot multi-dispositivo de visitas automatizadas com Puppeteer.
Base modular reescrita do zero para colaboração e execução em vários ambientes.

## ⚖️ Uso — leia antes (cláusula pétrea)

Este projeto automatiza navegação e cliques **exclusivamente para teste defensivo
autorizado contra infraestrutura que VOCÊ controla** (localhost, seu staging, domínio
seu, arquivos locais). **Não** aponte para smartlinks de ads ou páginas de terceiros —
automatizar cliques nisso é **fraude de clique**, e está fora do escopo.

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
docker compose logs -f bot
```

Ou: `npm run docker:up` → `npm run docker:logs`.

Default: `STRATEGY=dryRun`. Detalhes: [`docs/08-docker.md`](docs/08-docker.md).

## Setup local (sem Docker)

```bash
cp .env.example .env
npm install
npm start
```

## Scripts

| Comando | O que faz |
|---------|-----------|
| `npm run docker:up` | Build + sobe o bot no container |
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
| `directLink` | Acessa `TARGET_URLS` e clica; opt-in, **só contra infra sua** |

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

## Proxies

Preparados na config (`PROXY_ENABLED` / `PROXY_SERVER`), **desligados** por custo.
Ver `src/core/proxy.js`.

## Documentação

- ⚖️ **[`docs/07-clausula-petrea.md`](docs/07-clausula-petrea.md)** — fundacional (uso + registro de alterações)
- [`docs/08-docker.md`](docs/08-docker.md) — rodar sempre no container
- [`docs/05-referencia-tecnica.md`](docs/05-referencia-tecnica.md) — referência técnica completa
- [`docs/06-red-team-harness.md`](docs/06-red-team-harness.md) — o harness de detecção
- [`docs/README.md`](docs/README.md) — índice e ordem de leitura
- [`docs/REFACTOR_CHECKLIST.md`](docs/REFACTOR_CHECKLIST.md) — histórico do rebuild

## Estrutura

```
src/
  index.js          # entrypoint (loop + strategies)
  config/           # env → config
  core/             # browser, session, loop, proxy stub
  strategies/       # dryRun (default), directLink
  redteam/          # harness de cobertura de detecção (npm run redteam)
  data/             # UAs, referrers
  utils/            # logger, random, sleep
scripts/
  test-server.js    # página de teste local :3000 (npm run test:server)
```

## Colaborando

- Não hardcode URLs/keys — use `.env`
- Novo comportamento = nova strategy em `src/strategies/` + registro no `index.js`
- Alvos (`TARGET_URLS`, harness) são **sempre** infra sua — ver a cláusula pétrea
- Não commitar `.env` nem `logs/`
```
