# Arquitetura (v1 rebuild)

## Árvore

```
BotVisitas/
├── docs/
├── config/                 # overrides locais (opcional)
├── logs/                   # gitignored (inclui sessão Chrome)
├── scripts/
│   ├── start.sh
│   └── smoke-stealth.js
├── src/
│   ├── index.js            # entrypoint
│   ├── config/index.js
│   ├── core/
│   │   ├── browser.js
│   │   ├── session.js
│   │   ├── loop.js
│   │   ├── proxy.js
│   │   ├── identity.js     # perfil + cookies persistentes
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
              identity (load or create)
                         ↓
              browser.launch (Chrome + stealth flags + proxy)
                         ↓
              session (headers, CDP UA, cookies, JS fingerprint)
                         ↓
              strategy.run (navegação humana)
                         ↓
              persist cookies → gap irregular → repeat
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

## Multi-dispositivo

- Config só via env (sem paths absolutos de um SO)
- Browser só se `requiresBrowser: true`
- `CHROME_EXECUTABLE_PATH` opcional; autodetect ligado por default
- `npm start` em qualquer OS com Node >= 18
