'use strict';

const { randomInt } = require('../utils/random');
const { sleep, sleepInterruptible, isAbortError } = require('../utils/sleep');
const { getTuxlerNavGate } = require('./navGate');

/**
 * Ofuscação de visita — objetivo: cada acesso parecer navegação humana normal.
 * Não revelar automação, proxy ou VPN para o site alvo.
 *
 * Camadas:
 * 1. Args de launch (menos sinais de automation)
 * 2. Patches de página (webdriver, WebRTC leak, chrome.*)
 * 3. Headers coerentes com o UA
 * 4. Comportamento humano (scroll suave, mouse, dwell)
 */

/** Args extras do Chromium que reduzem fingerprint de bot (sem quebrar JS do site). */
function getStealthLaunchArgs({ lang = 'pt-BR' } = {}) {
  const language = String(lang || 'pt-BR').trim() || 'pt-BR';
  return [
    '--disable-blink-features=AutomationControlled',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--enforce-webrtc-ip-permission-check',
    '--disable-ipv6',
    `--lang=${language}`,
    '--disable-infobars',
  ];
}

/**
 * Extrai major version do Chrome a partir do UA (p/ Sec-CH-UA).
 * @param {string} userAgent
 * @returns {string|null}
 */
function chromeMajorFromUa(userAgent) {
  const m = String(userAgent || '').match(/Chrome\/(\d+)/i);
  return m ? m[1] : null;
}

/**
 * Headers HTTP alinhados ao UA + locale da região do IP.
 * Evita mismatch UA × Client Hints × Accept-Language × timezone.
 */
function buildRealisticHeaders(userAgent, { isMobile = false, acceptLanguage = null } = {}) {
  const major = chromeMajorFromUa(userAgent) || '122';
  const mobileToken = isMobile ? '?1' : '?0';
  const platform = /Macintosh|Mac OS X/i.test(userAgent)
    ? '"macOS"'
    : /Android/i.test(userAgent)
      ? '"Android"'
      : /iPhone|iPad/i.test(userAgent)
        ? '"iOS"'
        : '"Windows"';

  const headers = {
    'Accept-Language':
      acceptLanguage || 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Upgrade-Insecure-Requests': '1',
  };

  // Client Hints: Chrome desktop/Android. CriOS (iOS) não envia sec-ch-ua típico.
  if (/Chrome\//i.test(userAgent) && !/CriOS/i.test(userAgent)) {
    headers['sec-ch-ua'] =
      `"Chromium";v="${major}", "Not(A:Brand";v="24", "Google Chrome";v="${major}"`;
    headers['sec-ch-ua-mobile'] = mobileToken;
    headers['sec-ch-ua-platform'] = platform;
  }

  return headers;
}

/**
 * Alinha navigator.* ao perfil mobile/tablet (platform, touch, hardware).
 * Deve rodar via evaluateOnNewDocument antes da 1ª navegação.
 */
async function applyDeviceHints(page, { isMobile = false, hasTouch = false, userAgent = '' } = {}) {
  const ua = String(userAgent || '');
  let platform = 'Win32';
  if (/iPhone/i.test(ua)) platform = 'iPhone';
  else if (/iPad/i.test(ua)) platform = 'iPad';
  else if (/Android/i.test(ua)) platform = 'Linux armv8l';
  else if (/Mac OS X/i.test(ua)) platform = 'MacIntel';

  const maxTouchPoints = hasTouch ? (/iPad/i.test(ua) ? 5 : 5) : 0;
  const vendor = /AppleWebKit/i.test(ua) && (/iPhone|iPad|CriOS/i.test(ua)) ? 'Apple Computer, Inc.' : 'Google Inc.';

  await page.evaluateOnNewDocument(
    (opts) => {
      try {
        Object.defineProperty(navigator, 'maxTouchPoints', {
          get: () => opts.maxTouchPoints,
          configurable: true,
        });
      } catch {
        // ignore
      }
      try {
        Object.defineProperty(navigator, 'platform', {
          get: () => opts.platform,
          configurable: true,
        });
      } catch {
        // ignore
      }
      try {
        Object.defineProperty(navigator, 'vendor', {
          get: () => opts.vendor,
          configurable: true,
        });
      } catch {
        // ignore
      }
      if (opts.hasTouch) {
        try {
          if (!('ontouchstart' in window)) {
            window.ontouchstart = null;
          }
        } catch {
          // ignore
        }
      }
    },
    { platform, maxTouchPoints, vendor, hasTouch: Boolean(hasTouch), isMobile: Boolean(isMobile) }
  );

  // Emulação de toque via CDP (além de viewport.isMobile/hasTouch).
  if (hasTouch) {
    try {
      const client = await page.createCDPSession();
      await client.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: maxTouchPoints || 1,
      });
    } catch {
      // CDP indisponível
    }
  }
}

/**
 * Injeta patches antes de qualquer script da página.
 * - Esconde navigator.webdriver
 * - Reduz vazamento WebRTC sem quebrar o JS do site (não lança throw)
 * - Suaviza chrome.runtime / permissions
 * - languages alinhados ao locale da região do IP
 */
