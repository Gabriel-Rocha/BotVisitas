# Referência Técnica — BotVisitas v2

Documentação técnica completa da base reescrita (`v2 rebuild`). Cobre visão geral,
arquitetura, fluxo de execução, referência módulo a módulo, tabela de configuração,
estratégias e como estender/operar o projeto.

> Docs de contexto rápido: [00-contexto](./00-contexto.md) ·
> [01-arquitetura](./01-arquitetura.md) · [02-estado-atual](./02-estado-atual.md) ·
> [04-convencoes](./04-convencoes.md) · [checklist](./REFACTOR_CHECKLIST.md)

---

## 1. Visão geral

BotVisitas é um bot em **Node.js + Puppeteer** que automatiza visitas e cliques em
páginas (smartlinks de ads), simulando comportamento humano (user-agents e referrers
aleatórios, intervalos randômicos, stealth). Foi reescrito do zero com foco em:

- **Modularidade** — núcleo (browser/session/loop) separado das *strategies*.
- **Multi-dispositivo** — roda em macOS / Linux / Windows, config só por `.env`.
- **Segurança por padrão** — a strategy default (`dryRun`) **não sobe browser** e
  **não acessa links reais**; serve para validar o pipeline em qualquer máquina.

| Item | Valor |
|------|-------|
| Runtime | Node.js **>= 18** |
| Módulos | CommonJS (`require` / `module.exports`) |
| Entrypoint | [`src/index.js`](../src/index.js) |
| Config | `.env` via `dotenv` |
| Deps principais | `puppeteer`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth`, `dotenv` |
| Persistência | PostgreSQL (histórico de runs/logs/snapshots do dashboard; volume Docker) |

---

## 2. Arquitetura

O sistema é dividido em quatro camadas:

1. **Config** (`src/config`) — lê o `.env` e os JSONs de dados, normaliza tipos e
   valida (ex.: intervalo mínimo não pode ser maior que o máximo).
2. **Núcleo** (`src/core`) — orquestra o ciclo de vida do browser e o loop infinito.
3. **Strategies** (`src/strategies`) — definem *o que* fazer a cada iteração. São
   plugáveis via registry.
4. **Utils** (`src/utils`) — logger, aleatoriedade e sleep.

```
┌─────────────┐   loadConfig    ┌──────────────┐  resolveStrategy  ┌────────────┐
│  index.js   │ ───────────────▶│  config/     │                   │ strategies/│
│ (entrypoint)│                 └──────────────┘◀──────────────────│  registry  │
└──────┬──────┘                                                    └────────────┘
       │ createLoop({ config, strategy, logger })
       ▼
