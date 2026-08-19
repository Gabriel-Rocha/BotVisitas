# BotVisitas

Bot multi-dispositivo de visitas automatizadas com Puppeteer.
Base reescrita do zero para colaboração e execução em vários ambientes.

## Requisitos

- Node.js **>= 18**
- npm
- **Browser é necessário** na strategy padrão (`directLink`)
  - **Chrome do sistema** (melhor fingerprint TLS/HTTP) via autodetect ou `CHROME_EXECUTABLE_PATH`
  - fallback: Chromium do Puppeteer (`npm run browsers:install`)
  - `dryRun` é opt-in e roda sem Chromium

## Setup rápido

```bash
cp .env.example .env
# preencha TARGET_URLS no .env
npm install
npm start
```

Default: `STRATEGY=directLink` com stealth ligado (identidade persistente, headers, timing humano).

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
| `npm test` | Smoke das funções de stealth/config |

## Stealth

O browser é preparado para parecer uma sessão Chrome real:

| Técnica | Onde |
|---------|------|
| User-Agent + headers / client hints | `src/core/stealth.js` + perfil |
| Cookies + perfil Chrome persistente | `logs/browser-session/` |
| Frequência irregular de requests | `STEALTH_GAP_*` / `INTERVAL_*` |
| IP / WebRTC (não vazar IP real com proxy) | `PROXY_*` + flags WebRTC |
| Navegação humana (mouse, scroll, dwell) | `src/core/human.js` |
| JS (platform, WebGL, tela, hardware) | `evaluateOnNewDocument` |
| Sinais de automação | puppeteer-extra-plugin-stealth + flags |
| TLS/HTTP | Chrome real (`CHROME_AUTODETECT`) — JA3 segue o binário |

Identidade (UA, viewport, timezone, proxy) **não rotaciona a cada visita**: a mesma sessão reutiliza cookies e fingerprint.

Proxy residencial/móvel continua sendo o que mais pesa na reputação de IP. Sem proxy, o IP é o da máquina.

## Multi-dispositivo

1. Clone o repo
2. `cp .env.example .env` e ajuste (`TARGET_URLS` obrigatório em `directLink`)
3. `npm install && npm start`

Opcional — forçar browser do sistema:

```env
CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome
```

## Estratégias

| Nome | Status |
|------|--------|
| `directLink` | **Default** — acessa `TARGET_URLS` com stealth |
| `dryRun` | Opt-in — valida pipeline sem smartlinks |

## Proxies

`PROXY_ENABLED=true` e `PROXY_SERVER` / `PROXY_SERVERS` (lista). O endpoint escolhido fica preso à identidade da sessão.
Ver `src/core/proxy.js`.

## Documentação (contexto p/ IA e humanos)

Comece por [`docs/REFACTOR_CHECKLIST.md`](docs/REFACTOR_CHECKLIST.md).

## Estrutura

```
src/
  index.js          # entrypoint
  config/           # env → config
  core/             # browser, session, loop, proxy, identity, stealth, human
  strategies/       # dryRun, directLink
  data/             # perfis, UAs, referrers
  utils/            # logger, random, sleep
```

## Colaborando

- Não hardcode URLs/keys — use `.env`
- Nova comportamento = nova strategy em `src/strategies/` + registro no `index.js`
- Atualize o checklist em `docs/` ao concluir tarefas
- Não commitar `.env` nem `logs/`
