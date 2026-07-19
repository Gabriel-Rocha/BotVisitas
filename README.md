# BotVisitas

Bot multi-dispositivo de visitas automatizadas com Puppeteer.
Base reescrita do zero para colaboração e execução em vários ambientes.

## Requisitos

- Node.js **>= 18**
- npm
- **Browser só é necessário** se a strategy exigir (ex.: `directLink`)
  - Default `dryRun` roda **sem** Chromium (ótimo p/ validar em qualquer device)
  - Com browser: Chromium do Puppeteer (`npm run browsers:install`) **ou** `CHROME_EXECUTABLE_PATH`

## Setup rápido

```bash
cp .env.example .env
npm install
npm start
```

Default: `STRATEGY=dryRun` — sem browser e sem direct links (proposital).

Para usar `directLink` depois:

```bash
npm run browsers:install   # se não usar Chrome do sistema
# no .env: STRATEGY=directLink e TARGET_URLS=...
```

## Scripts

| Comando | O que faz |
|---------|-----------|
| `npm start` | Sobe com a strategy do `.env` |
| `npm run start:dry` | Força dryRun |
| `npm run start:headed` | Abre janela do browser (debug) |

## Multi-dispositivo

1. Clone o repo
2. `cp .env.example .env` e ajuste
3. `npm install && npm start`

Opcional — usar browser do sistema:

```env
CHROME_EXECUTABLE_PATH=/usr/bin/chromium
```

## Estratégias

| Nome | Status |
|------|--------|
| `dryRun` | **Default** — valida pipeline sem smartlinks |
| `directLink` | Implementado; desligado por default (links fora de uso de propósito) |

## Proxies

Preparados na config (`PROXY_ENABLED` / `PROXY_SERVER`), **desligados** por custo.
Ver `src/core/proxy.js`.

## Documentação (contexto p/ IA e humanos)

Comece por [`docs/REFACTOR_CHECKLIST.md`](docs/REFACTOR_CHECKLIST.md).

## Estrutura

```
src/
  index.js          # entrypoint
  config/           # env → config
  core/             # browser, session, loop, proxy stub
  strategies/       # dryRun, directLink
  data/             # UAs, referrers
  utils/            # logger, random, sleep
```

## Colaborando

- Não hardcode URLs/keys — use `.env`
- Nova comportamento = nova strategy em `src/strategies/` + registro no `index.js`
- Atualize o checklist em `docs/` ao concluir tarefas
- Não commitar `.env` nem `logs/`