┌───────────────────────── core/loop.js ─────────────────────────┐
│  run() {                                                        │
│    while (!stopping) {                                          │
│      ensureBrowser()  ── core/browser.js ── core/proxy.js       │
│      createSession()  ── core/session.js (UA, viewport, timeouts)│
│      strategy.run(page, { config, logger })                    │
│      maybeRestartBrowser()                                      │
│      sleep(randomInt(min,max))                                  │
│    }                                                            │
│  }                                                              │
└────────────────────────────────────────────────────────────────┘
```

### Contrato de strategy

Toda strategy é um objeto com esta forma:

```js
module.exports = {
  name: 'dryRun',          // chave única no registry
  requiresBrowser: false,  // false => o loop NÃO lança Chromium
  async run(page, { config, logger }) {
    // page é null quando requiresBrowser === false
    return { ok: true, meta: { /* ... */ } };
  },
};
```

- `ok: true` incrementa `stats.ok`; qualquer outra coisa (ou throw) incrementa
  `stats.errors`.
- `meta` é livre — usado só para logs/telemetria futura.

---

## 3. Fluxo de execução (passo a passo)

1. `main()` em [`src/index.js`](../src/index.js) chama `loadConfig()`, cria o `logger`
   e resolve a strategy pelo nome (`config.strategy`).
2. Loga informações de ambiente (Node, plataforma, arch, strategy, headless, proxy).
3. Registra handlers de `SIGINT` / `SIGTERM` para *graceful shutdown*.
4. `createLoop(...)` monta o estado (`stats`, `browser`, `page`) e retorna
   `{ run, stop, getStats }`.
5. `run()` entra no `while (!stopping)`:
   - `ensureBrowser()` — só lança o browser se `strategy.requiresBrowser !== false`.
   - `strategy.run(page, ctx)` executa a iteração.
   - `maybeRestartBrowser()` — a cada `BROWSER_RESTART_EVERY` iterações, recria o
     browser (mitiga vazamento de memória em execuções longas).
   - Dorme por um valor aleatório entre `INTERVAL_MIN_SEC` e `INTERVAL_MAX_SEC`.
6. Se uma iteração lança erro, o loop registra, tenta **recriar a sessão** (nova aba)
   e, se falhar, derruba o browser para que a próxima iteração o recrie do zero.
7. Ao receber sinal, `stop()` marca `stopping = true`, fecha o browser e o processo
   sai com código 0.

---

## 4. Referência de módulos

### `src/index.js` — entrypoint
Monta config → logger → strategy → loop, registra os sinais de shutdown e inicia o
loop. Erros não tratados caem no `.catch` final (`[FATAL]`, exit 1).

### `src/config/index.js` — carregamento de config
- Lê `.env` (via `dotenv`) e os JSONs em `src/data/`.
- Helpers de coerção: `bool()`, `int()`, `parseUrls()` (CSV → array).
- **Validação:** lança se `INTERVAL_MIN_SEC > INTERVAL_MAX_SEC`.
- Exporta `loadConfig()` → objeto de config normalizado.

### `src/core/browser.js` — ciclo de vida do Chromium
- Usa `puppeteer-extra` + plugin **stealth**.
- `launchBrowser(config, logger)` — monta args (`--no-sandbox`,
  `--disable-dev-shm-usage`, etc.), remove `--enable-automation`, aplica args de proxy
  e usa `CHROME_EXECUTABLE_PATH` se definido (senão, Chromium embutido).
- `closeBrowser(browser, logger)` — fecha com try/catch tolerante.

### `src/core/session.js` — página/aba
- `createSession(browser, config, logger)` — nova aba com viewport, timeouts de
  navegação/default e user-agent aleatório (`pick`).
- `recreateSession(...)` — fecha a aba atual (se aberta) e cria outra. Usado na
  recuperação de erro do loop.

### `src/core/loop.js` — orquestrador
- Estado: `stats` (`iterations`, `ok`, `errors`, `startedAt`), `browser`, `page`,
  `stopping`.
- `ensureBrowser()` / `maybeRestartBrowser()` — gerência preguiçosa + restart
  periódico.
- `tick()` — uma iteração: garante browser, roda strategy, contabiliza, avalia
  restart.
- `run()` / `stop()` / `getStats()` — API pública do loop.

### `src/core/proxy.js` — stub de proxy
- `getProxyLaunchArgs(proxyConfig)` — retorna `['--proxy-server=...']` **só** se
  `PROXY_ENABLED=true` e `PROXY_SERVER` setado (senão `[]`; lança se enabled sem
  server).
- `assertProxyReady(...)` — valida/loga o estado do proxy no launch.
- **Hoje desligado de propósito** (custo). Ponto único de evolução para rotação /
  health-check / auth.

### `src/strategies/index.js` — registry
- Mapa `{ name → strategy }`. `resolveStrategy(name)` retorna a strategy ou lança
  listando as disponíveis.

### `src/strategies/dryRun.js` — **default, sem browser**
- `requiresBrowser: false`. Apenas loga o que faria em produção e retorna `ok: true`.
  Ideal para validar config/loop em qualquer device sem Chromium.

### `src/strategies/directLink.js` — **opt-in, com browser**
- `requiresBrowser: true`. Exige `TARGET_URLS`. Abre a URL de entrada, faz scroll/dwell
  e navega `BROWSE_PAGES_MIN`..`BROWSE_PAGES_MAX` links **internos do mesmo host**.
- Sem clique forçado em CTA. Opt-in via `STRATEGY=directLink` (default: `dryRun`).

### `src/utils/`
- `logger.js` — logger com níveis (`error`/`warn`/`info`/`debug`) e timestamp ISO;
  respeita `LOG_LEVEL`.
- `random.js` — `randomInt(min, max)` (inclusivo) e `pick(list)` (item aleatório;
  lança em lista vazia).
- `sleep.js` — `sleep(ms)` baseado em Promise (nunca usar `page.waitForTimeout`).

### `src/data/`
- `device-profiles.json` — perfis `desktop` / `mobile` / `tablet` (viewport + UA + touch).
- `user-agents.json` — pool legado de UAs desktop (fallback).
- `referrers.json` — pool de referrers (Google, Wikipedia, Bing).

---

## 5. Referência de configuração (`.env`)

Copie `.env.example` para `.env`. **Nunca** commite o `.env`.

| Variável | Default | Tipo | Descrição |
|----------|---------|------|-----------|
| `STRATEGY` | `dryRun` | `dryRun` \| `directLink` | Estratégia executada a cada iteração |
| `HEADLESS` | `true` | bool | `true` = Chromium sem janela (recomendado em servers) |
| `CHROME_EXECUTABLE_PATH` | *(vazio)* | path | Browser do sistema; vazio = Chromium do Puppeteer |
| `NAVIGATION_TIMEOUT_MS` | `60000` | int | Timeout de navegação (ms) |
| `DEFAULT_TIMEOUT_MS` | `30000` | int | Timeout padrão de ações (ms) |
| `INTERVAL_MIN_SEC` | `60` | int | Mínimo de espera entre iterações (s) |
| `INTERVAL_MAX_SEC` | `900` | int | Máximo de espera entre iterações (s) |
| `BROWSER_RESTART_EVERY` | `20` | int | Reinicia o browser a cada N iterações (`0` = nunca) |
| `CONCURRENCY` | `5` | int | Workers se `DEVICE_MIX` vazio |
| `DEVICE_MIX` | *(vazio)* | CSV | Ex.: `desktop:2,mobile:2` — soma manda; vazio = todos desktop |
| `VIEWPORT_WIDTH` | `1920` | int | Fallback de largura (preferir perfis de device) |
| `VIEWPORT_HEIGHT` | `1080` | int | Fallback de altura (preferir perfis de device) |
| `TARGET_URLS` | *(vazio)* | CSV | URLs de entrada (`directLink`); smartlinks ou qualquer host |
| `BROWSE_PAGES_MIN` | `1` | int | Mín. de páginas internas após a entrada |
| `BROWSE_PAGES_MAX` | `3` | int | Máx. de páginas internas após a entrada |
| `INCLUDE_REFERRER` | `true` | bool | Navega por um referrer antes do alvo |
| `PROXY_ENABLED` | `false` | bool | Liga o proxy (experimental / custo) |
| `PROXY_SERVER` | *(vazio)* | url | `http://user:pass@host:port` (obrigatório se enabled) |
| `LOG_LEVEL` | `info` | `error`\|`warn`\|`info`\|`debug` | Nível de log |

