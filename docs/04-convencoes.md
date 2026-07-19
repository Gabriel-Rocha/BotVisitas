# Convenções

## Código

- CommonJS (`require` / `module.exports`)
- Uma strategy = um arquivo + registro em `strategies/index.js`
- Timeouts sempre finitos
- Sleep via `utils/sleep` (nunca `page.waitForTimeout`)

## Config

- Secrets só em `.env`
- Listas grandes em `src/data/*.json`
- Default seguro: `STRATEGY=dryRun`

## Proxies

- Só via `src/core/proxy.js` + env
- Não espalhar `--proxy-server` em outros arquivos

## Multi-device / colaboradores

- Sem paths absolutos de um único SO
- Documentar mudanças no checklist
- README é o onboarding

## Idioma

- Respostas e docs do time em português