async function applyPageStealth(page, { languages = ['pt-BR', 'pt', 'en-US', 'en'] } = {}) {
  const langs = Array.isArray(languages) && languages.length ? languages : ['pt-BR', 'pt', 'en-US', 'en'];
  const primary = langs[0];

  await page.evaluateOnNewDocument(
    (langList, primaryLang) => {
      try {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
          configurable: true,
        });
      } catch {
        // ignore
      }

      // WebRTC seguro: remove iceServers / host candidates — NÃO lança erro
      // (throw em RTCPeerConnection ou getUserMedia quebra o JS de muitos sites).
      try {
        const wrapPeerConnection = (Original) => {
          if (!Original) return Original;

          const Wrapped = function (...args) {
            const config = args[0] && typeof args[0] === 'object' ? { ...args[0] } : {};
            config.iceServers = [];
            args[0] = config;
            // eslint-disable-next-line new-cap
            const pc = new Original(...args);

            try {
              const origAdd = pc.addIceCandidate?.bind(pc);
              if (origAdd) {
                pc.addIceCandidate = function (candidate, ...rest) {
                  const c =
                    candidate && typeof candidate === 'object'
                      ? candidate.candidate || candidate
                      : candidate;
                  if (typeof c === 'string' && / typ host /.test(c)) {
                    return Promise.resolve();
                  }
                  return origAdd(candidate, ...rest);
                };
              }
            } catch {
              // ignore
            }

            return pc;
          };

          Wrapped.prototype = Original.prototype;
          try {
            Object.setPrototypeOf(Wrapped, Original);
          } catch {
            // ignore
          }
          try {
            Object.defineProperty(Wrapped, 'name', { value: 'RTCPeerConnection' });
          } catch {
            // ignore
          }
          return Wrapped;
        };

        if (window.RTCPeerConnection) {
          window.RTCPeerConnection = wrapPeerConnection(window.RTCPeerConnection);
        }
        if (window.webkitRTCPeerConnection) {
          window.webkitRTCPeerConnection = window.RTCPeerConnection;
        }
      } catch {
        // ignore
      }

      try {
        if (!window.chrome) window.chrome = {};
        if (!window.chrome.runtime) {
          window.chrome.runtime = {
            connect: () => undefined,
            sendMessage: () => undefined,
          };
        }
      } catch {
        // ignore
      }

      try {
        const originalQuery = window.navigator.permissions?.query?.bind(
          window.navigator.permissions
        );
        if (originalQuery) {
          window.navigator.permissions.query = (parameters) =>
            parameters && parameters.name === 'notifications'
              ? Promise.resolve({ state: Notification.permission })
              : originalQuery(parameters);
        }
      } catch {
        // ignore
      }

      try {
        Object.defineProperty(navigator, 'languages', {
          get: () => langList,
          configurable: true,
        });
        Object.defineProperty(navigator, 'language', {
          get: () => primaryLang,
          configurable: true,
        });
      } catch {
        // ignore
      }

      // Viewability: pixels de ads não disparam com document.hidden / aba sem foco.
      try {
        Object.defineProperty(document, 'hidden', {
          get: () => false,
          configurable: true,
        });
        Object.defineProperty(document, 'visibilityState', {
          get: () => 'visible',
          configurable: true,
        });
        document.hasFocus = () => true;
        window.blur = () => {};
        try {
          Object.defineProperty(document, 'prerendering', {
            get: () => false,
            configurable: true,
          });
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }

      // Headless clássico: outerWidth/Height = 0. Chrome real tem chrome UI.
      try {
        const innerW = () => window.innerWidth || 1280;
        const innerH = () => window.innerHeight || 720;
        Object.defineProperty(window, 'outerWidth', {
          get: () => innerW() + 16,
          configurable: true,
        });
        Object.defineProperty(window, 'outerHeight', {
          get: () => innerH() + 86,
          configurable: true,
        });
        Object.defineProperty(window, 'screenX', {
          get: () => 12,
          configurable: true,
        });
        Object.defineProperty(window, 'screenY', {
          get: () => 28,
          configurable: true,
        });
        Object.defineProperty(window, 'screenLeft', {
          get: () => 12,
          configurable: true,
        });
        Object.defineProperty(window, 'screenTop', {
          get: () => 28,
          configurable: true,
        });
      } catch {
        // ignore
      }
    },
    langs,
    primary
  );
}

/**
 * Aplica timezone e locale alinhados à região do IP (ou fallback do .env).
 * timezoneId: IANA, ex. America/Sao_Paulo
 */
async function applyLocaleHints(page, { timezoneId = 'America/Sao_Paulo', locale = 'pt-BR' } = {}) {
  try {
    await page.emulateTimezone(timezoneId);
  } catch {
    // Chromium antigo / CDP indisponível
  }
  try {
    // Puppeteer ≥21
    if (typeof page.emulateLocale === 'function') {
      await page.emulateLocale(locale);
    }
  } catch {
    // ignore
  }
}

/** Move o mouse em passos curtos (não teleporta). */
async function humanMouseMove(page, toX, toY) {
  const vp = page.__botViewport || { width: 1280, height: 720 };
  const fromX = randomInt(Math.floor(vp.width * 0.2), Math.floor(vp.width * 0.8));
  const fromY = randomInt(Math.floor(vp.height * 0.2), Math.floor(vp.height * 0.7));
  const steps = randomInt(8, 18);
  try {
    await page.mouse.move(fromX, fromY);
    await page.mouse.move(toX, toY, { steps });
  } catch {
    // página pode ter navegado
  }
}

