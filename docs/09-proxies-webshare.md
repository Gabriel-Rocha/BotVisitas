# Proxies (Webshare free — máx. 10)

## Esclarecimento

[Webshare](https://www.webshare.io/pricing) é **proxy** (HTTP/SOCKS), não VPN.
O plano free oferece **10 proxies** — o código impõe `PROXY_MAX` ≤ 10.

## ⚠️ "Anonymous proxy detected"

Mensagem vinda do **site alvo** (ads/smartlink/anti-fraude).

Causa: o **IP de saída** está em blocklist como proxy anônimo / datacenter / hosting.
Stealth de browser (UA, WebRTC, timezone) **não apaga** reputação de IP.

O bot agora **probeia o egress pelo próprio proxy** e **não envia visita** por IP flagged.

```env
# Default: recusar IPs proxy/hosting; se o pool inteiro for ruim, ir direto.
PROXY_SKIP_FLAGGED=true
PROXY_FALLBACK_DIRECT=true
```

| Opção | Efeito |
|-------|--------|
| Proxy **residencial** ou **mobile** | Mitigação real — IP de ISP/carrier |
| Pool só datacenter/free | IPs descartados; `PROXY_FALLBACK_DIRECT=true` cai na rede da máquina |
| `PROXY_SKIP_FLAGGED=false` | Volta a mandar datacenter (o alvo volta a mostrar a mensagem) |

No log do worker: `IP marcado como proxy/VPN/anon + hosting/datacenter...`.

---

## Concorrência (workers)

Cada acesso paralelo com IP diferente precisa de **1 Chromium próprio** (proxy é por processo).

```env
CONCURRENCY=5          # default; teto = min(CONCURRENCY, pool, 10)
PROXY_ENABLED=true
PROXY_LIST=...         # até 10 IPs
```

| Cenário | Workers |
|---------|---------|
| `dryRun` | `CONCURRENCY` (sem browser) |
| `directLink` + proxy | `min(CONCURRENCY, pool)` — 1 proxy exclusivo por worker |
| `directLink` sem proxy | Forçado a **1** (mesmo IP sem ganho) |

Restart periódico (`BROWSER_RESTART_EVERY`): o worker **libera** o proxy e adquire outro livre.

RAM aproximada: ~150–300MB por Chromium → 5 ≈ 1GB+, 10 ≈ 2GB+ (+ `shm_size` no Docker).

## Config (`.env`)

```env
PROXY_ENABLED=true
PROXY_MAX=10
CONCURRENCY=5

# Preferir lista de IPs (plano free) em vez do gateway:
PROXY_SERVER=
PROXY_LIST=1.2.3.4:80:user:pass,5.6.7.8:80:user:pass
```

Credenciais **nunca** no código / Git.

## Como roda

1. Orquestrador sobe N workers
2. Cada worker faz `acquire()` no lease (proxy exclusivo)
3. Chromium: `--proxy-server=host:port` + `page.authenticate()`
4. No stop/restart: `release()` devolve o IP ao pool

## Segurança

- Não commitar `.env`
- **WebRTC:** proxy HTTP sozinho não esconde o IP real; Chromium usa
  `disable_non_proxied_udp` + patch suave em `stealth.js` (sem throw).
  Ver [`11-ofuscacao.md`](./11-ofuscacao.md).
