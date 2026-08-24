# Proxies

Teto do pool/workers: **40** (`PROXY_MAX` ≤ 40). Plano free Webshare continua limitado
a 10 IPs na lista — com gateway (DataImpulse) use até 20 sticky slots.

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
CONCURRENCY=20         # teto = min(CONCURRENCY, pool, 20)
PROXY_ENABLED=true
PROXY_MAX=20
DEVICE_MIX=desktop:10,mobile:10
```

| Cenário | Workers |
|---------|---------|
| `dryRun` | `CONCURRENCY` (sem browser) |
| `directLink` + proxy | `min(CONCURRENCY, pool)` — 1 proxy exclusivo por worker |
| `directLink` sem proxy | Forçado a **1** (mesmo IP sem ganho) |

Restart periódico (`BROWSER_RESTART_EVERY`): o worker **libera** o proxy e adquire outro livre.

RAM aproximada: ~150–300MB por Chromium → 10 ≈ 2GB+, **20 ≈ 4–6GB** (`shm_size: 6gb` no Compose).

## Config (`.env`)

```env
PROXY_ENABLED=true
PROXY_MAX=20
CONCURRENCY=20
DEVICE_MIX=desktop:10,mobile:10
```

## DataImpulse (gateway)

```env
PROXY_ENABLED=true
PROXY_MAX=20
CONCURRENCY=20
DEVICE_MIX=desktop:10,mobile:10
PROXY_SERVER=http://LOGIN:SENHA@gw.dataimpulse.com:823
PROXY_LIST=
```

Com só `PROXY_SERVER`, o pool cria `PROXY_MAX` slots. Em DataImpulse, a porta 823
vira sticky `10000+` por worker (IPs distintos). Chromium: `--proxy-server=host:port`
(sem scheme) + `ignoreHTTPSErrors` para evitar `ERR_SSL_PROTOCOL_ERROR`.

### Países (CPM)

DataImpulse aceita país no username (`login__cr.us`). No bot:

```env
# Geos que converteram melhor no DataImpulse (ISO-2). Evitar gb/ca neste pool.
PROXY_COUNTRIES=au,de,us
# ou um só: PROXY_COUNTRY=us
```

O bot acrescenta `__cr.xx` no login de cada slot. No dashboard, **Adicionar worker**
já escolhe o país (VPN). `WORKER_SLOTS=mobile:au,desktop:de` grava 1:1; senão
`PROXY_COUNTRIES` roda em ciclo. `STEALTH_GEO_TZ=true` alinha timezone/locale ao
IP (ex.: US → America/New_York). País sozinho **não garante** CPM alto se a rede
filtrar o tráfego — só evita geos baratos.

### `ERR_TUNNEL_CONNECTION_FAILED`

O Chromium não consegue abrir o túnel `CONNECT` pelo proxy até o alvo (gateway
ocupado, sticky morto, ou provedor recusando o host). Não é falha de stealth/clique.

O bot faz **retry de navegação** (até 3×) e, se ainda falhar, **troca o sticky** e
reinicia o browser nesse worker. Se o erro for frequente com `CONCURRENCY=10`,
reduza para 4–6 ou verifique o dashboard DataImpulse (banda / sessões).

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
