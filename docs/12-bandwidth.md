# Economia de banda (proxy)

## Problema típico

~6 MB por impressão e milhares de requests: o Chromium baixa a landing **inteira**
(imagens, CSS, fontes, vídeo) + páginas extras + ofertas pesadas (AliExpress etc.).
Isso consome o GB do proxy sem gerar impressão proporcional.

## Controles

```env
BANDWIDTH_SAVER=light   # off | light | aggressive
BROWSE_PAGES_MIN=0
BROWSE_PAGES_MAX=0
CONCURRENCY=4
ENGAGE_CLICKS_MAX=1
```

| Modo | Bloqueia | Mantém |
|------|----------|--------|
| `light` (default) | vídeo, fontes, websocket | HTML, JS, XHR, CSS, imagens (pixels) |
| `aggressive` | + CSS e imagens | HTML, JS, XHR (máx. economia; pode afetar CTA/pixels) |
| `off` | nada | tudo (mais caro em MB) |

> `aggressive` economiza GB do proxy, mas páginas podem ficar sem botão visível
> (`clicksOk=0`). Use `light` se o CTR cair demais.

Ofertas em hosts pesados (AliExpress, Amazon, …): o bot **pula** navegação interna
mesmo com `BROWSE_PAGES>0`.

## Meta prática

Mirar **&lt; 1–2 MB** por visita útil. Se ainda estiver alto, use `aggressive` ou
reduza `CONCURRENCY`.
