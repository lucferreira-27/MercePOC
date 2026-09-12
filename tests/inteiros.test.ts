import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE,
  preset,
  applyModularOp,
  generateComposition,
  layout,
  type Composition,
} from '../lib/composition';

/**
 * Lista de corte é requisito de oficina: o marceneiro corta em milímetro
 * cheio, então 3 x 185,33 mm não fecham os 556 mm do vão interno de um
 * gaveteiro de 800 x 600 x 350. Estes testes prendem a distribuição inteira
 * (floor em cada parte e a sobra numa parte escolhida) para gavetas, portas,
 * colunas de uma divisão e prateleiras distribuídas.
 */
function cabinet(id: string, width: number, height: number): Composition {
  const m = preset('niche', id);
  m.width = width;
  m.height = height;
  m.depth = 350;
  return {
    schemaVersion: 3,
    profile: PROFILE,
    modules: [m],
    connections: [],
  };
}
void test('três gavetas em 600 mm de altura somam o vão interno em milímetro inteiro', () => {
  const d = applyModularOp(cabinet('a', 800, 600), {
      kind: 'front.set',
      id: 'a:root',
      type: 'drawers',
      count: 3,
    }),
    fronts = generateComposition(d).parts.filter(
      (p) => p.kind === 'drawer' && p.id.endsWith(':front'),
    );
  // 556 mm de vão livre viram 185 + 185 + 186: cada frente recebe floor e a de
  // cima, a última de baixo para cima, fecha a conta.
  assert.deepEqual(
    fronts.map((p) => p.size[1]),
    [185, 185, 186],
  );
  const inner = 600 - 2 * PROFILE.panel,
    reveals = 2 * PROFILE.reveal + (fronts.length - 1) * PROFILE.reveal;
  assert.equal(
    fronts.reduce((a, p) => a + p.size[1], 0) + reveals,
    inner,
  );
});
void test('divisão em três colunas soma a largura interna', () => {
  let d = applyModularOp(cabinet('a', 800, 600), {
    kind: 'cell.split',
    id: 'a:root',
    axis: 'x',
  });
  d = applyModularOp(d, { kind: 'cell.split', id: 'a:root:low', axis: 'x' });
  d = applyModularOp(d, { kind: 'cell.distribute', id: 'a:root' });
  const widths = layout(d)
    .cells.filter((c) => !c.node.split)
    .map((c) => c.size[0]);
  // 728 mm livres / 3 = 242,66: cada coluna recebe 242 e a última da direita
  // fica com os 2 mm que sobram.
  assert.deepEqual(widths, [242, 242, 244]);
  assert.equal(
    widths.reduce((a, b) => a + b, 0) + 2 * PROFILE.panel,
    800 - 2 * PROFILE.panel,
  );
});
void test('duas e cinco colunas também fecham a largura interna', () => {
  let two = applyModularOp(cabinet('a', 799, 600), {
    kind: 'cell.split',
    id: 'a:root',
    axis: 'x',
  });
  two = applyModularOp(two, { kind: 'cell.distribute', id: 'a:root' });
  const twoWidths = layout(two)
    .cells.filter((c) => !c.node.split)
    .map((c) => c.size[0]);
  // Vão livre ímpar: floor(745 / 2) = 372 e a coluna da direita fica com 373.
  assert.deepEqual(twoWidths, [372, 373]);
  assert.equal(
    twoWidths.reduce((a, b) => a + b, 0) + PROFILE.panel,
    799 - 2 * PROFILE.panel,
  );

  let five = cabinet('a', 1200, 600);
  for (const id of ['a:root', 'a:root:low', 'a:root:high', 'a:root:high:low'])
    five = applyModularOp(five, { kind: 'cell.split', id, axis: 'x' });
  five = applyModularOp(five, { kind: 'cell.distribute', id: 'a:root' });
  const fiveWidths = layout(five)
    .cells.filter((c) => !c.node.split)
    .map((c) => c.size[0]);
  // 1092 mm livres / 5 = 218,4: quatro colunas de 218 e a última com 220.
  assert.deepEqual(fiveWidths, [218, 218, 218, 218, 220]);
  assert.equal(
    fiveWidths.reduce((a, b) => a + b, 0) + 4 * PROFILE.panel,
    1200 - 2 * PROFILE.panel,
  );
});
void test('cell.move mantém o vão pedido e as peças inteiras', () => {
  let d = applyModularOp(cabinet('a', 800, 600), {
    kind: 'cell.split',
    id: 'a:root',
    axis: 'y',
    gapMm: 150,
  });
  d = applyModularOp(d, { kind: 'cell.move', id: 'a:root', gapMm: 300 });
  const inner = 600 - 2 * PROFILE.panel,
    free = inner - PROFILE.panel;
  assert.deepEqual(
    layout(d)
      .cells.filter((c) => !c.node.split)
      .map((c) => c.size[1]),
    [300, free - 300],
  );

  // Pedido quebrado (o modelo às vezes manda 300,4) não vira dízima na lista
  // de corte: o vão da divisória continua em milímetro cheio e a soma fecha.
  d = applyModularOp(d, { kind: 'cell.move', id: 'a:root', gapMm: 300.4 });
  const heights = layout(d)
    .cells.filter((c) => !c.node.split)
    .map((c) => c.size[1]);
  assert.ok(
    heights.every((h) => Number.isInteger(h)),
    heights.join(', '),
  );
  assert.equal(
    heights.reduce((a, b) => a + b, 0) + PROFILE.panel,
    inner,
  );
  for (const part of generateComposition(d).parts)
    assert.ok(
      Number.isInteger(part.c) && Number.isInteger(part.l),
      `${part.name}: ${part.c} x ${part.l}`,
    );
});
void test('nenhuma peça tem dízima em gabinete com portas, gavetas e divisórias', () => {
  let d = applyModularOp(cabinet('a', 800, 600), {
    kind: 'front.set',
    id: 'a:root',
    type: 'drawers',
    count: 3,
  });
  d = applyModularOp(d, {
    kind: 'drawer.height',
    id: 'a:root',
    index: 0,
    height: 220,
  });
  // Módulo dividido em coluna com portas duplas e outra com duas alturas.
  d = applyModularOp(d, { kind: 'module.add', id: 'b', preset: 'rack' });
  d = applyModularOp(d, { kind: 'front.set', id: 'b:root', type: 'none' });
  d = applyModularOp(d, { kind: 'cell.split', id: 'b:root', axis: 'x' });
  d = applyModularOp(d, {
    kind: 'cell.split',
    id: 'b:root:high',
    axis: 'y',
    gapMm: 250,
  });
  d = applyModularOp(d, { kind: 'front.set', id: 'b:root:low', type: 'double' });
  // Estante com quatro prateleiras e uma divisória dentro do vão de baixo.
  d = applyModularOp(d, { kind: 'module.add', id: 'c', preset: 'shelf' });
  const vao = layout(d).cells.find(
    (cell) => cell.moduleId === 'c' && !cell.node.split,
  )!;
  d = applyModularOp(d, { kind: 'cell.split', id: vao.id, axis: 'x' });
  const parts = generateComposition(d).parts,
    kinds = parts.map((p) => p.kind);
  assert.ok(
    kinds.includes('door') &&
      kinds.includes('drawer') &&
      kinds.includes('divider'),
    kinds.join(', '),
  );
  for (const part of parts)
    assert.ok(
      Number.isInteger(part.c) &&
        Number.isInteger(part.l) &&
        Number.isInteger(part.thickness),
      `${part.name}: ${part.c} x ${part.l} x ${part.thickness}`,
    );
});
