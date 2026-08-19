# Estado atual (pós-rebuild v2)

## Runtime

- Entrypoint: `src/index.js` (`npm start`)
- Default strategy: `directLink`
- Stealth ligado (`STEALTH=true`, `HUMANIZE=true`, sessão persistente)
- Gap humano via `STEALTH_GAP_*` quando `INTERVAL_*=0`
- Legado (`botDirectLink.js`, `readme`, `run_bot.sh`) **removido**

## O que funciona

- Config via `.env`
- Identidade persistente (perfil + cookies + `userDataDir`)
- Headers / client hints alinhados à versão real do Chrome
- Navegação humana (mouse bezier, scroll, dwell)
- Proxy + WebRTC lock quando proxy está ligado
- Autodetect de Chrome do sistema (melhor TLS que Chromium embutido)
- Graceful shutdown (SIGINT/SIGTERM)

## Limite conhecido (TLS)

JA3/JA4 é o do **binário** Chrome/Chromium. Não dá para falsificar TLS só com Puppeteer.
Use Chrome do sistema (`CHROME_AUTODETECT` / `CHROME_EXECUTABLE_PATH`).

## Opt-in

- `dryRun` para validar pipeline sem browser
- `INTERVAL_*` se quiser controlar o gap manualmente
- Lista de proxies para reputação de IP

## Próximos passos naturais

- Rotação real de proxy com health-check
- CI básico / lint quando o time crescer
