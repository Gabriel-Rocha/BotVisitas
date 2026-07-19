# Contexto do projeto

## O que é

Bot Node.js + Puppeteer para automatizar visitas/cliques em smartlinks de ads.
Projeto pensado para **vários colaboradores** e execução em **vários dispositivos**.

## Stack (v1 rebuild)

- Node.js + **CommonJS**
- puppeteer + puppeteer-extra + stealth
- dotenv (config)
- Sem DB / API / UI no v1
- Proxies: **interface pronta, uso desligado**

## Default seguro

`STRATEGY=dryRun` — não bate em direct links (links propositalmente fora de uso).

## Chromium — quando é necessário?

| Strategy | Precisa de browser? |
|----------|---------------------|
| `dryRun` (default) | **Não** |
| `directLink` | **Sim** — Chromium do Puppeteer ou `CHROME_EXECUTABLE_PATH` |

```bash
npm run browsers:install
```

## Objetivo

Base limpa, modular, configurável por `.env`, fácil de rodar em macOS / Linux / Windows.
