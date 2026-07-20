# Docker — BotVisitas

Forma **padrão** de rodar o projeto: sempre no container.

## Pré-requisitos

- Docker + Docker Compose v2
- Arquivo `.env` na raiz (`cp .env.example .env`)

## Subir

```bash
cp .env.example .env   # se ainda não tiver
docker compose up -d --build
# Dashboard: http://localhost:3847
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
| Entrypoint | `node src/dashboard/server.js` (API + UI) |
| Porta | `3847` |
| Logs | volume `./logs` → `/app/logs` |
| Restart | `unless-stopped` |
| shm | 2 GB (evita crash do Chrome) |

`PUPPETEER_SKIP_DOWNLOAD=true` — não baixa Chromium do Puppeteer no build.

## Config

Tudo via `.env` (montado pelo Compose). Overrides fixos no compose:

- `CHROME_EXECUTABLE_PATH=/usr/bin/chromium`
- `HEADLESS=true`

## Fluxo de teste (um comando só)

```bash
docker compose up --build
# Dashboard: http://localhost:3847 → Start
# Página alvo:   http://localhost:3000  (também via host.docker.internal:3000)
```

O `.env` controla o alvo:

```env
TARGET_URLS=http://host.docker.internal:3000
CLICK_SELECTOR="#cta"
```

Quando tiver suas páginas, só troca:

```env
TARGET_URLS=https://seu-dominio.com/pagina
CLICK_SELECTOR="#seu-botao"
```

A `testpage` no Compose só **serve** algo em `:3000` para o link local ser válido. Sem ela (ou sem outro servidor na 3000), dá `CONNECTION_REFUSED`.

A imagem instala Chromium em `/usr/bin/chromium` (`PUPPETEER_SKIP_DOWNLOAD=true`).
Se o log disser "Could not find Chrome" / "embutido do Puppeteer", o path não foi aplicado:

```env
CHROME_EXECUTABLE_PATH=/usr/bin/chromium
```

Rebuild: `docker compose up --build`. O log deve mostrar `Usando browser do sistema: /usr/bin/chromium`.

Se o log mostrar `Dashboard em http://127.0.0.1:3847`, a UI **não** abre no host.
O processo precisa escutar em `0.0.0.0` (Compose já define `DASHBOARD_HOST=0.0.0.0`).

```bash
docker compose up --build
# abra http://localhost:3847
```

## Comandos úteis

```bash
docker compose ps
docker compose restart bot
docker compose up -d --build --force-recreate
docker compose exec bot node -e "console.log('ok')"
```

## Teste com proxy ativo

Proxies Webshare são **remotos**: não alcançam `host.docker.internal:3000` (seu Mac).

| Alvo | Com proxy? |
|------|------------|
| `http://host.docker.internal:3000` (local) | Não — CONNECTION_REFUSED |
| `http://ipv4.webshare.io/` (check de IP) | Sim — smoke test |
| `https://seu-dominio.com/...` (página pública sua) | Sim — fluxo real |

```env
PROXY_ENABLED=true
CONCURRENCY=2
TARGET_URLS=http://ipv4.webshare.io/
CLICK_SELECTOR=
```

No log: `Proxy adquirido: IP:porta` e `Resposta: status=200`.

## Não fazer

- Não commitar `.env`
- Não rodar headed no container de produção (sem display)
- Não apontar `TARGET_URLS` para infra de terceiros (cláusula pétrea)
