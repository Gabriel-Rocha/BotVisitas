'use strict';

const { randomInt } = require('../utils/random');
const { sleep } = require('../utils/sleep');

/**
 * Comportamento humanizado para L3+ do HARNESS de red-team.
 *
 * O objetivo aqui é MEDIÇÃO: quanto mais realista o L3/L4, mais alto o nível de
 * sofisticação que a sua detecção precisa vencer — e a saída continua sendo a
 * matriz de cobertura. Não é evasão de produção; roda contra o coletor local.
 *
 * Melhorias sobre a versão Bézier simples:
 *  - dwell inicial de leitura (fecha o tell `instant-interaction`)
 *  - dinâmica de mouse realista: aceleração/desaceleração (ease-in-out),
 *    curva cúbica, nº de passos ~ lei de Fitts, overshoot-e-correção
 *  - scroll de leitura (rola–pausa–rola) + micro-movimentos ociosos
 *  - persona por sessão (cada "humano" tem velocidade/paciência diferentes)
 */

function randFloat(min, max) {
  return min + Math.random() * (max - min);
}

// Persona por sessão: humanos variam. Escala tempos e amplitude dos movimentos.
function makeBehaviorProfile() {
  return {
    speed: randFloat(0.7, 1.5), // <1 mais rápido, >1 mais lento
    dwellFactor: randFloat(0.6, 1.6), // tendência a pausar/ler
    scrolliness: randFloat(0.5, 1.8), // quanto rola
    jitteriness: randFloat(0.4, 1.6), // micro-movimentos ociosos
    overshoot: randFloat(0.5, 1.4), // exagero no alvo antes de corrigir
  };
}

// Ease-in-out cúbico → começa devagar, acelera, desacelera no fim.
function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

// Movimento humano: curva cúbica, velocidade ease-in-out, passos ~ Fitts.
async function moveHuman(page, from, to, profile, targetWidth = 40) {
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  // Lei de Fitts: dificuldade ~ log2(distância/alvo + 1) → nº de passos.
  const fitts = Math.log2(dist / Math.max(8, targetWidth) + 1);
  const steps = Math.max(10, Math.round((8 + fitts * 8) * profile.speed));

  // dois pontos de controle deslocados → curvatura natural (não uma reta)
  const c1 = [
    from[0] + (to[0] - from[0]) * 0.3 + randFloat(-70, 70),
    from[1] + (to[1] - from[1]) * 0.3 + randFloat(-70, 70),
  ];
  const c2 = [
    from[0] + (to[0] - from[0]) * 0.7 + randFloat(-70, 70),
    from[1] + (to[1] - from[1]) * 0.7 + randFloat(-70, 70),
  ];

  for (let i = 1; i <= steps; i += 1) {
    const t = easeInOut(i / steps);
    const [x, y] = cubicPoint(from, c1, c2, to, t);
    await page.mouse.move(x, y);
    // passos mais lentos nas pontas (accel/decel), rápidos no meio
    const edge = 1 - Math.sin(Math.PI * (i / steps));
    await sleep(randFloat(2, 7) * (1 + edge * 1.2) * profile.speed);
  }
  return to;
}

// Aproximação com overshoot: passa um pouco do alvo e corrige (como humano).
async function moveToTargetHuman(page, from, target, profile) {
  const over = [
    target[0] + randFloat(-18, 18) * profile.overshoot,
    target[1] + randFloat(-14, 14) * profile.overshoot,
  ];
  let pos = await moveHuman(page, from, over, profile, 30);
  await sleep(randFloat(40, 120) * profile.speed);
  pos = await moveHuman(page, pos, target, profile, 12); // correção curta e precisa
  return pos;
}

// Pausa de leitura com micro-movimentos ociosos (humano não fica 100% parado).
async function readingPause(page, pos, profile, baseMs) {
  const total = baseMs * profile.dwellFactor;
  let elapsed = 0;
  while (elapsed < total) {
    const chunk = randFloat(180, 520);
    await sleep(chunk);
    elapsed += chunk;
    if (Math.random() < 0.55 * profile.jitteriness) {
      await page.mouse.move(
        pos[0] + randFloat(-6, 6) * profile.jitteriness,
        pos[1] + randFloat(-5, 5) * profile.jitteriness
      );
    }
  }
}

// Scroll de leitura: rola–pausa–rola, e às vezes volta um pouco (reler).
async function readingScroll(page, pos, profile) {
  const rounds = Math.max(1, Math.round(randFloat(2, 4) * profile.scrolliness));
  for (let i = 0; i < rounds; i += 1) {
    await page.mouse.wheel({ deltaY: Math.round(randFloat(120, 420) * profile.scrolliness) });
    await readingPause(page, pos, profile, randFloat(500, 1400));
    if (Math.random() < 0.25) {
      await page.mouse.wheel({ deltaY: -Math.round(randFloat(60, 180)) });
      await sleep(randFloat(200, 500));
    }
  }
}

async function humanInteract(page, target, viewport, profile) {
  const prof = profile || makeBehaviorProfile();
  let pos = [randomInt(40, viewport.width - 40), randomInt(40, viewport.height - 40)];

  // 1) DWELL INICIAL DE LEITURA — sem nenhuma interação (nem jitter) antes.
  //    É isto que empurra firstInteractionMs acima de 250ms e fecha o tell
  //    `instant-interaction` no L3/L4 (L0–L2 continuam robóticos e disparam).
  await sleep(randFloat(900, 2400) * prof.dwellFactor);

  // 2) movimentos exploratórios com pausas de leitura
  const wander = randomInt(2, 4);
  for (let i = 0; i < wander; i += 1) {
    const next = [randomInt(40, viewport.width - 40), randomInt(40, viewport.height - 40)];
    pos = await moveHuman(page, pos, next, prof);
    await readingPause(page, pos, prof, randFloat(300, 900));
  }

  // 3) scroll de leitura
  await readingScroll(page, pos, prof);

  // 4) dwell curto, vai ao alvo com overshoot e clica
  await readingPause(page, pos, prof, randFloat(400, 1100));
  pos = await moveToTargetHuman(page, pos, [target.x, target.y], prof);
  await sleep(randFloat(80, 240) * prof.speed);
  await page.mouse.click(target.x, target.y);
}

module.exports = { humanInteract, makeBehaviorProfile, moveHuman };
