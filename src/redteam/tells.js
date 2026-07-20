'use strict';

/**
 * "Tells" = sinais-exemplo de que a sessão é um bot.
 *
 * IMPORTANTE: isto NÃO é um detector de produção. É um conjunto de heurísticas
 * conhecidas, usado só para LER os snapshots coletados e mostrar, por nível,
 * quais denúncias ainda disparam. É o ponto de partida para você escrever a
 * detecção de verdade (cada tell traz `signal` e `detect`).
 *
 * Cada tell: { layer, severity, signal, detect, test(record) -> bool }
 * layer ∈ fingerprint | behavior | network
 */

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const TELLS = {
  'automation-flag': {
    layer: 'fingerprint',
    severity: 'high',
    signal: 'navigator.webdriver === true',
    detect: 'Bloqueie/marque sessões com navigator.webdriver verdadeiro.',
    test: (r) => r.client?.webdriver === true,
  },
  'headless-ua': {
    layer: 'network',
    severity: 'high',
    signal: 'User-Agent contém "HeadlessChrome"',
    detect: 'Regra de UA: rejeite strings com "Headless".',
    test: (r) => !!r.client?.headlessUa || /headless/i.test(r.server?.userAgent || ''),
  },
  'no-languages': {
    layer: 'fingerprint',
    severity: 'medium',
    signal: 'navigator.languages vazio',
    detect: 'Sessão sem idiomas declarados é anômala para browser real.',
    test: (r) => (num(r.client?.languages) ?? 0) === 0,
  },
  'missing-accept-language': {
    layer: 'network',
    severity: 'medium',
    signal: 'Header Accept-Language ausente',
    detect: 'Exija Accept-Language coerente com navigator.languages.',
    test: (r) => !r.server?.acceptLanguage,
  },
  'no-window-chrome': {
    layer: 'fingerprint',
    severity: 'medium',
    signal: 'window.chrome ausente em UA Chrome',
    detect: 'UA diz Chrome mas window.chrome não existe → inconsistência.',
    test: (r) => r.client?.hasWindowChrome === false && /chrome/i.test(r.client?.userAgent || ''),
  },
  'software-renderer': {
    layer: 'fingerprint',
    severity: 'medium',
    signal: 'WebGL renderer por software (SwiftShader/llvmpipe)',
    detect: 'Renderer de software é forte indício de headless/VM.',
    test: (r) => /swiftshader|llvmpipe|software|basic render/i.test(r.client?.webglRenderer || ''),
  },
  'zero-outer-dimensions': {
    layer: 'fingerprint',
    severity: 'medium',
    signal: 'window.outerWidth/outerHeight == 0',
    detect: 'Janela sem dimensões externas → sem chrome de UI real (headless).',
    test: (r) => r.client?.outerWidth === 0 || r.client?.outerHeight === 0,
  },
  'no-mouse-movement': {
    layer: 'behavior',
    severity: 'high',
    signal: 'Zero eventos de mousemove na sessão',
    detect: 'Interação sem qualquer movimento de mouse → automação.',
    test: (r) => (num(r.client?.mouseMoves) ?? 0) === 0,
  },
  'teleport-pointer': {
    layer: 'behavior',
    severity: 'medium',
    signal: 'Trajetória de mouse ~nula (comprimento < 60px)',
    detect: 'Ponteiro que "teleporta" ao alvo, sem caminho, é robótico.',
    test: (r) => (num(r.client?.mouseMoves) ?? 0) > 0 && (num(r.client?.mousePathLength) ?? 0) < 60,
  },
  'click-without-prior-move': {
    layer: 'behavior',
    severity: 'high',
    signal: 'Clique sem nenhum movimento anterior',
    detect: 'Humanos movem o mouse antes de clicar; bots costumam não mover.',
    test: (r) => (num(r.client?.clicks) ?? 0) > 0 && r.client?.mouseMovedBeforeFirstClick === false,
  },
  'no-scroll': {
    layer: 'behavior',
    severity: 'low',
    signal: 'Nenhum evento de scroll em página rolável',
    detect: 'Ausência total de scroll em página longa é suspeita (sinal fraco).',
    test: (r) => (num(r.client?.scrollEvents) ?? 0) === 0,
  },
  'instant-interaction': {
    layer: 'behavior',
    severity: 'medium',
    signal: 'Primeira interação < 250ms após load',
    detect: 'Reação humana raramente é sub-250ms; meça tempo até 1ª interação.',
    test: (r) => {
      const t = num(r.client?.firstInteractionMs);
      return t !== null && t < 250;
    },
  },
};

function evaluateTells(record) {
  const fired = {};
  for (const [name, def] of Object.entries(TELLS)) {
    let hit = false;
    try {
      hit = !!def.test(record);
    } catch {
      hit = false;
    }
    fired[name] = hit;
  }
  return fired;
}

module.exports = { TELLS, evaluateTells };