/** Scroll suave com pausas irregulares (leitura humana). */
async function humanScroll(page) {
  const steps = randomInt(3, 7);
  for (let i = 0; i < steps; i += 1) {
    const dy = randomInt(120, 480);
    try {
      await page.evaluate(async (delta) => {
        const start = window.scrollY;
        const target = start + delta;
        const duration = 280 + Math.floor(Math.random() * 420);
        const t0 = performance.now();
        await new Promise((resolve) => {
          function frame(now) {
            const t = Math.min(1, (now - t0) / duration);
            const ease = 1 - (1 - t) ** 2;
            window.scrollTo(0, start + (target - start) * ease);
            if (t < 1) requestAnimationFrame(frame);
            else resolve();
          }
          requestAnimationFrame(frame);
        });
      }, dy);
    } catch {
      break;
    }
    await sleep(randomInt(280, 900));
  }

  if (Math.random() < 0.4) {
    try {
      await page.evaluate(async () => {
        const back = Math.round(window.innerHeight * (0.15 + Math.random() * 0.25));
        window.scrollBy({ top: -back, left: 0, behavior: 'smooth' });
      });
      await sleep(randomInt(300, 700));
    } catch {
      // ignore
    }
  }
}

/**
 * Tempo de "leitura" + scroll + leve movimento de mouse.
 * @param {number} [dwellSec] — se omitido, sorteia 5–14s
 */
async function humanBrowsePause(page, dwellSec, { signal, shouldStop } = {}) {
  const sec = dwellSec != null ? dwellSec : randomInt(1, 3);
  if (sec <= 0) {
    await humanScroll(page);
    return 0;
  }
  const vp = page.__botViewport || { width: 1280, height: 720 };
  const waitOpts = { signal, shouldStop };

  await sleepInterruptible(randomInt(150, 400), waitOpts);
  await humanMouseMove(
    page,
    randomInt(40, Math.max(80, vp.width - 40)),
    randomInt(60, Math.max(100, Math.floor(vp.height * 0.6)))
  );

  const firstChunk = Math.min(sec, 1);
  await sleepInterruptible(firstChunk * 1000, waitOpts);
  await humanScroll(page);
  await sleepInterruptible(Math.max(0, sec - firstChunk) * 1000, waitOpts);

  return sec;
}

/**
 * Segue redirects de JS / meta refresh (ex.: AliExpress s.click mostrando <script> cru).
 */
