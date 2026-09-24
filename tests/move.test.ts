import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyModularOp, generateComposition, preset, PROFILE, type Composition } from '../lib/composition';
import { moveGroup, moveOp, moduleBoxes, rotateOp, selectedGroup, snapDelta, tryOp } from '../lib/move';

/** Nicho "a" na origem e nicho "b" solto à direita, com 400 mm de folga. */
const pair = (): Composition => {
  const a = { ...preset('niche', 'a'), width: 600, height: 500, depth: 400 };
  const b = { ...preset('niche', 'b'), width: 600, height: 500, depth: 400, position: [1000, 0, 0] as [number, number, number] };
  return { schemaVersion: 3, profile: PROFILE, modules: [a, b], connections: [] };
};

void test('módulo conectado move o conjunto: a raiz e tudo preso nela', () => {
  let d = pair();
  d = applyModularOp(d, { kind: 'module.add', id: 'c', preset: 'niche' });
  d = applyModularOp(d, { kind: 'connect', parent: 'a', child: 'c', side: 'top', shared: false, align: 'front', offset: 0 });
  const g = moveGroup(d, 'c')!;
  assert.equal(g.root, 'a');
  assert.deepEqual(g.members.sort(), ['a', 'c']);
  assert.match(g.label, /\+ 1$/);
  // A seleção de uma peça do filho aponta o mesmo conjunto.
  const parts = generateComposition(d).parts;
  const childPart = parts.find((p) => p.owners[0] === 'c')!;
  assert.equal(selectedGroup(d, parts, [childPart.id])?.root, 'a');
  // Peças de dois móveis soltos: nada a mover.
  const other = parts.find((p) => p.owners[0] === 'b')!;
  assert.equal(selectedGroup(d, parts, [childPart.id, other.id]), null);
});

void test('arrasto anda na grade de 1 cm e gruda na borda do vizinho', () => {
  const d = pair();
  const g = moveGroup(d, 'a')!;
  const boxes = moduleBoxes(d);
  assert.deepEqual(snapDelta(d, g, [123.4, 0, -7], boxes), [120, 0, 0]);
  // A borda direita de "a" (300) passa perto da esquerda de "b" (700): encosta.
  const touch = snapDelta(d, g, [370, 0, 0], boxes);
  assert.equal(touch[0], 400);
  // Perto do lugar de origem, volta exatamente para ele.
  assert.deepEqual(snapDelta(d, g, [30, 0, 25], boxes), [0, 0, 0]);
  // Nada abaixo do piso.
  assert.equal(snapDelta(d, g, [0, -300, 0], boxes)[1], 0);
});

void test('mover grava a posição da raiz; bater no vizinho é recusado com o motivo', () => {
  const d = pair();
  const g = moveGroup(d, 'a')!;
  const ok = tryOp(d, moveOp(d, g, [-500, 0, 200]));
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.design.modules.find((m) => m.id === 'a')!.position, [-500, 0, 200]);
  const hit = tryOp(d, moveOp(d, g, [800, 0, 0]));
  assert.equal(hit.ok, false);
  if (!hit.ok) assert.match(hit.reason, /sobrepostos/);
});

void test('girar 90° vira a raiz e dá a volta completa', () => {
  let d = pair();
  const g = moveGroup(d, 'a')!;
  for (let i = 0; i < 4; i++) {
    const r = tryOp(d, rotateOp(d, g));
    assert.equal(r.ok, true);
    if (r.ok) d = r.design;
  }
  assert.equal(d.modules.find((m) => m.id === 'a')!.rotation, 0);
});
