'use strict';

const fs = require('fs');
const path = require('path');
const { TELLS, evaluateTells } = require('./tells');

/**
 * Constrói a matriz de cobertura a partir dos snapshots coletados.
 *
 * Para cada tell (sinal-exemplo) e cada nível, calcula a fração de sessões em
 * que o tell disparou. O "penhasco de detecção" é o nível mais alto em que o
 * tell ainda aparece — abaixo dele sua detecção (se existisse) perderia o bot.
 */

function summarize(records, levelIds) {
  const byLevel = {};
  for (const id of levelIds) byLevel[id] = { total: 0, tells: {} };

  for (const name of Object.keys(TELLS)) {
    for (const id of levelIds) byLevel[id].tells[name] = 0;
  }

  for (const rec of records) {
    if (!byLevel[rec.level]) continue;
    byLevel[rec.level].total += 1;
    if (!rec.client && !rec.server) continue; // sessão com erro
    const fired = evaluateTells(rec);
    for (const [name, hit] of Object.entries(fired)) {
      if (hit) byLevel[rec.level].tells[name] += 1;
    }
  }

  // Penhasco: índice do nível mais alto onde o tell ainda dispara (fireRate > 0)
  const cliffs = {};
  for (const name of Object.keys(TELLS)) {
    let cliff = -1;
    levelIds.forEach((id, idx) => {
      if (byLevel[id].total > 0 && byLevel[id].tells[name] > 0) cliff = idx;
    });
    cliffs[name] = cliff === -1 ? null : levelIds[cliff];
  }

  return { byLevel, cliffs };
}

function rate(hits, total) {
  if (!total) return '—';
  if (hits === 0) return '·';
  const pct = Math.round((hits / total) * 100);
  return `${hits}/${total} (${pct}%)`;
}

function buildMarkdown({ records, levels, meta, summary }) {
  const levelIds = levels.map((l) => l.id);
  const { byLevel, cliffs } = summary;
  const lines = [];

  lines.push('# Relatório de Cobertura de Detecção — Red-Team BotVisitas');
  lines.push('');
  lines.push('> **Contexto:** teste de red-team autorizado, alvo local que você controla.');
  lines.push('> Os "tells" abaixo são heurísticas conhecidas usadas para LER os sinais');
  lines.push('> coletados — não um detector de produção. Use-os como ponto de partida');
  lines.push('> para escrever a sua detecção.');
  lines.push('');
  lines.push('## Execução');
  lines.push('');
  lines.push(`- Data: ${meta.date}`);
  lines.push(`- Alvo: \`${meta.target}\``);
  lines.push(`- Sessões por nível: ${meta.sessionsPerLevel}`);
  lines.push(`- Níveis: ${levelIds.join(' → ')}`);
  lines.push('');

  // Escada de níveis
  lines.push('## Níveis de sofisticação');
  lines.push('');
  lines.push('| Nível | Nome | O que exercita |');
  lines.push('|-------|------|----------------|');
  for (const l of levels) lines.push(`| ${l.id} | ${l.name} | ${l.description} |`);
  lines.push('');

  // Matriz de cobertura
  lines.push('## Matriz de cobertura (tell × nível)');
  lines.push('');
  lines.push('Cada célula = sessões em que o sinal denunciou o bot. `·` = não disparou.');
  lines.push('');
  const header = ['Tell (sinal)', 'Camada', 'Sev', ...levelIds, 'Penhasco'];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`|${header.map(() => '---').join('|')}|`);

  // ordena por camada e severidade
  const sevRank = { high: 0, medium: 1, low: 2 };
  const names = Object.keys(TELLS).sort((a, b) => {
    const A = TELLS[a];
    const B = TELLS[b];
    return A.layer.localeCompare(B.layer) || sevRank[A.severity] - sevRank[B.severity];
  });

  for (const name of names) {
    const def = TELLS[name];
    const cells = levelIds.map((id) => rate(byLevel[id].tells[name], byLevel[id].total));
    const cliff = cliffs[name] === null ? 'nunca' : cliffs[name];
    lines.push(`| \`${name}\` | ${def.layer} | ${def.severity} | ${cells.join(' | ')} | **${cliff}** |`);
  }
  lines.push('');

  // Leitura do penhasco
  lines.push('## Penhasco de detecção (onde cada sinal some)');
  lines.push('');
  lines.push('O penhasco é o nível MAIS ALTO em que o sinal ainda denuncia o bot.');
  lines.push('Sinais com penhasco baixo (ex.: só L0) são frágeis; os que sobrevivem até');
  lines.push('L3/L4 são os mais valiosos para a sua detecção.');
  lines.push('');
  for (const name of names) {
    const cliff = cliffs[name];
    if (cliff === null) continue;
    const def = TELLS[name];
    lines.push(`- **${name}** (${def.layer}/${def.severity}) → sobrevive até **${cliff}**.`);
    lines.push(`  - Sinal: \`${def.signal}\``);
    lines.push(`  - Detecção sugerida: ${def.detect}`);
  }
  lines.push('');

  // Como virar detecção
  lines.push('## Próximo passo: transformar sinais em detecção');
  lines.push('');
  lines.push('1. Priorize os tells que sobrevivem até L3/L4 — são os que pegam bots sofisticados.');
  lines.push('2. Combine sinais de camadas diferentes (fingerprint + behavior + network):');
  lines.push('   um bot L4 pode limpar o fingerprint mas ainda falhar em entropia comportamental.');
  lines.push('3. Cheque o JSON bruto (`*.json`) para calibrar limiares (ex.: mousePathLength,');
  lines.push('   firstInteractionMs) contra tráfego humano real do seu staging.');
  lines.push('4. Rode de novo após implementar a detecção para medir a nova cobertura.');
  lines.push('');
  lines.push('_Gerado pelo harness de red-team — uso autorizado / ambiente controlado._');
  lines.push('');

  return lines.join('\n');
}

function writeReport({ records, levels, meta, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const levelIds = levels.map((l) => l.id);
  const summary = summarize(records, levelIds);
  const stamp = meta.date.replace(/[:.]/g, '-');

  const mdPath = path.join(outDir, `detection-coverage-${stamp}.md`);
  const jsonPath = path.join(outDir, `detection-coverage-${stamp}.json`);

  const md = buildMarkdown({ records, levels, meta, summary });
  fs.writeFileSync(mdPath, md, 'utf8');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ meta, summary, records }, null, 2),
    'utf8'
  );

  return { mdPath, jsonPath, summary };
}

module.exports = { writeReport, summarize };
