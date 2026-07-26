'use strict';

const { randomInt } = require('../utils/random');
const { sleep } = require('../utils/sleep');

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

/** Args extras do Chromium que reduzem fingerprint de bot. */
function getStealthLaunchArgs({ lang = 'pt-BR' } = {}) {
  const language = String(lang || 'pt-BR').trim() || 'pt-BR';
  return [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    `--lang=${language}`,
    '--disable-infobars',
    '--window-position=0,0',
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

  // Client Hints só fazem sentido em Chromium (não Safari iOS puro).
  if (/Chrome\//i.test(userAgent) && !/CriOS/i.test(userAgent)) {
    headers['sec-ch-ua'] =
      `"Chromium";v="${major}", "Not(A:Brand";v="24", "Google Chrome";v="${major}"`;
    headers['sec-ch-ua-mobile'] = mobileToken;
    headers['sec-ch-ua-platform'] = platform;
  }

  return headers;
}

/**
 * Injeta patches antes de qualquer script da página.
 * - Esconde navigator.webdriver
 * - Bloqueia WebRTC (vazamento do IP real atrás de proxy)
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

      // WebRTC: sem isso o site pode descobrir o IP real mesmo com proxy HTTP.
      try {
        const block = () => {
          throw new DOMException('Permission denied', 'NotAllowedError');
        };
        if (window.RTCPeerConnection) {
          window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, {
            construct() {
              block();
            },
          });
        }
        if (window.webkitRTCPeerConnection) {
          window.webkitRTCPeerConnection = window.RTCPeerConnection;
        }
        if (navigator.mediaDevices?.getUserMedia) {
          navigator.mediaDevices.getUserMedia = block;
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
async function humanBrowsePause(page, dwellSec) {
  const sec = dwellSec != null ? dwellSec : randomInt(5, 14);
  const vp = page.__botViewport || { width: 1280, height: 720 };

  await sleep(randomInt(400, 1200));
  await humanMouseMove(
    page,
    randomInt(40, Math.max(80, vp.width - 40)),
    randomInt(60, Math.max(100, Math.floor(vp.height * 0.6)))
  );

  const firstChunk = Math.min(sec, randomInt(2, 4));
  await sleep(firstChunk * 1000);
  await humanScroll(page);
  await sleep(Math.max(0, sec - firstChunk) * 1000);

  return sec;
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
  applyLocaleHints,
  humanMouseMove,
  humanScroll,
  humanBrowsePause,
  navigateLikeHuman,
};
