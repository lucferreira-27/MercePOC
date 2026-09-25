import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../lib/furniture';
import { planRow, splitWidths } from '../lib/agent/macros';
import { executeRequest, generateDesign, migrateParams } from '../lib/studio';
import { fitReport, type Room } from '../lib/room';

const room: Room = {
  schemaVersion: 1,
  widthMm: 3200,
  heightMm: 2600,
  obstacles: [{ id: 'window-1', kind: 'window', xMm: 1000, yMm: 1100, widthMm: 1200, heightMm: 1000 }],
};

void test('macro: divide o vão em módulos quase iguais, em mm inteiros', () => {
  assert.deepEqual(splitWidths(3200, 4), [800, 800, 800, 800]);
  assert.deepEqual(splitWidths(1001, 3), [333, 333, 335]);
});

void test('macro: cozinha na parede com janela, balcões inteiros e aéreos desviando da janela', () => {
  const start = migrateParams(defaults);
  const base = planRow(start, room, {
    fromMm: 0,
    widthMm: 3200,
    height: 750,
    depth: 580,
    baseY: 0,
    preset: 'drawers',
    name: 'Balcão',
    feet: 100,
    front: 'double',
    avoid: true,
    replace: true,
  });
  assert.equal(base.segments.length, 1, 'a janela está acima do balcão');
  assert.equal(base.segments[0].ids.length, 4);
  assert.ok(base.anchor, 'a parede fica presa antes da troca');
  const lower = executeRequest(start, base.ops);
  assert.ok(lower.ok, lower.ok ? '' : lower.error);
  const anchored = { ...room, anchor: base.anchor! };

  const top = planRow(lower.design, anchored, {
    fromMm: 0,
    widthMm: 3200,
    height: 700,
    depth: 350,
    baseY: 1500,
    preset: 'niche',
    name: 'Aéreo',
    front: 'double',
    avoid: true,
  });
  assert.equal(top.segments.length, 2, 'aéreo à esquerda e à direita da janela');
  assert.deepEqual(
    top.segments.map((s) => [s.from, s.to]),
    [
      [0, 920],
      [2280, 3200],
    ],
    'janela com moldura de 30 mm e folga de 50 mm de cada lado',
  );
  assert.equal(top.skipped[0].why, 'window');
  const full = executeRequest(lower.design, top.ops);
  assert.ok(full.ok, full.ok ? '' : full.error);
  const report = fitReport(full.design, anchored);
  assert.equal(report.fits, true, JSON.stringify(report.issues));
  const g = generateDesign(full.design);
  assert.equal(Math.round(g.bounds.max[0] - g.bounds.min[0]), 3200, 'o conjunto ocupa a parede inteira');
  assert.ok(full.design.modules.filter((m) => m.wall).every((m) => m.position[1] === 1500));
});

void test('macro: sem ambiente, começa do lado esquerdo do móvel e não troca nada', () => {
  const start = migrateParams(defaults);
  const plan = planRow(start, undefined, { fromMm: 800, widthMm: 600, height: 1800, depth: 350, baseY: 0, preset: 'shelf', name: 'Coluna' });
  assert.equal(plan.anchor, null);
  const r = executeRequest(start, plan.ops);
  assert.ok(r.ok, r.ok ? '' : r.error);
  assert.equal(r.design.modules.length, 2);
});

void test('macro: estante com portas vira corpo aberto com a frente (a raiz dividida não aceita porta)', () => {
  const start = migrateParams(defaults);
  const plan = planRow(start, undefined, { fromMm: 800, widthMm: 900, height: 700, depth: 350, baseY: 1500, preset: 'shelf', name: 'Aéreo', front: 'double' });
  const r = executeRequest(start, plan.ops);
  assert.ok(r.ok, r.ok ? '' : r.error);
  assert.ok(r.design.modules.filter((m) => m.name.startsWith('Aéreo')).every((m) => m.root.front?.type === 'double'));
});
