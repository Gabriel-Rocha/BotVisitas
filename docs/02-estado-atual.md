# Estado atual (pós-rebuild v2)

## Runtime

- Entrypoint: `src/index.js` (`npm start`)
- Default strategy: `directLink`
- Sem espera entre iterações (`INTERVAL_MIN_SEC=0` / `INTERVAL_MAX_SEC=0`)
- Sem restart periódico do browser (`BROWSER_RESTART_EVERY=0`)
- Legado (`botDirectLink.js`, `readme`, `run_bot.sh`) **removido**

## O que funciona

- Config via `.env`
- Browser stealth + session + loop
- Graceful shutdown (SIGINT/SIGTERM)
- Proxy via env (`PROXY_ENABLED` / `PROXY_SERVER`)
- Chromium embutido **ou** `CHROME_EXECUTABLE_PATH`

## Opt-in

- `dryRun` para validar pipeline sem browser
- Intervalo / restart do browser se quiser configurar no `.env`

## Próximos passos naturais

- Novas strategies conforme necessidade
- Rotação real de proxy quando necessário
- CI básico / lint quando o time crescer
