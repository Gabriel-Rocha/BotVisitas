# Arquitetura (v1 rebuild)

## Árvore

```
BotVisitas/
├── docs/
├── config/                 # overrides locais (opcional)
├── logs/                   # gitignored
├── scripts/
│   └── start.sh
├── src/
│   ├── index.js            # entrypoint
│   ├── config/index.js
│   ├── core/
│   │   ├── browser.js
│   │   ├── session.js
│   │   ├── loop.js
│   │   └── proxy.js
│   ├── strategies/
│   │   ├── index.js        # registry
│   │   ├── directLink.js   # DEFAULT
│   │   └── dryRun.js       # opt-in
│   ├── data/
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
              browser.launch (proxy se enabled)
                         ↓
              session → strategy.run(page, ctx)
                         ↓
              sleep (se INTERVAL > 0) → restart browser se necessário → repeat
```

## Contrato de strategy

```js
module.exports = {
  name: 'directLink',
  requiresBrowser: true, // false = loop não lança Chromium
  async run(page, { config, logger }) {
    return { ok: true, meta: {} };
  },
};
```

## Multi-dispositivo

- Config só via env (sem paths absolutos de um SO)
- Browser só se `requiresBrowser: true`
- `CHROME_EXECUTABLE_PATH` opcional
- `npm start` em qualquer OS com Node >= 18
