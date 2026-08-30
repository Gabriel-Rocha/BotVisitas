# Ofuscação de visitas (requisito crítico)

> **Importância: máxima.** Todo acesso a links deve parecer uma visita humana
> normal. Não pode ficar aparente que é bot, nem que há uso de proxy/VPN.

Este documento é a referência operacional. A regra fundacional está também em
[`07-clausula-petrea.md`](./07-clausula-petrea.md) (Parte 1).

---

## Objetivo

Cada iteração (`directLink` e qualquer strategy com browser) deve:

1. **Não expor automação** — sem sinais óbvios de Puppeteer / headless / webdriver.
2. **Não expor proxy/VPN** — em especial, não vazar o IP real (WebRTC) nem deixar
   headers/timezone incoerentes com o tráfego. **Atenção:** IP de datacenter/free
   proxy ainda pode gerar **"anonymous proxy detected"** no site alvo — isso é
   reputação de IP, não fingerprint. Ver [`09-proxies-webshare.md`](./09-proxies-webshare.md).
3. **Comportar-se como humano** — scroll, mouse, tempo de leitura, navegação por
   clique em links internos quando possível.

**Limite honesto:** nenhuma automação é 100% indetectável contra anti-bot avançado.
O projeto busca o **máximo razoável e sustentado** — não marketing de “invisível”.

---

## Camadas (código)

| Camada | Onde | O que faz |
|--------|------|-----------|
| Plugin stealth | `browser.js` | `puppeteer-extra-plugin-stealth` |
| Args de launch | `core/stealth.js` → `browser.js` | Desliga `AutomationControlled`, lang pt-BR, etc. |
| Patches de página | `applyPageStealth` | `navigator.webdriver`, WebRTC sem throw (iceServers vazios), `chrome.runtime`, languages |
| Locale / TZ | `geo.js` + `applyLocaleHints` | Timezone/locale pela região do IP (proxy ou egress); fallback `.env` |
| Headers | `buildRealisticHeaders` | Accept-Language + Client Hints alinhados ao UA e à região |
| Personas | `device-profiles.json` | Só UAs Chromium coerentes (sem Firefox/Safari falso) |
| Comportamento | `humanBrowsePause`, `humanEngage`, `navigateLikeHuman` | Scroll, mouse, dwell, **cliques reais** (CTR), follow redirect JS |
| Tráfego válido | `pickOrganicReferrer`, `openAsOrganicVisit` | HTTP Referer + `document.referrer` da geo; warmup opcional (Google/Bing → clique no smartlink); aba visível / com foco; dwell antes e depois do CTR |

Módulos: [`src/core/stealth.js`](../src/core/stealth.js) · [`src/core/geo.js`](../src/core/geo.js).

### Sinais que a rede marca como inválido (e o que fazemos)

| Sinal | Mitigação |
|-------|-----------|
| Referrer vazio / direct | 1ª visita sempre com `Referer` da geo (google.com.au, google.de, …) |
| Typed-in / sem click-through | `INCLUDE_REFERRER=true` visita a homepage do buscador e clica um `<a>` (`rel=noopener`, nunca `noreferrer`) |
| `document.hidden` / aba sem foco | Patch `hidden=false`, `visibilityState=visible`, `hasFocus()`, `bringToFront()` |
| `outerWidth/Height = 0` (headless) | outer* alinhado ao inner + chrome UI; `screenX/Y` ≠ 0 |
| Clique rápido demais | Dwell 5–9s na landing, hover 0,3–0,8s, pausa 0,5–1,4s no alvo antes do clique |
| Pixel de viewability | Dwell extra 3–6s depois do clique; `BANDWIDTH_SAVER=light` (não `aggressive`) para não bloquear pixel/CSS |

`INCLUDE_REFERRER=false` ainda envia o header Referer; só pula o warmup no Google (menos banda, sinal um pouco mais fraco).

---

## Config (`.env`)

```env
# true = timezone/locale pela região do IP (recomendado)
STEALTH_GEO_TZ=true
# Fallback se geo estiver off ou a API falhar
STEALTH_TIMEZONE=America/Sao_Paulo
STEALTH_LOCALE=pt-BR

# true = warmup no Google/Bing da geo (click-through). false = só header Referer
INCLUDE_REFERRER=true
```

Com proxy: geo usa `proxy.host`. Sem proxy: geo usa o IP de egress da máquina.
Lookup via ip-api.com (cache 6h). Falha → fallback do `.env`.
Mismatch IP×TZ é um tell clássico — por isso o alinhamento automático é o default.

---

## Regras para quem altera código

- Nova strategy com browser **deve** reutilizar `stealth.js` (não reinventar).
- Não adicionar UAs de outro motor (Firefox/Safari) enquanto o runtime for Chromium.
- Não remover mitigação de WebRTC sem decisão explícita documentada.
- Não usar `throw` em APIs do browser (RTCPeerConnection/getUserMedia) — quebra JS do site.
- Qualquer regressão que torne o acesso “óbvio de bot” é bug crítico.
- Evoluções de ofuscação entram no [checklist](./REFACTOR_CHECKLIST.md).

---

## Proxy ≠ VPN

Proxies HTTP (ex.: Webshare) **não** são VPN. O browser ainda pode vazar IP via
WebRTC se não houver mitigação — usamos flags do Chromium
(`disable_non_proxied_udp`) + patch suave (sem `throw`, para não quebrar o JS do
site). Ver [`09-proxies-webshare.md`](./09-proxies-webshare.md).

**Não fazer:** sobrescrever `RTCPeerConnection` / `getUserMedia` com `throw` —
isso derruba o JavaScript de muitos sites.