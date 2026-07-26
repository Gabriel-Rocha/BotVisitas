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
| Comportamento | `humanBrowsePause`, `navigateLikeHuman` | Scroll suave, mouse, dwell, clique em `<a>` |

Módulos: [`src/core/stealth.js`](../src/core/stealth.js) · [`src/core/geo.js`](../src/core/geo.js).

---

## Config (`.env`)

```env
# true = timezone/locale pela região do IP (recomendado)
STEALTH_GEO_TZ=true
# Fallback se geo estiver off ou a API falhar
STEALTH_TIMEZONE=America/Sao_Paulo
STEALTH_LOCALE=pt-BR
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