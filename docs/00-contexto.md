# Contexto do projeto

## O que é

Bot Node.js + Puppeteer para automatizar visitas/cliques em smartlinks de ads.
Projeto pensado para **vários colaboradores** e execução em **vários dispositivos**.

## Stack (v1 rebuild)

- Node.js + **CommonJS**
- puppeteer + puppeteer-extra + stealth
- dotenv (config)
- Sem DB / API / UI no v1
- Proxies: interface pronta, ligada só se `PROXY_ENABLED=true`

## Default

`STRATEGY=directLink` — visita `TARGET_URLS` em loop. Sem espera entre iterações (`INTERVAL_*=0`).

`dryRun` permanece disponível como opt-in (`npm run start:dry`).

## Chromium — quando é necessário?

| Strategy | Precisa de browser? |
|----------|---------------------|
| `directLink` (default) | **Sim** — Chromium do Puppeteer ou `CHROME_EXECUTABLE_PATH` |
| `dryRun` | **Não** |

```bash
npm run browsers:install
```

## Objetivo

Base limpa, modular, configurável por `.env`, fácil de rodar em macOS / Linux / Windows.
