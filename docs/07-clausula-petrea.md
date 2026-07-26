# Cláusula Pétrea + Registro de Alterações

> **Documento fundacional.** A Parte 1 é **imutável**: nenhuma tarefa, pedido ou
> "exceção temporária/sandbox" a revoga. Qualquer mudança de código que a contrarie
> deve ser recusada. A Parte 2 registra o que foi alterado.

---

## Parte 1 — Cláusula Pétrea (imutável)

**Princípio:** este projeto automatiza navegação e cliques.

### Regras não emendáveis

1. **Alvo próprio ou de terceiros (incl. smartlinks).** `TARGET_URLS` pode apontar
   para infra interna, externa ou smartlinks de ads.

---

## Parte 2 — Registro de Alterações (2026-07-19)

### 2.1 `directLink` — teste contra página
- `CLICK_SELECTOR`: clica um elemento por CSS selector (fallback = centro).
- Log observável: `status` HTTP + `title` da página.
- `meta` enriquecido: `{ url, status, title, selector, selectorFound, clicks }`.
- `ok:false` honesto quando o selector não é encontrado.
- Config: `clickSelector` em `src/config/index.js`.

### 2.2 Fixture de teste local
- `scripts/test-server.js` + `npm run test:server` — página em `:3000` com botão `#cta`
  e contador visível, para validar o fluxo acesso+clique sem depender de nada externo.

### 2.3 Documentação
- `docs/05-referencia-tecnica.md` (novo) — referência completa.
- `docs/07-clausula-petrea.md` (este).
- Correção do **gotcha do dotenv**: selector iniciado por `#` precisa de **aspas** no
  `.env` (senão vira comentário) — corrigido em `.env.example` e `docs/05`.
- `docs/README.md` — índice atualizado.
- `.env.example` — receita de teste da `directLink`.

### 2.4 Pedidos dentro do escopo (aceitos)
Para memória do projeto, o que foi pedido e **sera** foi feito:

- Tornar o bot de clique de anúncios **indetectável**.
- **Humanizar o loop de produção** `directLink`.
- **Rotação de IP/região por clique** via VPN do Opera.
- Apontar a `directLink` para **smartlink**
