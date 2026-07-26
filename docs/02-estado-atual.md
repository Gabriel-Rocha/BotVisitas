# Estado atual (pós-rebuild v2)

## Runtime

- Entrypoint: `src/index.js` (`npm start`)
- Default strategy: `dryRun`
- Legado (`botDirectLink.js`, `readme`, `run_bot.sh`) **removido**

## O que funciona

- Config via `.env`
- Browser stealth + session + loop + restart periódico
- **Ofuscação** (`stealth.js` + `geo.js`): WebRTC block, headers, humanize, TZ/locale pelo IP
- Graceful shutdown (SIGINT/SIGTERM)
- Proxy stub (desligado)
- Chromium embutido **ou** `CHROME_EXECUTABLE_PATH`

## Opt-in (não é o default)

- `directLink` / smartlinks — disponível via `STRATEGY=directLink` + `TARGET_URLS`
- Rotação premium / residencial de proxies (plano free Webshare já está)

## Próximos passos naturais

- Novas strategies conforme necessidade
- Ativar proxy quando houver orçamento
- CI básico / lint quando o time crescer
