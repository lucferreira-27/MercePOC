import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../lib/furniture';
import * as old from '../lib/design';
import {
  PROFILE,
  preset,
  generateComposition,
  migrateComposition,
  applyModularOp,
  layout,
  openingLimit,
  openingPose,
  type Composition,
} from '../lib/composition';
import {
  normalize,
  executeRequest,
  canonical,
  cutCSV,
  cortecloud,
  entityIds,
} from '../lib/studio';
const base = (): Composition => ({
  schemaVersion: 4,
  profile: PROFILE,
  modules: [preset('niche', 'a')],
  connections: [],
});
const two = () =>
  applyModularOp(base(), { kind: 'module.add', id: 'b', preset: 'niche' });
const shared = (side: 'right' | 'top' = 'right') =>
  applyModularOp(two(), {
    kind: 'connect',
    parent: 'a',
    child: 'b',
    side,
    shared: true,
    align: 'front',
    offset: 0,
  });
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
void test('migration preserves every legacy physical panel and revision geometry', () => {
  for (const params of [
    defaults,
    { ...defaults, width: 1200, height: 900, depth: 550, shelfCount: 2 },
  ]) {
    const v2 = old.migrateParams(params),
      before = old.generateDesign(v2).parts,
      d = migrateComposition(v2),
      after = generateComposition(d).parts;
    assert.deepEqual(migrateComposition(d), d);
    assert.equal(after.length, before.length);
    for (const part of before) {
      const next = after.find((p) => p.id === part.id)!;
      assert.ok(next);
      part.size.forEach((v, i) => close(v, next.size[i]));
      part.position.forEach((v, i) => close(v, next.position[i]));
    }
  }
});
void test('removing every shelf keeps the root cell identity', () => {
  // Regressão: sem prateleiras a raiz virava 'cell-legacy-0' e o próximo
  // split falhava com "Compartimento cell-root não encontrado". O modelo
  // pede exatamente essa sequência: remover as antigas e subdividir de novo.
  const empty = migrateComposition(old.migrateParams(defaults));
  const stripped = executeRequest(
    { ...normalize(empty), shelves: [] } as never,
    [{ kind: 'remove', ids: ['sh-4', 'sh-3', 'sh-2', 'sh-1'] }] as never,
  );
  assert.ok(stripped.ok, stripped.ok ? '' : stripped.error);
  if (!stripped.ok) return;
  const cells = layout(canonical(stripped.design)).cells;
  assert.deepEqual(
    cells.map((c) => c.id),
    ['cell-root'],
  );
  const split = executeRequest(stripped.design, [
    { kind: 'cell.split', id: 'cell-root', axis: 'y', gapMm: 279 },
  ] as never);
  assert.ok(split.ok, split.ok ? '' : split.error);
});
void test('all presets use canonical editable cells and have no closed collision', () => {
  for (const kind of ['shelf', 'niche', 'rack', 'drawers'] as const) {
    const d = base();
    d.modules = [preset(kind, 'a')];
    const g = generateComposition(d);
    assert.ok(g.parts.length >= 5);
    assert.equal(new Set(g.parts.map((p) => p.id)).size, g.parts.length);
  }
});
void test('shared lateral and horizontal panels have exactly two owners, no duplicate; separation clears overlap', () => {
  for (const side of ['right', 'top'] as const) {
    const d = shared(side),
      g = generateComposition(d);
    assert.equal(g.parts.length, 9);
    assert.equal(g.parts.filter((p) => p.owners.length === 2).length, 1);
    const separated = applyModularOp(d, { kind: 'disconnect', child: 'b' });
    assert.equal(generateComposition(separated).parts.length, 10);
    assert.equal(separated.connections.length, 0);
    assert.equal(d.connections.length, 1);
  }
});
void test('connected resize is atomic, accepts both matching edits and rejects one incompatible edit', () => {
  const d = normalize(shared());
  const invalid = executeRequest(d, [
    { kind: 'module.edit', id: 'a', height: 900 },
  ]);
  assert.equal(invalid.ok, false);
  assert.equal(d.modules[0].height, 600);
  const valid = executeRequest(d, [
    { kind: 'module.edit', id: 'a', height: 900 },
    { kind: 'module.edit', id: 'b', height: 900 },
  ]);
  assert.ok(valid.ok);
  if (valid.ok) assert.equal(generateComposition(valid.design).parts.length, 9);
  assert.throws(
    () => applyModularOp(d, { kind: 'module.edit', id: 'b', rotation: 90 }),
    // O erro precisa dizer o que difere e como sair: era genérico e o usuário
    // não sabia que editar um módulo compartilhado exige separar antes.
    /Diferença em orientação 0° × 90°[\s\S]*Separar módulos/,
  );
});
void test('horizontal and vertical splits enforce minimum clearances, stable identities, merge safety', () => {
  let d = applyModularOp(base(), {
    kind: 'cell.split',
    id: 'a:root',
    axis: 'x',
    gapMm: 300,
  });
  d = applyModularOp(d, {
    kind: 'cell.split',
    id: 'a:root:high',
    axis: 'y',
    gapMm: 200,
  });
  const ids = entityIds(normalize(d));
  const renamed = applyModularOp(d, {
    kind: 'module.edit',
    id: 'a',
    name: 'Um nome novo',
  });
  assert.deepEqual(entityIds(normalize(renamed)), ids);
  assert.throws(
    () => applyModularOp(d, { kind: 'cell.move', id: 'a:root', gapMm: 700 }),
    /100/,
  );
  assert.throws(
    () => applyModularOp(d, { kind: 'cell.merge', id: 'a:root' }),
    /subdivisões/,
  );
  const merged = applyModularOp(d, { kind: 'cell.merge', id: 'a:root:high' });
  assert.equal(layout(merged).cells.filter((c) => !c.node.split).length, 2);
});
void test('distribution and resize preserve free-space proportions after panel thickness', () => {
  let d = applyModularOp(base(), {
    kind: 'cell.split',
    id: 'a:root',
    axis: 'y',
    gapMm: 150,
  });
  d = applyModularOp(d, { kind: 'cell.split', id: 'a:root:high', axis: 'y' });
  d = applyModularOp(d, { kind: 'cell.distribute', id: 'a:root' });
  let gaps = layout(d)
    .cells.filter((c) => !c.node.split)
    .map((c) => c.size[1]);
  gaps.forEach((g) => close(g, gaps[0]));
  d = applyModularOp(d, { kind: 'module.edit', id: 'a', height: 1200 });
  gaps = layout(d)
    .cells.filter((c) => !c.node.split)
    .map((c) => c.size[1]);
  gaps.forEach((g) => close(g, gaps[0]));
});
void test('door and drawer cut dimensions follow the construction profile', () => {
  let d = applyModularOp(base(), {
    kind: 'front.set',
    id: 'a:root',
    type: 'double',
  });
  let parts = generateComposition(d).parts;
  const doors = parts.filter((p) => p.kind === 'door');
  assert.equal(doors.length, 2);
  close(doors[0].size[0], (800 - 36 - 6) / 2);
  close(doors[0].size[1], 600 - 36 - 4);
  assert.equal(openingLimit(parts, doors[0].motion!.id), 1);
  d = applyModularOp(d, {
    kind: 'front.set',
    id: 'a:root',
    type: 'drawers',
    count: 3,
  });
  parts = generateComposition(d).parts;
  assert.equal(parts.filter((p) => p.kind === 'drawer').length, 18);
  const side = parts.find((p) => p.id.endsWith('drawer-0:left'))!;
  assert.equal(side.size[0], 15);
  close(side.size[2], 450 - 6 - 18 - 20);
  const bottom = parts.find((p) => p.id.endsWith('drawer-0:bottom'))!;
  close(bottom.size[0], 800 - 36 - 26);
  assert.equal(bottom.size[1], 6);
  d = applyModularOp(d, {
    kind: 'drawer.height',
    id: 'a:root',
    index: 0,
    height: 220,
  });
  close(
    generateComposition(d).parts.find((p) => p.id.endsWith('drawer-0:front'))!
      .size[1],
    220,
  );
  assert.throws(() =>
    applyModularOp(d, {
      kind: 'front.set',
      id: 'a:root',
      type: 'drawers',
      count: 7,
    }),
  );
});
void test('opening is visual and exports stay closed and deduplicated', () => {
  let d = shared();
  d = applyModularOp(d, { kind: 'front.set', id: 'a:root', type: 'single' });
  const studio = normalize(d),
    csv = cutCSV(studio),
    json = JSON.stringify(cortecloud(studio));
  const parts = generateComposition(d).parts;
  const door = parts.find((p) => p.kind === 'door')!;
  const moved = openingPose(door, 1);
  assert.notDeepEqual(moved.position, door.position);
  assert.equal(cutCSV(studio), csv);
  assert.equal(JSON.stringify(cortecloud(studio)), json);
  assert.equal(cortecloud(studio).parts.length, 10);
});
void test('L connections are orthogonal and opening stops at an obstacle', () => {
  let d = two();
  d = applyModularOp(d, { kind: 'module.edit', id: 'b', rotation: 90 });
  d = applyModularOp(d, {
    kind: 'connect',
    parent: 'a',
    child: 'b',
    side: 'right',
    shared: false,
    align: 'back',
    offset: 0,
  });
  d = applyModularOp(d, {
    kind: 'front.set',
    id: 'a:root',
    type: 'single',
    hinge: 'right',
  });
  const parts = generateComposition(d).parts,
    door = parts.find((p) => p.kind === 'door')!;
  assert.equal(d.modules[1].rotation, 90);
  assert.ok(openingLimit(parts, door.motion!.id) < 1);
});
void test('limits reject whole requests and keep input unchanged', () => {
  const d = normalize(base()),
    snapshot = JSON.stringify(d);
  assert.equal(
    executeRequest(d, [
      { kind: 'module.edit', id: 'a', name: 'Changed' },
      { kind: 'module.edit', id: 'a', width: 1201 },
    ]).ok,
    false,
  );
  assert.equal(JSON.stringify(d), snapshot);
  const crowded = base();
  crowded.modules.push({
    ...preset('niche', 'b'),
    width: 200,
    height: 200,
    depth: 200,
    position: [0, 100, 0],
  });
  assert.throws(() => generateComposition(crowded));
  assert.deepEqual(
    canonical(normalize(migrateComposition(old.migrateParams(defaults)))),
    migrateComposition(old.migrateParams(defaults)),
  );
});