async function followClientRedirects(page, logger, { maxHops = 6, config, shouldStop, signal } = {}) {
  const hops = [];
  const gate =
    config?.tuxler?.enabled !== false
      ? getTuxlerNavGate(config?.tuxler?.navSlots ?? 3)
      : null;
  const hopTimeout = Math.min(12_000, config?.navigationTimeoutMs || 30_000);

  for (let i = 0; i < maxHops; i += 1) {
    if (shouldStop?.() || signal?.aborted) break;
    const before = page.url();

    // Espera redirect espontâneo (window.location / meta).
    try {
      const navWait = page
        .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 4_500 })
        .catch(() => null);
      await Promise.race([navWait, sleep(2_200, { signal })]);
    } catch {
      // timeout / abort ok
    }

    let forced = null;
    try {
      forced = await page.evaluate(() => {
        const bodyText = (document.body && document.body.innerText) || '';
        const html = document.documentElement ? document.documentElement.innerHTML : '';
        const looksLikeRawScript =
          /^\s*<script/i.test(bodyText.trim()) ||
          (bodyText.includes('window.location') && bodyText.includes('script'));

        const patterns = [
          /window\.location\.href\s*=\s*['"]([^'"]+)['"]/i,
          /location\.href\s*=\s*['"]([^'"]+)['"]/i,
          /location\.replace\(\s*['"]([^'"]+)['"]/i,
          /location\.assign\(\s*['"]([^'"]+)['"]/i,
        ];
        if (looksLikeRawScript || /location\.(href|replace|assign)/i.test(html)) {
          for (const re of patterns) {
            const m = html.match(re) || bodyText.match(re);
            if (m && m[1] && /^https?:\/\//i.test(m[1])) return m[1];
          }
        }

        const meta = document.querySelector('meta[http-equiv="refresh" i]');
        if (meta) {
          const content = meta.getAttribute('content') || '';
          const m = content.match(/url\s*=\s*([^\s;]+)/i);
          if (m) {
            try {
              return new URL(m[1].replace(/['"]/g, ''), location.href).href;
            } catch {
              return null;
            }
          }
        }
        return null;
      });
    } catch {
      forced = null;
    }

    if (forced && forced.split('#')[0] !== before.split('#')[0]) {
      if (logger) logger.info(`Redirect cliente → ${forced}`);
      try {
        const go = () =>
          page.goto(forced, { waitUntil: 'domcontentloaded', timeout: hopTimeout });
        if (gate) await gate.run(go, { signal, acquireTimeoutMs: 15_000 });
        else await go();
        hops.push(forced);
        continue;
      } catch (err) {
        if (logger) logger.warn(`Falha no redirect cliente: ${err.message}`);
        break;
      }
    }

    const after = page.url();
    if (after.split('#')[0] !== before.split('#')[0]) {
      hops.push(after);
      continue;
    }
    break;
  }
  return hops;
}

async function clickAtBox(page, box) {
  if (!box || box.width < 2 || box.height < 2) return false;
  const x = box.x + box.width * (0.3 + Math.random() * 0.4);
  const y = box.y + box.height * (0.3 + Math.random() * 0.4);
  const useTouch =
    Boolean(page.__botHasTouch) ||
    page.__botDeviceType === 'mobile' ||
    page.__botDeviceType === 'tablet';

  if (useTouch && page.touchscreen) {
    await sleep(randomInt(180, 420));
    try {
      await page.touchscreen.tap(x, y);
      return true;
    } catch {
      // fallback mouse abaixo
    }
  }

  await humanMouseMove(page, x, y);
  await sleep(randomInt(280, 800)); // hover antes do clique (IVT marca clique instantâneo)
  try {
    // Sequência real de ponteiro (não element.click() sintético).
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'left' });
    await sleep(randomInt(45, 130));
    await page.mouse.up({ button: 'left' });
    return true;
  } catch {
    return false;
  }
}

async function installClickProbe(page) {
  try {
    await page.evaluate(() => {
      if (window.__botClickProbe) return;
      window.__botClickProbe = { count: 0, trusted: 0, last: null };
      const mark = (type) => (e) => {
        window.__botClickProbe.count += 1;
        if (e.isTrusted) window.__botClickProbe.trusted += 1;
        window.__botClickProbe.last = {
          type,
          tag: e.target && e.target.tagName,
          isTrusted: e.isTrusted,
          x: e.clientX,
          y: e.clientY,
          ts: Date.now(),
        };
      };
      document.addEventListener('pointerdown', mark('pointerdown'), true);
      document.addEventListener('mousedown', mark('mousedown'), true);
      document.addEventListener('click', mark('click'), true);
      document.addEventListener('mouseup', mark('mouseup'), true);
    });
  } catch {
    // ignore
  }
}

async function readClickProbe(page) {
  try {
    return await page.evaluate(() => window.__botClickProbe || { count: 0, trusted: 0 });
  } catch {
    return { count: 0, trusted: 0 };
  }
}

/**
 * Candidatos priorizando CTA/ads e evitando footer/legal/search (que “clicam” sem CTR).
 */
async function collectClickCandidates(page) {
  return page.evaluate(() => {
    const sel =
      'a[href], button, [role="button"], input[type="submit"], input[type="button"], [onclick], .btn, .button, [data-cta], [data-click], [data-ad], ins.adsbygoogle, .adsbygoogle';
    const nodes = [...document.querySelectorAll(sel)];
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const out = [];

    function inFooterOrNav(el) {
      let n = el;
      for (let i = 0; i < 8 && n; i += 1) {
        const id = `${n.id || ''} ${n.className || ''} ${n.tagName || ''}`.toLowerCase();
        if (/footer|nav|menu|cookie|consent|privacy|legal|sidebar|breadcrumb|search/.test(id)) {
          return true;
        }
        if (n.tagName === 'FOOTER' || n.tagName === 'NAV' || n.tagName === 'HEADER') return true;
        n = n.parentElement;
      }
      return false;
    }

    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (r.width < 12 || r.height < 12) continue;
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
        continue;
      }
      if (r.bottom < 0 || r.top > vh + 40) continue;
      if (style.pointerEvents === 'none') continue;

      const text = (
        el.innerText ||
        el.value ||
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        el.getAttribute('alt') ||
        ''
      )
        .trim()
        .slice(0, 100);
      const href = el.getAttribute('href') || '';
      const blob = `${text} ${href} ${el.className || ''} ${el.id || ''}`.toLowerCase();

      if (
        /logout|sign[\s-]?out|delete|unsubscribe|javascript:void|privacy|terms|cookie|gdpr|dsa|regulatory|agreement|policy|transparenc|developer website|google search|sign in|log in|create account|share|report|back to homep?age|learn more|see more details|see in play store|screenshot|reload the page/i.test(
          blob
        )
      ) {
        continue;
      }
      if (href.startsWith('mailto:') || href.startsWith('tel:')) continue;
      try {
        const u = new URL(href, location.href);
        if (/play\.google\.com|apps\.apple\.com|(^|\.)google\.com$/i.test(u.hostname)) continue;
        if (/(^|\.)duckduckgo\.com$/i.test(location.hostname)) {
          if (/\/about|\/preferences|\/settings|\/privacy|\/params|\/spread/i.test(u.pathname)) {
            continue;
          }
        }
        if (/(^|\.)bing\.com$/i.test(location.hostname)) {
          if (/\/search|\/account|\/profile|\/settings/i.test(u.pathname)) continue;
        }
      } catch {
        // ignore
      }
      if (el.tagName === 'INPUT' && /search|q|query/i.test(`${el.name || ''} ${el.id || ''} ${el.placeholder || ''}`)) {
        continue;
      }
      if (inFooterOrNav(el) && !/click|continue|start|claim|download|play|go|watch|join/i.test(text)) {
        continue;
      }

      let score = 1;
      if (/^(continue|watch|play|start|click here|get|download|join|enter|go|next|continuar|assistir|começar)$/i.test(text.trim())) {
        score += 14;
      }
      if (/click|continue|start|play|go|here|download|claim|get|open|visit|buy|join|try|watch|free|offer|install|win|attention/i.test(text)) {
        score += 8;
      }
      if (/ad|cta|offer|promo|banner|affiliate|join_overlay/i.test(`${el.className} ${el.id}`)) score += 5;
      if (/click_id|clickid|\/click|cpc=|utm_|ad_id|campaign/i.test(href)) score += 10;
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') score += 4;
      if (el.tagName === 'A' && href && href !== '#' && !href.startsWith('#')) {
        score += 3;
        try {
          const u = new URL(href, location.href);
          if (u.hostname !== location.hostname) score += 4;
          if (/play\.google\.com|apps\.apple\.com|(^|\.)google\.com$/i.test(u.hostname)) {
            score -= 50;
          }
        } catch {
          // ignore
        }
      }
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dist = Math.hypot(cx - vw / 2, cy - vh * 0.45);
      score += Math.max(0, 6 - Math.floor(dist / 120));
      score += Math.min(5, Math.floor((r.width * r.height) / 5000));

      out.push({
        index: i,
        score,
        text,
        tag: el.tagName,
        href: href.slice(0, 160),
        area: Math.round(r.width * r.height),
      });
    }
    out.sort((a, b) => b.score - a.score);
    return out.filter((c) => c.score > 0).slice(0, 30);
  });
}

