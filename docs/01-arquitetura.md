# Arquitetura (v1 rebuild)

## Árvore

```
BotVisitas/
├── Dockerfile              # imagem Node + Chromium
├── docker-compose.yml      # forma padrão de execução
├── .dockerignore
├── docs/
├── config/                 # overrides locais (opcional)
├── logs/                   # gitignored (volume no Docker)
├── scripts/
│   └── start.sh            # atalho → docker compose up
├── web/                    # React + Vite (dashboard)
├── src/
│   ├── index.js            # CLI entrypoint
│   ├── dashboard/          # Express API + botRuntime
│   ├── db/                 # Postgres (pool, schema, runs, logQueue)
│   ├── app/runBot.js       # sessão reutilizável
│   ├── config/index.js
│   ├── core/
│   │   ├── browser.js
│   │   ├── session.js
│   │   ├── worker.js       # 1 Chromium + 1 proxy + 1 device profile
│   │   ├── loop.js         # orquestra N workers / DEVICE_MIX
│   │   ├── devices.js      # parse mix + personas
│   │   └── proxy.js        # lease exclusivo (máx. 10)
│   ├── strategies/
│   │   ├── index.js        # registry
│   │   ├── dryRun.js       # DEFAULT
│   │   └── directLink.js   # desligado por default
│   ├── data/
│   │   ├── device-profiles.json
│   │   ├── user-agents.json
│   │   └── referrers.json
│   └── utils/
│       ├── logger.js
│       ├── random.js
│       └── sleep.js
├── .env.example
├── package.json
└── README.md
```

## Fluxo

```
index → loadConfig → resolveStrategy → createLoop
                         ↓
              browser.launch (proxy stub se enabled)
                         ↓
              session → strategy.run(page, ctx)
                         ↓
              sleep → restart browser se necessário → repeat
```

## Contrato de strategy

```js
module.exports = {
  name: 'dryRun',
  requiresBrowser: false, // false = loop não lança Chromium
  async run(page, { config, logger }) {
    return { ok: true, meta: {} };
  },
};
```

## Multi-dispositivo (agentes)

Cada worker é um agente com perfil fixo (`desktop` | `mobile` | `tablet`):
viewport + UA + `isMobile`/`hasTouch` coerentes ([`src/data/device-profiles.json`](../src/data/device-profiles.json)).

```env
# Vazio = N workers desktop (usa CONCURRENCY)
DEVICE_MIX=desktop:2,mobile:2,tablet:1
```

- Se `DEVICE_MIX` estiver setado, a **soma manda** (CONCURRENCY é fallback).
- Com proxy, o pool (máx. 10) pode truncar o mix.
- Sem proxy + browser: força 1 worker (mesmo IP).
- Dashboard mostra badge de device por worker.

Também:
- Config só via env (sem paths absolutos de um SO)
- Browser só se `requiresBrowser: true`
- `CHROME_EXECUTABLE_PATH` opcional
- `npm start` em qualquer OS com Node >= 18
