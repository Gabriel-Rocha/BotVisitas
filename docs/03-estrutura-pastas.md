# Estrutura de pastas

```
BotVisitas/
├── .cursor/rules/consultar-docs.mdc
├── docs/                      # contexto enxuto
├── config/                    # overrides locais (opcional)
├── logs/                      # runtime + sessão Chrome (gitignored)
├── scripts/{start.sh,smoke-stealth.js}
├── src/
│   ├── index.js
│   ├── config/index.js
│   ├── core/{browser,session,loop,proxy,identity,stealth,human}.js
│   ├── strategies/{index,dryRun,directLink}.js
│   ├── data/{browser-profiles,user-agents,referrers}.json
│   └── utils/{logger,random,sleep}.js
├── .env.example
├── package.json
└── README.md
```

Nova pasta só com atualização deste arquivo + checklist + arquitetura.
