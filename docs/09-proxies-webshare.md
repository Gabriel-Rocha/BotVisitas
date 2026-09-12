# Proxies e egress

**Padrão gratuito (Windows):** [TuxlerVPN](#tuxlervpn-windows--gratuito) — residencial, sem API paga.

**Opcional:** lista HTTP ou gateway pago (Webshare, DataImpulse) via `PROXY_*`.

**Não suportado:** Tor (`127.0.0.1:9050/9150`) — IPs `.onion` e SOCKS Tor são recusados
pelo bot e pela rede de ads.

Teto do pool/workers HTTP: **40** (`PROXY_MAX` ≤ 40).

---

## TuxlerVPN (Windows — gratuito)

[TuxlerVPN](https://www.tuxlervpn.com/) roteia o tráfego da máquina por IPs **residenciais**
(SOCKS5 comunitário). Plano Standard é gratuito (país escolhível; cidade = Premium).

### Como o bot usa

1. Instale o **TuxlerVPN** no Windows (64-bit).
2. No app: **Residential** + conecte (toggle Unprotected → Protected).
3. No `.env`:

```env
TUXLER_ENABLED=true
PROXY_ENABLED=false
PROXY_SKIP_FLAGGED=false
TUXLER_EXE=C:\Program Files (x86)\tuxlerVPN\tuxlerVPN.exe
TUXLER_ROTATE_TIMEOUT_MS=90000
CONCURRENCY=3
WORKER_SLOTS=mobile:au,desktop:de,desktop:us
BROWSER_RESTART_EVERY=10
```

4. O bot chama `scripts/tuxler-rotate.ps1` (UI Automation) para **Reload to Next Nearby Location**
   e, se possível, selecionar o país do slot (`WORKER_SLOTS` / `PROXY_COUNTRIES`).

### IP diferente por worker

O Tuxler só expõe **1 IP por máquina** (VPN de sistema, sem API).

| Modo | Comportamento |
|------|----------------|
| Vários workers, **1 PC** | Mutex: só 1 Chromium ativo; ao adquirir lease o bot **rotaciona** o Tuxler → IP novo por rodada/worker |
| Vários PCs Windows | Cada máquina com Tuxler = 1 IP paralelo de verdade (colaboradores) |

Não espere 40 IPs **simultâneos** no mesmo Windows — isso exige gateway pago (`PROXY_SERVER`).

### Logs

- `Tuxler rotate | antes ip=…` / `Tuxler rotate OK | ip=…`
- `Proxy adquirido: tuxler|de|203.0.113.1`

Se o botão Reload mudar de nome numa versão nova do Tuxler, ajuste os padrões em
`scripts/tuxler-rotate.ps1`.

---

## ⚠️ "Anonymous proxy detected"

Mensagem vinda do **site alvo** (ads/smartlink/anti-fraude).

Causa: o **IP de saída** está em blocklist como proxy anônimo / datacenter / hosting.
Stealth de browser (UA, WebRTC, timezone) **não apaga** reputação de IP.

O bot **probeia o egress** e **não envia visita** por IP flagged (exceto Tuxler, quando
`PROXY_SKIP_FLAGGED=false` — residencial costuma passar melhor que datacenter).

```env
PROXY_SKIP_FLAGGED=true
PROXY_FALLBACK_DIRECT=true
```

| Opção | Efeito |
|-------|--------|
| **Tuxler residencial** | Mitigação real — IP de ISP/carrier |
| Proxy **residencial** pago | Idem, com pool paralelo |
| Pool só datacenter/free | IPs descartados; `PROXY_FALLBACK_DIRECT=true` cai na rede da máquina |
| `PROXY_SKIP_FLAGGED=false` | Volta a mandar datacenter (o alvo volta a mostrar a mensagem) |

---

## Concorrência (workers)

Cada acesso paralelo com IP **diferente ao mesmo tempo** precisa de **1 egress distinto**
(1 proxy HTTP sticky ou 1 máquina Tuxler).

### Webshare (lista download)

No painel Webshare: Proxy → list download → URL no formato
`https://proxy.webshare.io/api/v2/proxy/list/download/<token>/...`.
Linhas: `host:port:user:pass`.

```env
CONCURRENCY=12
PROXY_ENABLED=true
PROXY_MAX=12
PROXY_LIST_URL=https://proxy.webshare.io/api/v2/proxy/list/download/SEU_TOKEN/...
PROXY_SKIP_FLAGGED=false
TUXLER_ENABLED=false
DEVICE_MIX=desktop:6,mobile:6
```

No boot o bot baixa a lista e monta até `PROXY_MAX` slots (1 endpoint/worker).
Datacenter costuma ser marcado como proxy/anon — residencial rende melhor em CPM.

### Gateway sticky (DataImpulse etc.)

```env
CONCURRENCY=12
PROXY_ENABLED=true
PROXY_MAX=12
PROXY_SERVER=http://LOGIN:SENHA@gw.dataimpulse.com:823
TUXLER_ENABLED=false
DEVICE_MIX=desktop:6,mobile:6
```

Com `PROXY_ENABLED=true`, o bot **desliga o Tuxler na sessão**. Com gateway sticky cria
`PROXY_MAX` sessões (`login__cr.cc;sessid.N`). Cada worker recebe um lease exclusivo.

| Cenário | Workers |
|---------|---------|
| `dryRun` | `CONCURRENCY` (sem browser) |
| `directLink` + proxy HTTP | `min(CONCURRENCY, pool)` — 1 proxy exclusivo por worker |
| `directLink` + **Tuxler** | N Chromiums; **1 SOCKS** — gotos limitados (~4) para não quebrar TLS |
| `directLink` sem proxy/Tuxler | Forçado a **1** (mesmo IP sem ganho) |

Restart periódico (`BROWSER_RESTART_EVERY`): libera lease e adquire IP novo (proxy ou Tuxler).

---

## Gateway HTTP pago (opcional)

```env
PROXY_ENABLED=true
PROXY_MAX=20
PROXY_SERVER=http://LOGIN:SENHA@gw.dataimpulse.com:823
PROXY_LIST=
PROXY_COUNTRIES=au,de,us
```

Com só `PROXY_SERVER`, o pool cria `PROXY_MAX` slots. DataImpulse porta 823 → sticky
`10000+` por worker. Chromium: `--proxy-server=host:port` + `page.authenticate()`.

### `ERR_TUNNEL_CONNECTION_FAILED`

Retry de navegação + troca de sticky. Reduza `CONCURRENCY` se persistir.

---

## Como roda (proxy HTTP)

1. Orquestrador sobe N workers
2. Cada worker faz `acquire()` no lease (proxy exclusivo)
3. Chromium: `--proxy-server=host:port` + `page.authenticate()`
4. No stop/restart: `release()` devolve o IP ao pool

## Segurança

- Não commitar `.env`
- **WebRTC:** proxy HTTP sozinho não esconde o IP real; Chromium usa
  `disable_non_proxied_udp` + patch suave em `stealth.js`.
  Ver [`11-ofuscacao.md`](./11-ofuscacao.md).