/** CTA explícito tipo Continue / Watch (interstitial Attention). */
async function findPrimaryCtaHandle(page) {
  const handle = await page.evaluateHandle(() => {
    const preferred =
      /continue|watch(\s+now)?|play(\s+now)?|start|click\s+here|get\s+started|download|join|enter|go|next|continuar|assistir|começar|claim/i;
    const junk =
      /google search|back to homep?age|learn more|play store|screenshot|reload|sign in|log in/i;
    const nodes = [
      ...document.querySelectorAll(
        'a[href], button, [role="button"], input[type="submit"], input[type="button"], div[onclick], span[onclick]'
      ),
    ];
    let best = null;
    let bestScore = 0;
    for (const el of nodes) {
      const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
      if (!text || text.length > 80) continue;
      if (junk.test(text)) continue;
      const href = el.getAttribute && el.getAttribute('href');
      if (href && /play\.google\.com|apps\.apple\.com|google\.com\/search/i.test(href)) continue;
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (r.width < 20 || r.height < 16) continue;
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      let score = 0;
      if (preferred.test(text)) score += 10;
      if (/^continue$/i.test(text)) score += 8;
      score += Math.max(0, 4 - Math.floor(Math.hypot(r.left + r.width / 2 - innerWidth / 2, r.top + r.height / 2 - innerHeight * 0.4) / 150));
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return bestScore >= 10 ? best : null;
  });
  const el = handle.asElement();
  if (!el) {
    try {
      await handle.dispose();
    } catch {
      // ignore
    }
    return null;
  }
  return el;
}

async function clickIframeAds(page, logger) {
  const results = [];
  const frames = page.frames().filter((f) => f !== page.mainFrame());
  for (const frame of frames.slice(0, 6)) {
    try {
      const el = await frame.frameElement();
      if (!el) continue;
      const box = await el.boundingBox();
      if (!box || box.width < 40 || box.height < 40) continue;
      if (box.y > (page.__botViewport?.height || 900) + 20) continue;
      const beforeUrl = page.url();
      const probeBefore = await readClickProbe(page);
      const ok = await clickAtBox(page, box);
      if (!ok) continue;
      await sleep(randomInt(800, 2000));
      const probeAfter = await readClickProbe(page);
      const urlChanged = page.url().split('#')[0] !== beforeUrl.split('#')[0];
      const trustedDelta = (probeAfter.trusted || 0) - (probeBefore.trusted || 0);
      const verified = urlChanged || trustedDelta > 0;
      results.push({
        via: 'iframe',
        verified,
        urlChanged,
        trustedDelta,
        href: frame.url().slice(0, 120),
      });
      if (logger) {
        logger.info(
          `Click CTR iframe ${verified ? 'OK' : 'SEM CONFIRMAÇÃO'} | trustedΔ=${trustedDelta} | urlChanged=${urlChanged}`
        );
      }
      if (verified) {
        await followClientRedirects(page, logger, { maxHops: 4 });
        break; // um iframe confirmado basta por rodada
      }
    } catch {
      // cross-origin / detached
    }
  }
  return results;
}

/**
 * Engajamento com verificação: só conta clique se houver evento trusted ou mudança de URL.
 * Evita “clicks fantasmas” em links de footer/legal que não geram CTR.
 */
async function humanEngage(
  page,
  {
    maxClicks = 3,
    clickSelector = null,
    logger = null,
    fast = false,
    maxMs = 10_000,
    requireUrlChange = false,
    signal = null,
    shouldStop = null,
  } = {}
) {
  const record = [];
  const vp = page.__botViewport || { width: 1280, height: 720 };
  const selectorList =
    'a[href], button, [role="button"], input[type="submit"], input[type="button"], [onclick], .btn, .button, [data-cta], [data-click], [data-ad], ins.adsbygoogle, .adsbygoogle';
  const deadline = maxMs > 0 ? Date.now() + maxMs : Infinity;
  const waitOpts = { signal, shouldStop };
  const expired = () => {
    if (Boolean(shouldStop?.()) || Boolean(signal?.aborted)) return true;
    if (maxMs <= 0 || Date.now() < deadline) return false;
    // Estourou tempo — ainda permite tentar clique se nenhum foi feito
    return record.length > 0 || attempts >= 3;
  };

  await installClickProbe(page);

  await sleepInterruptible(randomInt(fast ? 300 : 2000, fast ? 800 : 3500), waitOpts);
  if (expired()) {
    return { clicks: record, clickCount: record.length, verifiedCount: 0 };
  }
  if (!fast) {
    try {
      await page.waitForSelector('a[href], button, iframe, [role="button"]', {
        timeout: 10_000,
      });
    } catch {
      // página sem interativos óbvios
    }
  } else {
    try {
      await page.waitForSelector('a[href], button, iframe, [role="button"]', {
        timeout: 3_000,
      });
    } catch {
      // fast: segue para clique
    }
  }
  if (expired()) {
    return { clicks: record, clickCount: record.length, verifiedCount: 0 };
  }
  if (!fast) {
    try {
      await page.waitForNetworkIdle({ idleTime: 400, timeout: 4_000 });
    } catch {
      // polling eterno
    }
  }

  for (let i = 0; i < randomInt(1, 2); i += 1) {
    if (expired()) break;
    await humanMouseMove(
      page,
      randomInt(30, Math.max(60, vp.width - 30)),
      randomInt(40, Math.max(80, vp.height - 40))
    );
    await sleepInterruptible(randomInt(80, 250), waitOpts);
  }
  if (expired()) {
    return { clicks: record, clickCount: record.length, verifiedCount: 0 };
  }
  await humanScroll(page);
  await sleepInterruptible(randomInt(200, 500), waitOpts);

  const want = Math.max(1, Math.min(maxClicks, randomInt(1, Math.max(1, maxClicks))));
  let attempts = 0;
  const maxAttempts = Math.max(want * 5, 8);

  async function attemptClickOnHandle(handle, meta) {
    if (expired()) return null;
    const beforeUrl = page.url();
    await installClickProbe(page);
    const probeBefore = await readClickProbe(page);
    try {
      await handle.evaluate((el) =>
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
      );
    } catch {
      // ignore
    }
    await sleepInterruptible(randomInt(500, 1400), waitOpts);
    if (expired()) return null;
    const box = await handle.boundingBox();
    let fired = await clickAtBox(page, box);
    if (!fired) {
      try {
        await handle.evaluate((el) => {
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          el.click();
        });
        fired = true;
      } catch {
        fired = false;
      }
    }
    if (!fired) return null;

    try {
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8_000 }),
        sleepInterruptible(1_500, waitOpts),
      ]);
    } catch (err) {
      if (isAbortError(err)) throw err;
      // soft
    }
    await followClientRedirects(page, logger, { maxHops: 4 });

    const probeAfter = await readClickProbe(page);
    const urlChanged = page.url().split('#')[0] !== beforeUrl.split('#')[0];
    const trustedDelta = (probeAfter.trusted || 0) - (probeBefore.trusted || 0);
    const finalUrl = page.url();
    const hrefBlob = `${meta.href || ''} ${finalUrl}`;
    const trackerish = /click_id|clickid|\/click|cpc=|utm_|ad_id|campaign|aff_|haff_|\bkey=|smartlink|effectivecpm|rtb/i.test(
      hrefBlob
    );
    const junkDest = /play\.google\.com|apps\.apple\.com|google\.com\/search|accounts\.google/i.test(
      hrefBlob
    );
    const ctaish = /click|continue|watch|play|start|claim|download|join|go|next|offer|install|win/i.test(
      `${meta.text || ''} ${meta.selector || ''}`
    );
    // v1+: trusted só conta com URL de tracking; ctaish sozinho gera falso positivo (DuckDuckGo etc.)
    const verified = !junkDest && (
      requireUrlChange
        ? urlChanged
        : urlChanged || (trustedDelta > 0 && trackerish) || (urlChanged && ctaish)
    );

    return {
      ...meta,
      verified,
      urlChanged,
      trustedDelta,
      isTrusted: trustedDelta > 0,
      finalUrl,
    };
  }

  // 1) CLICK_SELECTOR obrigatório se setado
  if (clickSelector) {
    try {
      await page.waitForSelector(clickSelector, { timeout: 8_000, visible: true });
      const el = await page.$(clickSelector);
      if (el) {
        const result = await attemptClickOnHandle(el, {
          via: 'selector',
          selector: clickSelector,
          tag: 'SEL',
          text: clickSelector,
          href: '',
        });
        if (result?.verified) {
          record.push(result);
          if (logger) {
            logger.info(
              `Click CTR VERIFICADO (selector) trustedΔ=${result.trustedDelta} urlChanged=${result.urlChanged}`
            );
          }
        } else if (logger) {
          logger.warn(`Click selector sem confirmação — tentando outros alvos`);
        }
      }
    } catch (err) {
      if (logger) logger.warn(`CLICK_SELECTOR indisponível: ${err.message}`);
    }
  }

  // 2) CTA primário (Continue / Watch / Play) — interstitial Attention
  if (record.length < want) {
    try {
      const cta = await findPrimaryCtaHandle(page);
      if (cta) {
        const label = await cta.evaluate((el) =>
          (el.innerText || el.value || '').trim().slice(0, 40)
        );
        const result = await attemptClickOnHandle(cta, {
          via: 'primary-cta',
          tag: 'CTA',
          text: label,
          href: '',
        });
        if (result?.verified) {
          record.push(result);
          if (logger) {
            logger.info(
              `Click CTR VERIFICADO (CTA "${label}") trustedΔ=${result.trustedDelta} urlChanged=${result.urlChanged}`
            );
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 3) Iframes de ad
  if (record.length < want) {
    const iframeHits = await clickIframeAds(page, logger);
    for (const hit of iframeHits) {
      if (hit.verified) record.push(hit);
    }
  }

  // 4) CTAs ranqueados com retry
  while (record.length < want && attempts < maxAttempts) {
    if (expired()) break;
    attempts += 1;
    await installClickProbe(page);

    let candidates = [];
    try {
      candidates = await collectClickCandidates(page);
    } catch {
      break;
    }
    if (!candidates.length) {
      if (attempts >= 2) break;
      await sleepInterruptible(1200, waitOpts);
      continue;
    }

    const pool = candidates.slice(0, Math.min(10, candidates.length));
    const chosen = pool[randomInt(0, pool.length - 1)];

    let result = null;
    try {
      const handles = await page.$$(selectorList);
      const handle = handles[chosen.index];
      if (!handle) continue;
      result = await attemptClickOnHandle(handle, {
        via: 'engage',
        tag: chosen.tag,
        text: chosen.text,
        href: chosen.href,
        score: chosen.score,
      });
    } catch {
      result = null;
    }

    if (!result) continue;

    if (result.verified) {
      record.push(result);
      if (logger) {
        logger.info(
          `Click CTR VERIFICADO #${record.length}: <${result.tag}> "${(result.text || '').slice(0, 40)}" ` +
            `trustedΔ=${result.trustedDelta} urlChanged=${result.urlChanged}`
        );
      }
    } else if (logger) {
      logger.warn(
        `Click DESCARTADO (sem evento trusted/nav): <${chosen.tag}> "${(chosen.text || '').slice(0, 40)}"`
      );
    }

    await sleepInterruptible(randomInt(250, 700), waitOpts);
  }

  // 5) Último recurso: toque no centro da viewport (muitos interstitials são full-bleed)
  if (!record.length && !expired()) {
    const beforeUrl = page.url();
    await installClickProbe(page);
    const probeBefore = await readClickProbe(page);
    const cx = Math.floor(vp.width * 0.5);
    const cy = Math.floor(vp.height * 0.48);
    const fired = await clickAtBox(page, { x: cx - 20, y: cy - 20, width: 40, height: 40 });
    if (fired) {
      try {
        await Promise.race([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 6_000 }),
          sleep(1_400),
        ]);
      } catch {
        // soft
      }
      await followClientRedirects(page, logger, { maxHops: 4 });
      const probeAfter = await readClickProbe(page);
      const urlChanged = page.url().split('#')[0] !== beforeUrl.split('#')[0];
      const trustedDelta = (probeAfter.trusted || 0) - (probeBefore.trusted || 0);
      const centerVerified = requireUrlChange ? urlChanged : urlChanged || trustedDelta > 0;
      if (centerVerified) {
        record.push({
          via: 'viewport-center',
          verified: true,
          urlChanged,
          trustedDelta,
          tag: 'CENTER',
          text: 'center',
          href: '',
        });
        if (logger) {
          logger.info(
            `Click CTR VERIFICADO (centro viewport) trustedΔ=${trustedDelta} urlChanged=${urlChanged}`
          );
        }
      } else if (logger) {
        logger.warn(
          `Click centro viewport DESCARTADO (sem nav) trustedΔ=${trustedDelta}`
        );
      }
    }
  }

  if (!record.length && logger) {
    logger.warn(
      'Nenhum click VERIFICADO nesta página — CTR do site pode não registrar. ' +
        'Tente CLICK_SELECTOR no CTA ou espere ads carregarem (proxy/geo).'
    );
  }

  if (Math.random() < 0.45) await humanScroll(page);
  await humanMouseMove(
    page,
    randomInt(40, Math.max(80, vp.width - 40)),
    randomInt(60, Math.max(100, Math.floor(vp.height * 0.55)))
  );

  return {
    clicks: record,
    clickCount: record.length,
    verifiedCount: record.filter((c) => c.verified).length,
    attempts,
  };
}

/**
 * Cliques no centro — fluxo original v1 (page.mouse.click após goto).
 * Cada worker executa os seus próprios cliques; contabiliza o que foi disparado.
 */
async function legacyCenterClicks(page, config, logger, { count, followRedirects = true } = {}) {
  const vp = page.__botViewport || {
    width: config?.viewport?.width || 1280,
    height: config?.viewport?.height || 720,
  };
  const x = vp.width / 2;
  const y = vp.height / 2;
  const cap = Math.max(1, config?.maxClicksPerPage ?? 1);
  const min = Math.max(1, config?.engageClicksMin ?? 1);
  const max = Math.max(min, config?.engageClicksMax ?? cap);
  const n = Math.max(1, count ?? randomInt(min, Math.min(cap, max)));

  logger?.info?.(`Cliques no centro (${Math.round(x)},${Math.round(y)}): ${n} [v1]`);

  const clicks = [];
  for (let i = 0; i < n; i += 1) {
    try {
      await page.mouse.click(x, y);
      clicks.push({
        via: 'legacy-center',
        verified: true,
        performed: true,
        index: i + 1,
        x: Math.round(x),
        y: Math.round(y),
      });
    } catch (err) {
      logger?.warn?.(`Clique ${i + 1}/${n} falhou: ${err.message}`);
    }
    if (i < n - 1) {
      await sleep(randomInt(80, 280));
    }
  }

  if (followRedirects && clicks.length) {
    try {
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8_000 }),
        sleep(1_500),
      ]);
    } catch {
      // soft
    }
    await followClientRedirects(page, logger, { maxHops: 4 });
  }

  const finalUrl = page.url();
  for (const hit of clicks) {
    hit.finalUrl = finalUrl;
  }

  logger?.info?.(`Cliques v1: ${clicks.length}/${n} disparados | final=${finalUrl}`);

  return {
    clicks,
    clickCount: clicks.length,
    verifiedCount: clicks.length,
  };
}

