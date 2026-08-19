# BotVisitas

Bot multi-dispositivo de visitas automatizadas com Puppeteer.
Base reescrita do zero para colaboração e execução em vários ambientes.

## Requisitos

- Node.js **>= 18**
- npm
- **Browser é necessário** na strategy padrão (`directLink`)
  - Chromium do Puppeteer (`npm run browsers:install`) **ou** `CHROME_EXECUTABLE_PATH`
  - `dryRun` é opt-in e roda sem Chromium (só para validar pipeline)

## Setup rápido

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

Opcional — usar browser do sistema:

```env
CHROME_EXECUTABLE_PATH=/usr/bin/chromium
```

## Estratégias

| Nome | Status |
|------|--------|
| `directLink` | **Default** — acessa `TARGET_URLS` e clica |
| `dryRun` | Opt-in — valida pipeline sem smartlinks |

## Proxies

Configuráveis via `PROXY_ENABLED` / `PROXY_SERVER`.
Ver `src/core/proxy.js`.

## Documentação (contexto p/ IA e humanos)

Comece por [`docs/REFACTOR_CHECKLIST.md`](docs/REFACTOR_CHECKLIST.md).

## Estrutura

```
src/
  index.js          # entrypoint
  config/           # env → config
  core/             # browser, session, loop, proxy
  strategies/       # dryRun, directLink
  data/             # UAs, referrers
  utils/            # logger, random, sleep
```

## Colaborando

- Não hardcode URLs/keys — use `.env`
- Nova comportamento = nova strategy em `src/strategies/` + registro no `index.js`
- Atualize o checklist em `docs/` ao concluir tarefas
- Não commitar `.env` nem `logs/`