> `bool` aceita `1/true/yes/on` como verdadeiro. Se `INTERVAL_MIN_SEC >
> INTERVAL_MAX_SEC`, a config lança erro no boot.

---

## 6. Como rodar

```bash
cp .env.example .env      # ajuste conforme necessário
npm install               # postinstall tenta baixar o Chromium do Puppeteer
npm start                 # usa a STRATEGY do .env (default: dryRun)
```

Scripts disponíveis:

| Comando | O que faz |
|---------|-----------|
| `npm start` | Sobe com a strategy do `.env` |
| `npm run start:dry` | Força `STRATEGY=dryRun` |
| `npm run start:headed` | Força `HEADLESS=false` (abre a janela p/ debug) |
| `npm run browsers:install` | Baixa o Chromium do Puppeteer |

Usar `directLink`:

```env
STRATEGY=directLink
TARGET_URLS=https://exemplo.com/a,https://exemplo.com/b
```

### Receita `directLink`

Fluxo: entra na URL → scroll/dwell → segue links internos do mesmo domínio.

```env
STRATEGY=directLink
TARGET_URLS=https://exemplo.com/smartlink
BROWSE_PAGES_MIN=1
BROWSE_PAGES_MAX=3
INCLUDE_REFERRER=false
INTERVAL_MIN_SEC=30
INTERVAL_MAX_SEC=60
```

```bash
npm run start:headed    # abre a janela p/ acompanhar
```

No log: `Entrada:`, `Links internos encontrados: N`, `Navegação 1/3:`, `Lendo página`.
`Ctrl+C` encerra com shutdown gracioso.

Usar browser do sistema (opcional):

```env
CHROME_EXECUTABLE_PATH=/usr/bin/chromium   # ou /usr/bin/google-chrome
```

---

## 7. Como estender

### Nova strategy
1. Crie `src/strategies/minhaStrategy.js` seguindo o [contrato](#contrato-de-strategy).
2. Registre em `src/strategies/index.js` (`registry`).
3. Selecione com `STRATEGY=minhaStrategy` no `.env`.
4. Atualize o [checklist](./REFACTOR_CHECKLIST.md).

### Ativar proxies (futuro)
Evoluir **apenas** `src/core/proxy.js` (lista, rotação, health-check, auth). Não
espalhar `--proxy-server` por outros arquivos.

---

## 8. Operação e troubleshooting

| Sintoma | Provável causa / ação |
|---------|-----------------------|
| `Estratégia desconhecida: "..."` | `STRATEGY` inválida; use `dryRun` ou `directLink` |
| `STRATEGY=directLink exige TARGET_URLS` | Preencha `TARGET_URLS` no `.env` |
| `INTERVAL_MIN_SEC não pode ser maior...` | Corrija os intervalos no `.env` |
| `PROXY_ENABLED=true mas PROXY_SERVER está vazio` | Defina `PROXY_SERVER` ou desligue o proxy |
| Chromium não encontrado | `npm run browsers:install` ou setar `CHROME_EXECUTABLE_PATH` |
| Uso de memória crescente | Ajuste `BROWSER_RESTART_EVERY` |

Encerramento: `Ctrl+C` (SIGINT) dispara shutdown gracioso, fechando o browser e
logando as `stats`.

---

## 9. Convenções e limites

- **CommonJS** em todo o projeto; uma strategy = um arquivo + registro.
- Secrets/URLs **só** em `.env`; listas grandes em `src/data/*.json`.
- Sem paths absolutos amarrados a um SO.
- Não tornar `directLink` default sem decisão explícita.
- Não implementar proxy "de verdade" sem pedido.
- `logs/` e `.env` são gitignored.
- Idioma do time (docs/respostas): **português**.