/** @deprecated use legacyCenterClicks */
async function legacyViewportClick(page, logger, opts = {}) {
  return legacyCenterClicks(page, {}, logger, { count: 1, ...opts }).then((r) => r.clicks[0] || {
    via: 'legacy-center',
    verified: false,
    performed: false,
  });
}

const ORGANIC_REFERRERS = {
  AU: [
    'https://www.google.com.au/',
    'https://www.google.com.au/search?q=news',
    'https://www.bing.com/',
  ],
  DE: [
    'https://www.google.de/',
    'https://www.google.de/search?q=nachrichten',
    'https://www.bing.com/',
  ],
  US: [
    'https://www.google.com/',
    'https://www.google.com/search?q=news',
    'https://www.bing.com/',
  ],
  GB: ['https://www.google.co.uk/', 'https://www.bing.com/'],
  CA: ['https://www.google.ca/', 'https://www.bing.com/'],
  NL: ['https://www.google.nl/', 'https://www.bing.com/'],
  CH: ['https://www.google.ch/', 'https://www.bing.com/'],
  FR: ['https://www.google.fr/', 'https://www.bing.com/'],
};

function pickOrganicReferrer(countryCode, fallbackList = []) {
  const cc = String(countryCode || '').toUpperCase();
  const pool = ORGANIC_REFERRERS[cc] || (fallbackList.length ? fallbackList : ORGANIC_REFERRERS.US);
  return pool[Math.floor(Math.random() * pool.length)];
}

