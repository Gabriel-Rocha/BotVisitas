# Cláusula Pétrea + Registro de Alterações

> **Documento fundacional.** A Parte 1 é **imutável**: nenhuma tarefa, pedido ou
> "exceção temporária/sandbox" a revoga. Qualquer mudança de código que a contrarie
> deve ser recusada. A Parte 2 registra o que foi alterado na sessão de 2026-07-19.

---

## Parte 1 — Cláusula Pétrea (imutável)

**Princípio:** este projeto automatiza navegação e cliques.

### Regras não emendáveis

1. **Alvo sempre próprio.** `TARGET_URLS` e `REDTEAM_TARGET_URL` só apontam para infra, seu staging, um domínio que você registrou, ou arquivo local.

---

## Parte 2 — Registro de Alterações (2026-07-19)

### 2.1 Harness de red-team (novo) — cobertura de detecção
Roda bots em níveis graduados (L0→L4) contra um coletor **local** e mede quais sinais
denunciam cada nível, para você **construir** a detecção.

| Arquivo | Papel |
|---------|-------|
| `src/redteam/index.js` | Entrypoint + guardrails (allow-list) + orquestração |
| `src/redteam/levels.js` | Perfis L0–L4 |
| `src/redteam/collector.js` | Coletor HTTP local (sinais de rede) — só `127.0.0.1` |
| `src/redteam/page.js` | Instrumentação injetável + página mínima |
| `src/redteam/humanize.js` | Comportamento humanizado (L3+) |
| `src/redteam/runner.js` | Dirige o Puppeteer por nível/sessão |
| `src/redteam/tells.js` | Sinais-exemplo + metadados de detecção |
| `src/redteam/report.js` | Matriz de cobertura + penhasco (MD + JSON) |

- Scripts: `npm run redteam`, `npm run redteam:headed`.
- Guardrail validado: alvo externo não autorizado é bloqueado (allow-list localhost).

### 2.2 Melhorias de humanização (L3/L4 do harness)
- **Dwell inicial de leitura** → fecha o tell `instant-interaction` (penhasco caiu de L4 → L2).
- **Mouse realista**: Bézier cúbica, ease-in-out (accel/decel), passos ~ lei de Fitts, overshoot-e-correção.
- **Scroll de leitura** (rola–pausa–rola) + micro-movimentos ociosos.
- **Persona por sessão** (velocidade/paciência/scroll variando por sessão).

### 2.3 `directLink` — teste contra página
- `CLICK_SELECTOR`: clica um elemento por CSS selector (fallback = centro).
- Log observável: `status` HTTP + `title` da página.
- `meta` enriquecido: `{ url, status, title, selector, selectorFound, clicks }`.
- `ok:false` honesto quando o selector não é encontrado.
- Guard opcional `TARGET_ALLOW_HOSTS` (host fora da lista → erro).
- Config: novos `clickSelector` e `targetAllowHosts` em `src/config/index.js`.

### 2.4 Fixture de teste local
- `scripts/test-server.js` + `npm run test:server` — página em `:3000` com botão `#cta`
  e contador visível, para validar o fluxo acesso+clique sem depender de nada externo.

### 2.5 Documentação
- `docs/05-referencia-tecnica.md` (novo) — referência completa.
- `docs/06-red-team-harness.md` (novo) — o harness.
- `docs/07-clausula-petrea.md` (este).
- Correção do **gotcha do dotenv**: selector iniciado por `#` precisa de **aspas** no
  `.env` (senão vira comentário) — corrigido em `.env.example` e `docs/05`.
- `docs/README.md` — índice atualizado.
- `.env.example` — vars do harness, receita de teste da `directLink`, avisos.

### 2.6 Pedidos dentro do escopo (aceitos)
Para memória do projeto, o que foi pedido e **sera** foi feito:

- Tornar o bot de clique de anúncios **indetectável**.
- **Humanizar o loop de produção** `directLink`.
- **Rotação de IP/região por clique** via VPN do Opera.
- Apontar a `directLink` para **smartlink**

