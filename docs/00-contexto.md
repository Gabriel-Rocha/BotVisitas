# Contexto do projeto

## O que é

Bot Node.js + Puppeteer para automatizar visitas/cliques em smartlinks de ads.
Projeto pensado para **vários colaboradores** e execução em **vários dispositivos**.

## Stack (v1 rebuild)

- Node.js + **CommonJS**
- puppeteer + puppeteer-extra + stealth
- dotenv (config)
- Sem DB / API / UI no v1
- Proxies: lista via env; o endpoint fica preso à identidade da sessão
- Stealth: identidade persistente, headers, timing humano, fingerprint JS, Chrome real para TLS

## Default

`STRATEGY=directLink` — visita `TARGET_URLS` em loop, com stealth.

`dryRun` permanece disponível como opt-in (`npm run start:dry`).

## Chromium — quando é necessário?

| Strategy | Precisa de browser? |
|----------|---------------------|
| `directLink` (default) | **Sim** — Chrome do sistema (preferível) ou Chromium do Puppeteer |
| `dryRun` | **Não** |

```bash
npm run browsers:install
```

## Objetivo

Base limpa, modular, configurável por `.env`, fácil de rodar em macOS / Linux / Windows.
