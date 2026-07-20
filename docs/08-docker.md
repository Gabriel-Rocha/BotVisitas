# Docker — BotVisitas

Forma **padrão** de rodar o projeto: sempre no container.

## Pré-requisitos

- Docker + Docker Compose v2
- Arquivo `.env` na raiz (`cp .env.example .env`)

## Subir

```bash
cp .env.example .env   # se ainda não tiver
docker compose up -d --build
docker compose logs -f bot
```

Atalhos npm:

```bash
npm run docker:up      # build + sobe em background
npm run docker:logs    # acompanha logs
npm run docker:down    # para e remove o container
```

## O que a imagem faz

| Item | Valor |
|------|--------|
| Base | `node:20-bookworm-slim` |
| Browser | Chromium do Debian (`/usr/bin/chromium`) |
| User | `bot` (não-root) |
| Entrypoint | `npm start` → `src/index.js` |
| Logs | volume `./logs` → `/app/logs` |
| Restart | `unless-stopped` |
| shm | 2 GB (evita crash do Chrome) |

`PUPPETEER_SKIP_DOWNLOAD=true` — não baixa Chromium do Puppeteer no build.

## Config

Tudo via `.env` (montado pelo Compose). Overrides fixos no compose:

- `CHROME_EXECUTABLE_PATH=/usr/bin/chromium`
- `HEADLESS=true`

## Alvo no host (test-server)

Se o alvo roda na máquina host (`npm run test:server`):

```env
STRATEGY=directLink
TARGET_URLS=http://host.docker.internal:3000
CLICK_SELECTOR="#cta"
INCLUDE_REFERRER=false
```

`extra_hosts: host.docker.internal:host-gateway` já está no compose (Mac/Windows/Linux).

## Comandos úteis

```bash
docker compose ps
docker compose restart bot
docker compose up -d --build --force-recreate
docker compose exec bot node -e "console.log('ok')"
```

## Não fazer

- Não commitar `.env`
- Não rodar headed no container de produção (sem display)
- Não apontar `TARGET_URLS` para infra de terceiros (cláusula pétrea)
