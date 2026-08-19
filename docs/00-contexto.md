# Contexto do projeto

## O que é

Bot Node.js + Puppeteer para automatizar visitas/cliques em smartlinks de ads.
Projeto pensado para **vários colaboradores** e execução em **vários dispositivos**.

## Stack (v1 rebuild)

- Node.js + **CommonJS**
- puppeteer + puppeteer-extra + stealth
- dotenv (config)
- Sem DB / API / UI no v1
- Proxies: lista via env; rodízio por visitante (ou preso à sessão se `SESSION_PERSIST=true`)
- Stealth: visitante novo a cada visita, headers, timing humano, fingerprint JS, Chrome real para TLS

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

## Ofuscação (crítico)

Todo acesso a links deve parecer visita humana: sem sinais óbvios de bot e sem
expor uso de proxy/VPN. Ver [`11-ofuscacao.md`](./11-ofuscacao.md) e a cláusula
pétrea #2 em [`07-clausula-petrea.md`](./07-clausula-petrea.md).
