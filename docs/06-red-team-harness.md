# Harness de Red-Team — Cobertura de Detecção

Ferramenta de teste **defensivo** e **autorizado**: mede quão bem uma detecção de
bots consegue distinguir tráfego automatizado de humano, rodando bots em **níveis
graduados de sofisticação** contra um alvo que **você controla** e coletando, por
sessão, os sinais que um detector inspecionaria.

> ⚠️ **O objetivo NÃO é ser indetectável.** É o oposto: descobrir em qual nível a sua
> detecção começa a falhar, para fechar a lacuna. O harness não é feito para rodar
> contra propriedades de terceiros — o alvo default é `localhost` e todo request
> carrega o header `X-RedTeam-Run-Id` (tráfego identificável, não furtivo).

## Autorização (leia antes de rodar)

- Use **somente** contra infraestrutura que você possui/opera e está **autorizado** a
  testar (seu staging, seu localhost).
- Não use para gerar cliques/visitas em anúncios ou sites de terceiros — isso é fraude,
  não teste de segurança.
- A allow-list (`localhost`/`127.0.0.1`/`::1` por default) bloqueia alvos externos por
  acidente. Ampliar via `REDTEAM_ALLOW_HOSTS` é uma decisão consciente de quem tem
  autorização.

## Como funciona

```
npm run redteam
   │
   ├─ sobe um COLETOR local (staging) que serve uma página com um alvo clicável
   │  e grava os sinais de REDE de cada sessão (headers, ordem, client hints)
   │
   ├─ para cada NÍVEL (L0→L4) × N sessões:
   │     lança o browser com o perfil do nível (stealth on/off, UA, comportamento)
   │     injeta a instrumentação (fingerprint + comportamento) via evaluateOnNewDocument
   │     dirige a interação (clique DOM / teleporte / humanizado)
   │     lê o snapshot de sinais da sessão
   │
   └─ gera um RELATÓRIO: matriz `tell × nível` + "penhasco de detecção"
```

Nada sai da máquina: o coletor escuta só em `127.0.0.1` e os sinais de cliente são
lidos localmente via `page.evaluate`.

## Níveis de sofisticação

| Nível | Nome | O que faz | Sinais que exercita |
|-------|------|-----------|---------------------|
| **L0** | Naïve | headless puro, sem stealth, clique via DOM (zero ponteiro) | flag de automação, UA headless, sem comportamento |
| **L1** | Higiene | UA real, viewport, Accept-Language; sem patches | consistência UA↔fingerprint, headers |
| **L2** | Stealth | `puppeteer-extra-stealth` (nível atual do projeto) | patches de automação, `window.chrome`, WebGL |
| **L3** | Comportamento | stealth + mouse curvado, scroll, dwell, timing randômico | entropia comportamental, trajetória, tempo até 1ª interação |
| **L4** | Distribuído | L3 + fingerprint variado por sessão | correlação entre sessões *(IP diversity = hook)* |

A ideia é que os sinais de **fingerprint** somem cedo (≈L2) enquanto os de
**comportamento** sobrevivem até L3 — mostrando onde investir a detecção.

## Rodando

```bash
npm install            # se ainda não instalou
npm run redteam        # sweep completo, headless, coletor local
npm run redteam:headed # com janela, para observar o comportamento
```

Config por `.env` (todas opcionais):

| Variável | Default | Descrição |
|----------|---------|-----------|
| `REDTEAM_SESSIONS_PER_LEVEL` | `3` | Sessões por nível |
| `REDTEAM_LEVELS` | *(todos)* | Subconjunto, ex.: `L0,L2,L3` |
| `REDTEAM_PORT` | `0` | Porta do coletor (`0` = automática) |
| `REDTEAM_TARGET_URL` | *(vazio)* | Alvo externo autorizado; vazio = coletor local |
| `REDTEAM_ALLOW_HOSTS` | *(vazio)* | Hosts extra além de localhost |
| `HEADLESS` | `true` | Compartilhado com o bot principal |

Exemplos:

```bash
# Só os extremos, 5 sessões cada
REDTEAM_LEVELS=L0,L4 REDTEAM_SESSIONS_PER_LEVEL=5 npm run redteam

# Contra um staging seu (host precisa estar autorizado)
REDTEAM_TARGET_URL=http://staging.local:8080 REDTEAM_ALLOW_HOSTS=staging.local npm run redteam
```

> Modo alvo externo: como não controlamos o servidor do alvo, os sinais de **rede**
> server-side ficam indisponíveis; os de **cliente** continuam (a instrumentação é
> injetada na página). Para staging, o ideal é servir a própria página ou embutir a
> instrumentação.

## Lendo o relatório

Saída em `logs/redteam/` (gitignored):

- `detection-coverage-<timestamp>.md` — legível: matriz e penhasco.
- `detection-coverage-<timestamp>.json` — bruto: todos os snapshots para calibrar limiares.

**Matriz de cobertura** — para cada *tell* (sinal-exemplo) e nível, a fração de sessões
em que o sinal denunciou o bot. `·` = não disparou.

**Penhasco de detecção** — o nível **mais alto** em que o sinal ainda aparece. Sinais
com penhasco baixo (só L0) são frágeis; os que sobrevivem até L3/L4 são os mais
valiosos para a detecção.

## Dos sinais à detecção

Cada tell no relatório traz `signal` (o que medir) e `detect` (regra sugerida). Fluxo:

1. Priorize tells que sobrevivem até **L3/L4** — pegam bots sofisticados.
2. **Combine camadas** (fingerprint + behavior + network): um L4 pode limpar o
   fingerprint mas ainda falhar em entropia comportamental.
3. Calibre limiares no JSON bruto (`mousePathLength`, `firstInteractionMs`, …) contra
   tráfego **humano real** do seu staging.
4. Implemente a detecção e **rode de novo** para medir a nova cobertura.

## Estrutura do código

```
src/redteam/
├── index.js       # entrypoint + guardrails (allow-list) + orquestração
├── levels.js      # perfis L0–L4
├── collector.js   # coletor HTTP local (sinais de rede) — só 127.0.0.1
├── page.js        # instrumentação injetável + página mínima do alvo
├── humanize.js    # mouse curvado / scroll / dwell (L3+)
├── runner.js      # dirige o Puppeteer por nível/sessão
├── tells.js       # sinais-exemplo + metadados de detecção
└── report.js      # matriz de cobertura + penhasco (MD + JSON)
```

Isolado das *strategies* de produção — é um harness de teste, não um modo do bot.
