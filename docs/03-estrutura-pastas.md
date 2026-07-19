# Estrutura de pastas

```
BotVisitas/
├── .cursor/rules/consultar-docs.mdc
├── docs/                      # contexto enxuto
├── config/                    # overrides locais (opcional)
├── logs/                      # runtime (gitignored)
├── scripts/start.sh
├── src/
│   ├── index.js
│   ├── config/index.js
│   ├── core/{browser,session,loop,proxy}.js
│   ├── strategies/{index,dryRun,directLink}.js
│   ├── data/{user-agents,referrers}.json
│   └── utils/{logger,random,sleep}.js
├── .env.example
├── package.json
└── README.md
```

Nova pasta só com atualização deste arquivo + checklist + arquitetura.
