# Convenções

## Código

- CommonJS (`require` / `module.exports`)
- Uma strategy = um arquivo + registro em `strategies/index.js`
- Timeouts sempre finitos
- Sleep via `utils/sleep` (nunca `page.waitForTimeout`)

## Config

- Secrets só em `.env`
- Listas grandes em `src/data/*.json`
- Default: `STRATEGY=directLink`
- Stealth ligado; identidade persistente (não trocar UA a cada request)


## Proxies

- Só via `src/core/proxy.js` + env
- Não espalhar `--proxy-server` em outros arquivos
- Endpoint de proxy fica preso à identidade da sessão


## Multi-device / colaboradores

- Sem paths absolutos de um único SO
- Documentar mudanças no checklist
- README é o onboarding

## Idioma

- Respostas e docs do time em português
