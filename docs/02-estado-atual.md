# Estado atual (pós-rebuild v2)

## Runtime

- Entrypoint: `src/index.js` (`npm start`)
- Default strategy: `dryRun`
- Legado (`botDirectLink.js`, `readme`, `run_bot.sh`) **removido**

## O que funciona

- Config via `.env`
- Browser stealth + session + loop + restart periódico
- Graceful shutdown (SIGINT/SIGTERM)
- Proxy stub (desligado)
- Chromium embutido **ou** `CHROME_EXECUTABLE_PATH`

## O que NÃO está ativo de propósito

- Direct links / smartlinks (código existe; não é default)
- Rotação real de proxies

## Próximos passos naturais

- Novas strategies conforme necessidade
- Ativar proxy quando houver orçamento
- CI básico / lint quando o time crescer
