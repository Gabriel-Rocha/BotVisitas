'use strict';

const { randomInt, randomFloat, chance } = require('../utils/random');
const { sleep, sleepRange } = require('../utils/sleep');

const mice = new WeakMap();

function mouseState(page) {
  if (!mice.has(page)) {
    mice.set(page, { x: randomInt(80, 420), y: randomInt(80, 280) });
  }
  return mice.get(page);
}

function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

async function moveTo(page, x, y) {
  const state = mouseState(page);
  const fromX = state.x;
  const fromY = state.y;
  const dist = Math.hypot(x - fromX, y - fromY);
  const steps = Math.max(8, Math.min(32, Math.round(dist / 18)));
  const c1x = fromX + (x - fromX) * randomFloat(0.2, 0.45) + randomInt(-90, 90);
  const c1y = fromY + (y - fromY) * randomFloat(0.15, 0.4) + randomInt(-70, 70);
  const c2x = fromX + (x - fromX) * randomFloat(0.55, 0.85) + randomInt(-90, 90);
  const c2y = fromY + (y - fromY) * randomFloat(0.55, 0.85) + randomInt(-70, 70);

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const px = bezier(fromX, c1x, c2x, x, t);
    const py = bezier(fromY, c1y, c2y, y, t);
    await page.mouse.move(px, py);
    if (chance(0.12)) await sleep(randomInt(4, 22));
  }

  state.x = x;
  state.y = y;
}

async function humanClick(page, x, y) {
  await moveTo(page, x, y);
  await sleepRange(40, 180);
  await page.mouse.down();
  await sleepRange(18, 90);
  await page.mouse.up();
}

async function wanderMouse(page, viewport) {
  const hops = randomInt(1, 3);
  for (let i = 0; i < hops; i += 1) {
    const x = randomInt(40, Math.max(50, viewport.width - 40));
    const y = randomInt(40, Math.max(50, viewport.height - 40));
    await moveTo(page, x, y);
    await sleepRange(80, 280);
  }
}

async function humanScroll(page) {
  if (typeof page.mouse.wheel !== 'function') return;
  const ticks = randomInt(1, 4);
  for (let i = 0; i < ticks; i += 1) {
    const delta = randomInt(120, 520) * (chance(0.15) ? -1 : 1);
    try {
      await page.mouse.wheel({ deltaY: delta });
    } catch {
      return;
    }
    await sleepRange(180, 700);
  }
}

async function dwell(config) {
  if (!config.stealth.humanize) return 0;
  return sleepRange(config.stealth.dwellMinMs, config.stealth.dwellMaxMs);
}

async function browseLikeHuman(page, config) {
  if (!config.stealth.humanize) return;
  const viewport = page.viewport() || config.viewport;
  await wanderMouse(page, viewport);
  await humanScroll(page);
  await dwell(config);
}

function clickPoint(viewport) {
  const w = viewport.width || 1920;
  const h = viewport.height || 1080;
  return {
    x: randomInt(Math.round(w * 0.28), Math.round(w * 0.72)),
    y: randomInt(Math.round(h * 0.28), Math.round(h * 0.68)),
  };
}

/**
 * Escolhe elemento clicável real (área visível + posição no fluxo de leitura).
 * Substitui clickPoint(coordenada aleatória) — clicar no centro DESTE elemento.
 * @returns {Promise<{ x: number, y: number, selector?: string, text?: string, area?: number }|null>}
 */
async function findClickTarget(page) {
  const target = await page.evaluate(() => {
    const sel =
      'a[href], button, [role="button"], input[type="submit"], input[type="button"], [onclick], .btn, .button, [data-cta]';
    const nodes = [...document.querySelectorAll(sel)];
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const scored = [];

    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (r.width < 16 || r.height < 12) continue;
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
        continue;
      }
      if (r.bottom < 0 || r.top > vh) continue;
      if (style.pointerEvents === 'none') continue;

      const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80);
      const href = el.getAttribute('href') || '';
      if (/privacy|terms|cookie|logout|mailto:|tel:/i.test(`${text} ${href}`)) continue;

      const area = r.width * r.height;
      const cy = r.top + r.height / 2;
      // Fluxo de leitura: preferir terço superior-médio da viewport
      const readingBonus = cy < vh * 0.55 ? 1.4 : cy < vh * 0.8 ? 1.0 : 0.6;
      const centerX = r.left + r.width / 2;
      const centerBias = 1 - Math.min(1, Math.abs(centerX - vw / 2) / (vw / 2)) * 0.3;
      const score = area * readingBonus * centerBias;

      scored.push({
        x: Math.round(centerX),
        y: Math.round(cy),
        text,
        area: Math.round(area),
        score,
        tag: el.tagName,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    if (!scored.length) return null;

    // Ponderar entre os top-5 (não sempre o #1)
    const top = scored.slice(0, 5);
    const total = top.reduce((s, t) => s + t.score, 0);
    let r = Math.random() * total;
    for (const t of top) {
      r -= t.score;
      if (r <= 0) return t;
    }
    return top[0];
  });

  return target;
}

/**
 * Pré-roll humano antes do clique: scroll até alvo, hover, pausa.
 */
async function preRollBeforeClick(page, target) {
  if (!target) return;
  try {
    await page.evaluate((y) => {
      window.scrollBy({ top: Math.max(0, y - window.innerHeight * 0.35), behavior: 'smooth' });
    }, target.y);
  } catch {
    // ignore
  }
  await sleep(randomInt(200, 500));
  await moveTo(page, target.x, target.y);
  await sleep(randomInt(400, 900)); // hover
  await sleep(randomInt(600, 1500)); // pausa intenção
}

module.exports = {
  moveTo,
  humanClick,
  wanderMouse,
  humanScroll,
  dwell,
  browseLikeHuman,
  clickPoint,
  findClickTarget,
  preRollBeforeClick,
};