async function assertForeground(page) {
  try {
    await page.bringToFront();
  } catch {
    // headless / target already focused
  }
  try {
    await page.evaluate(() => {
      try {
        window.focus();
      } catch {
        // ignore
      }
      try {
        document.dispatchEvent(new Event('visibilitychange'));
      } catch {
        // ignore
      }
    });
  } catch {
    // página fechada
  }
}

/**
 * Abre o smartlink como tráfego orgânico: HTTP Referer + document.referrer.
 * Warmup (opcional) visita a origem (homepage da geo) e clica um <a> —
 * a rede vê click-through, não typed/direct. Nunca usa rel=noreferrer.
 */
async function openAsOrganicVisit(page, url, logger, { referrerUrl, warmup = false } = {}) {
  const referer = referrerUrl || 'https://www.google.com/';
  let warmupOrigin = referer;
  try {
    warmupOrigin = `${new URL(referer).origin}/`;
  } catch {
    warmupOrigin = referer;
  }

  if (warmup) {
    try {
      await page.goto(warmupOrigin, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      await sleep(randomInt(1200, 2800));
      try {
        await humanScroll(page);
      } catch {
        // ignore
      }
      await page.evaluate((target) => {
        const a = document.createElement('a');
        a.href = target;
        a.rel = 'noopener';
        a.referrerPolicy = 'no-referrer-when-downgrade';
        a.target = '_self';
        a.style.position = 'fixed';
        a.style.left = '12px';
        a.style.top = '12px';
        a.style.zIndex = '2147483647';
        a.textContent = 'Continue';
        document.body.appendChild(a);
        a.click();
      }, url);
      try {
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      } catch {
        // SPA / já navegou
      }
      const landed = page.url() || '';
      let stillOnSource = true;
      try {
        const host = new URL(landed).hostname;
        stillOnSource =
          /(^|\.)google\.[a-z.]+$/i.test(host) || /(^|\.)bing\.com$/i.test(host);
      } catch {
        stillOnSource = true;
      }
      if (landed && /^https?:/i.test(landed) && !stillOnSource) {
        if (logger) logger.info(`Entrada orgânica (click-through) referer=${warmupOrigin}`);
        await assertForeground(page);
        return { via: 'referrer-click', referer: warmupOrigin };
      }
    } catch (err) {
      if (logger) {
        logger.warn(`Warmup de referrer falhou (${err.message}) — goto com header Referer`);
      }
    }
  }

  await page.goto(url, { waitUntil: 'domcontentloaded', referer, timeout: 60_000 });
  if (logger) logger.info(`Entrada orgânica (Referer header) referer=${referer}`);
  await assertForeground(page);
  return { via: 'goto-referer', referer };
}

/**
 * Prefere clique em `<a href>` interno a `page.goto` (histórico/referrer mais natural).
 * Fallback: goto.
 */
async function navigateLikeHuman(page, url, logger) {
  let clicked = false;
  try {
    clicked = await page.evaluate((target) => {
      const links = [...document.querySelectorAll('a[href]')];
      for (const a of links) {
        try {
          const abs = new URL(a.getAttribute('href'), location.href).href.split('#')[0];
          const want = new URL(target).href.split('#')[0];
          if (abs === want) {
            a.scrollIntoView({ block: 'center', inline: 'nearest' });
            a.click();
            return true;
          }
        } catch {
          // continue
        }
      }
      return false;
    }, url);
  } catch {
    clicked = false;
  }

  if (clicked) {
    if (logger) logger.debug(`Navegação por clique: ${url}`);
    try {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45_000 });
    } catch {
      // SPA / soft nav
    }
    return { via: 'click' };
  }

  if (logger) logger.debug(`Navegação por goto: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { via: 'goto' };
}

module.exports = {
  getStealthLaunchArgs,
  chromeMajorFromUa,
  buildRealisticHeaders,
  applyPageStealth,
  applyDeviceHints,
  applyLocaleHints,
  humanMouseMove,
  humanScroll,
  humanBrowsePause,
  followClientRedirects,
  humanEngage,
  legacyCenterClicks,
  legacyViewportClick,
  navigateLikeHuman,
  pickOrganicReferrer,
  openAsOrganicVisit,
};
