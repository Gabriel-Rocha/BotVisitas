# Arquitetura (v1 rebuild)

## Árvore

```
BotVisitas/
├── Dockerfile              # imagem Node + Chromium
├── docker-compose.yml      # forma padrão de execução
├── .dockerignore
├── docs/
├── config/                 # overrides locais (opcional)
├── logs/                   # gitignored (inclui sessão Chrome)
├── scripts/
│   ├── start.sh
│   └── smoke-stealth.js
├── src/
│   ├── index.js            # CLI entrypoint
│   ├── dashboard/          # Express API + botRuntime
│   ├── db/                 # Postgres (pool, schema, runs, logQueue)
│   ├── app/runBot.js       # sessão reutilizável
│   ├── config/index.js
│   ├── core/
│   │   ├── browser.js
│   │   ├── session.js
│   │   ├── loop.js
│   │   ├── proxy.js
│   │   ├── identity.js     # visitante (fingerprint coerente)
│   │   ├── stealth.js      # headers, JS, flags, TLS via Chrome
│   │   └── human.js        # mouse/scroll/dwell
│   ├── strategies/
│   │   ├── index.js
│   │   ├── directLink.js   # DEFAULT
│   │   └── dryRun.js
│   ├── data/
│   │   ├── browser-profiles.json
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
              browser.launch (Chrome + stealth flags)
                         ↓
              a cada visita: visitante novo (contexto anônimo)
                         ↓
              identity + proxy + fingerprint + cookies zerados
                         ↓
              strategy.run (navegação humana)
                         ↓
              fecha contexto → gap irregular → repeat
```

## Contrato de strategy

```js
module.exports = {
  name: 'directLink',
  requiresBrowser: true,
  async run(page, { config, logger, identity }) {
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
- `CHROME_EXECUTABLE_PATH` opcional; autodetect ligado por default
- `npm start` em qualquer OS com Node >= 18
