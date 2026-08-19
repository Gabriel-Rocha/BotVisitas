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
- Stealth ligado; cada visita = visitante inteiro novo (não misturar UA/IP/cookies)


## Proxies

- Só via `src/core/proxy.js` + env
- Não espalhar `--proxy-server` em outros arquivos
- Sem persistência, proxy em rodízio por visitante; com persistência, preso à sessão


## Ofuscação

- Só via `src/core/stealth.js` (+ plugin stealth no `browser.js`)
- Visita deve parecer humana — ver [`11-ofuscacao.md`](./11-ofuscacao.md)
- Não remover bloqueio WebRTC / patches sem decisão documentada

## Multi-device / colaboradores

- Sem paths absolutos de um único SO
- Documentar mudanças no checklist
- README é o onboarding

## Idioma

- Respostas e docs do time em português
