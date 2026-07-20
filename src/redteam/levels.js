'use strict';

/**
 * Escada de sofisticação do red-team (medição de cobertura).
 *
 * Cada nível existe para exercitar UMA camada de sinais que a detecção
 * DEVERIA pegar. O objetivo NÃO é ser indetectável — é descobrir em que
 * nível cada "denúncia" (tell) desaparece, para escrever a detecção certa.
 *
 * Flags por nível:
 *  - stealth              → aplica puppeteer-extra-stealth (patches de automação)
 *  - overrideUserAgent    → usa UA/idiomas realistas (vs. UA headless padrão)
 *  - humanBehavior        → mouse curvado, scroll e dwell (vs. clique seco)
 *  - fingerprintVariation → varia UA/viewport/idioma por sessão (L4)
 *  - keepAutomationArgs   → mantém --enable-automation (só L0, o mais ingênuo)
 */

const LEVELS = [
  {
    id: 'L0',
    name: 'Naïve',
    description: 'Headless puro, sem stealth, clique via DOM (zero telemetria de ponteiro).',
    stealth: false,
    overrideUserAgent: false,
    humanBehavior: false,
    fingerprintVariation: false,
    keepAutomationArgs: true,
    clickMode: 'dom', // document.click() — nenhum evento de mouse
  },
  {
    id: 'L1',
    name: 'Higiene',
    description: 'UA real + viewport + Accept-Language, mas sem patches de automação.',
    stealth: false,
    overrideUserAgent: true,
    humanBehavior: false,
    fingerprintVariation: false,
    keepAutomationArgs: false,
    clickMode: 'teleport', // mouse.click direto no alvo, sem trajetória
  },
  {
    id: 'L2',
    name: 'Stealth',
    description: 'puppeteer-extra-stealth: esconde flags de automação (nível atual do projeto).',
    stealth: true,
    overrideUserAgent: true,
    humanBehavior: false,
    fingerprintVariation: false,
    keepAutomationArgs: false,
    clickMode: 'teleport',
  },
  {
    id: 'L3',
    name: 'Comportamento',
    description: 'Stealth + mouse realista (accel/decel, overshoot, Fitts), scroll de leitura, dwell inicial e persona por sessão.',
    stealth: true,
    overrideUserAgent: true,
    humanBehavior: true,
    fingerprintVariation: false,
    keepAutomationArgs: false,
    clickMode: 'human',
  },
  {
    id: 'L4',
    name: 'Distribuído',
    description: 'L3 + fingerprint variado por sessão. Diversidade de IP = hook documentado.',
    stealth: true,
    overrideUserAgent: true,
    humanBehavior: true,
    fingerprintVariation: true,
    keepAutomationArgs: false,
    clickMode: 'human',
  },
];

const BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l]));

function resolveLevels(ids) {
  if (!ids || !ids.length) return LEVELS;
  return ids.map((id) => {
    const level = BY_ID[id.trim().toUpperCase()];
    if (!level) {
      throw new Error(`Nível desconhecido: "${id}". Disponíveis: ${LEVELS.map((l) => l.id).join(', ')}`);
    }
    return level;
  });
}

module.exports = { LEVELS, BY_ID, resolveLevels };
