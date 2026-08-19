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
| Porta | `3847` (dashboard); sandbox interna `testpage:3000` |
| Postgres | serviço `db` (`postgres:16-alpine`) + volume `botvisitas_pg_data` |
| Logs | volume `./logs` → `/app/logs` |
| Restart | `unless-stopped` |
| shm | 2 GB (evita crash do Chrome) |

`PUPPETEER_SKIP_DOWNLOAD=true` — não baixa Chromium do Puppeteer no build.

O Compose sobe **db → bot** (healthcheck `pg_isready`). `docker compose down` **não** apaga o volume; use `docker compose down -v` só se quiser zerar o histórico.

## Config

Tudo via `.env` (montado pelo Compose). Overrides fixos no compose:

- `CHROME_EXECUTABLE_PATH=/usr/bin/chromium`
- `HEADLESS=true`
- `DASHBOARD_HOST=0.0.0.0`
- `TESTPAGE_PORT=0` (porta livre no host; o bot usa `http://testpage:3000` na rede Compose)
- `DATABASE_URL` interno apontando para o host `db` (senha vem de `POSTGRES_PASSWORD` no `.env`)

Variáveis do Postgres (obrigatório no `.env`, **nunca** no Git): `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `DATABASE_URL` (local), `SNAPSHOT_INTERVAL_SEC`.
Sem `POSTGRES_PASSWORD` no `.env`, o Compose falha de propósito.

## Fluxo de teste (um comando só)

```bash
docker compose up --build
# Dashboard: http://localhost:3847 → Start
# Sandbox interna: http://testpage:3000  (rede Compose; não depende da 3000 do host)
# Porta no host: docker compose port testpage 3000
```

O `.env` controla o alvo:

```env
TARGET_URLS=http://testpage:3000
BROWSE_PAGES_MIN=0
BROWSE_PAGES_MAX=1
```

Quando tiver suas páginas, só troca:

```env
TARGET_URLS=https://seu-dominio.com/
BROWSE_PAGES_MIN=1
BROWSE_PAGES_MAX=3
```

A `testpage` no Compose serve a sandbox em `:3000` **dentro da rede** (`http://testpage:3000`). No host a porta é `${TESTPAGE_PORT:-0}`: `0` faz o Docker escolher uma porta livre, para não derrubar o stack se a 3000 do Windows/Mac já estiver ocupada. Sem a `testpage` (e sem outro alvo em `TARGET_URLS`), dá `CONNECTION_REFUSED`.

A imagem instala Chromium em `/usr/bin/chromium` (`PUPPETEER_SKIP_DOWNLOAD=true`).
Se o log disser "Could not find Chrome" / "embutido do Puppeteer", o path não foi aplicado:

```env
CHROME_EXECUTABLE_PATH=/usr/bin/chromium
```

Rebuild: `docker compose up --build`. O log deve mostrar `Usando browser do sistema: /usr/bin/chromium`.

O log `Rodando nesse link aqui: http://localhost:3847` é o endereço para abrir no navegador do host.
Se o bind for só `127.0.0.1`, a UI **não** abre no host — o processo precisa escutar em `0.0.0.0` (Compose já define `DASHBOARD_HOST=0.0.0.0`).

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

Proxies Webshare são **remotos**: não alcançam `http://testpage:3000` nem `host.docker.internal`.

| Alvo | Com proxy? |
|------|------------|
| `http://testpage:3000` (sandbox Compose) | Não — CONNECTION_REFUSED |
| `http://ipv4.webshare.io/` (check de IP) | Sim — smoke test |
| `https://seu-dominio.com/...` (página pública sua) | Sim — fluxo real |

```env
PROXY_ENABLED=true
CONCURRENCY=2
TARGET_URLS=http://ipv4.webshare.io/
BROWSE_PAGES_MIN=0
BROWSE_PAGES_MAX=0
```

No log: `Proxy adquirido: IP:porta` e `Resposta: status=200`.

## Não fazer

- Não commitar `.env`
- Não rodar headed no container de produção (sem display)
