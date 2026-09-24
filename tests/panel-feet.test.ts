import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyModularOp,
  feetOf,
  generateComposition,
  preset,
  PROFILE,
  type Composition,
} from '../lib/composition';
import { cutPlan } from '../lib/cutplan';

const single = (): Composition => ({
  schemaVersion: 3,
  profile: PROFILE,
  modules: [{ ...preset('niche', 'a'), width: 900, height: 500, depth: 450 }],
  connections: [],
});

void test('painel de parede é uma chapa só, larga, sem compartimentos', () => {
  let d = applyModularOp(single(), { kind: 'module.add', id: 'p', preset: 'panel' });
  d = applyModularOp(d, { kind: 'module.edit', id: 'p', width: 2200, height: 1400, depth: 25, position: [0, 350, -300] });
  const { parts, cells } = generateComposition(d);
  const panel = parts.filter((p) => p.owners.includes('p'));
  assert.equal(panel.length, 1);
  assert.equal(panel[0].kind, 'panel');
  assert.deepEqual([panel[0].c, panel[0].l, panel[0].thickness], [2200, 1400, 25]);
  assert.equal(cells.some((c) => c.moduleId === 'p'), false);
  // Cabe numa chapa: o plano de corte aceita a peça.
  assert.equal(cutPlan(panel).oversize.length, 0);
});

void test('painel recusa compartimento, conexão, pés e medida fora da chapa', () => {
  const d = applyModularOp(single(), { kind: 'module.add', id: 'p', preset: 'panel' });
  assert.throws(() => applyModularOp(d, { kind: 'cell.split', id: 'p:root', axis: 'y' }), /painel de parede/);
  assert.throws(
    () => applyModularOp(d, { kind: 'connect', parent: 'a', child: 'p', side: 'right', shared: false, align: 'back', offset: 0 }),
    /não se conecta/,
  );
  assert.throws(() => applyModularOp(d, { kind: 'module.edit', id: 'p', feet: 100 }), /não leva pés/);
  assert.throws(() => applyModularOp(d, { kind: 'module.edit', id: 'p', width: 2400, height: 2000 }), /2700 × 1800/);
  assert.throws(() => applyModularOp(d, { kind: 'module.edit', id: 'p', depth: 80 }), /15 a 60/);
  // A caixa segue com os limites de sempre.
  assert.throws(() => applyModularOp(d, { kind: 'module.edit', id: 'a', width: 1500 }), /200 a 1200/);
});

void test('pés levantam a caixa, chegam ao piso e não entram no corte', () => {
  const d = applyModularOp(single(), { kind: 'module.edit', id: 'a', feet: 150 });
  const g = generateComposition(d);
  const base = g.parts.find((p) => p.id === 'a:base')!;
  assert.equal(base.position[1], 150 + PROFILE.panel / 2);
  assert.equal(g.bounds.min[1], 0);
  assert.equal(g.bounds.max[1], 650);
  const feet = feetOf(d);
  assert.equal(feet.length, 4);
  assert.ok(feet.every((f) => f.height === 150 && f.position[1] === 75));
  assert.equal(g.parts.some((p) => p.name.includes('Pé')), false);
  assert.throws(() => applyModularOp(d, { kind: 'module.edit', id: 'a', feet: 20 }), /50 a 300/);
});

void test('vizinho conectado fica na mesma base; painel compartilhado copia os pés', () => {
  let d = applyModularOp(single(), { kind: 'module.edit', id: 'a', feet: 120 });
  d = applyModularOp(d, { kind: 'module.add', id: 'b', preset: 'niche' });
  d = applyModularOp(d, { kind: 'module.edit', id: 'b', width: 600, height: 500, depth: 450, position: [15000, 0, 0] });
  d = applyModularOp(d, { kind: 'connect', parent: 'a', child: 'b', side: 'right', shared: true, align: 'front', offset: 0 });
  const b = d.modules.find((m) => m.id === 'b')!;
  assert.equal(b.feet, 120);
  assert.equal(b.position[1], 0);
  assert.equal(feetOf(d).length, 8);
  assert.throws(() => applyModularOp(d, { kind: 'module.edit', id: 'b', feet: 0 }), /pés de 120 × 0/);
});
