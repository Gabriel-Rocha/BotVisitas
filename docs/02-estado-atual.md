# Estado atual (pós-rebuild v2)

## Runtime

- Entrypoint: `src/index.js` (`npm start`)
- Default strategy: `directLink`
- Stealth ligado (`STEALTH=true`, `HUMANIZE=true`)
- Default: **visitante novo a cada visita** (`SESSION_PERSIST=false`)
- Gap humano via `STEALTH_GAP_*` quando `INTERVAL_*=0`
- Legado (`botDirectLink.js`, `readme`, `run_bot.sh`) **removido**

## O que funciona

- Config via `.env`
- Contexto anônimo por visita (cookies isolados)
- Fingerprint coerente dentro da visita (UA, viewport, WebGL, proxy juntos)
- Headers / client hints alinhados à versão real do Chrome
- Navegação humana (mouse bezier, scroll, dwell)
- Proxy em rodízio por visitante + WebRTC lock
- Autodetect de Chrome do sistema (melhor TLS que Chromium embutido)
- Graceful shutdown (SIGINT/SIGTERM)

## Limite conhecido (TLS)

JA3/JA4 é o do **binário** Chrome/Chromium. Não dá para falsificar TLS só com Puppeteer.
Use Chrome do sistema (`CHROME_AUTODETECT` / `CHROME_EXECUTABLE_PATH`).

## Opt-in

- `dryRun` para validar pipeline sem browser
- `SESSION_PERSIST=true` para um único usuário (debug)
- `INTERVAL_*` se quiser controlar o gap manualmente
- Lista de proxies para reputação de IP

## Próximos passos naturais

- Health-check de proxy
- CI básico / lint quando o time crescer
