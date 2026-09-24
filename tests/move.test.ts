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

void test('parede presa: afastar o móvel abre folga, não leva a parede junto', async () => {
  const { wallAt, roomOffset, wallGap, fitReport } = await import('../lib/room');
  const d = pair();
  const bounds = generateComposition(d).bounds;
  const room = { schemaVersion: 1 as const, widthMm: 3000, heightMm: 2600, depthMm: 1500, offsetMm: 500 };
  // Sem âncora a parede acompanha: encostada atrás, a 500 mm do canto.
  const anchor = wallAt(room, bounds);
  assert.deepEqual(anchor, { x: bounds.min[0] - 500, z: bounds.min[2] });
  const pinned = { ...room, anchor };
  const moved = tryOp(d, moveOp(d, moveGroup(d, 'a')!, [-200, 0, 300]));
  assert.ok(moved.ok);
  if (!moved.ok) return;
  const after = generateComposition(moved.design).bounds;
  assert.equal(roomOffset(pinned, after), 300);
  assert.equal(wallGap(pinned, after), 0, 'o nicho "b" continua encostado');
  // Sem o vizinho, o nicho sozinho abre 30 cm de folga da parede presa.
  const solo: Composition = { ...moved.design, modules: moved.design.modules.filter((m) => m.id === 'a') };
  assert.equal(wallGap(pinned, generateComposition(solo).bounds), 300);
  assert.equal(fitReport(solo, pinned).fits, true);
  // Para trás da parede: o veredito acusa.
  const through = tryOp(solo, moveOp(solo, moveGroup(solo, 'a')!, [0, 0, -500]));
  assert.ok(through.ok);
  if (through.ok) assert.match(fitReport(through.design, pinned).issues[0].message, /atravessa a parede/);
});

void test('arrasto para trás para na parede', () => {
  const d = pair();
  const g = moveGroup(d, 'a')!;
  const boxes = moduleBoxes(d);
  const wall = generateComposition(d).bounds.min[2];
  assert.equal(snapDelta(d, g, [0, 0, -400], boxes, wall)[2], 0);
  assert.equal(snapDelta(d, g, [0, 0, 400], boxes, wall)[2], 400);
});

void test('soltar no lugar novo continua de onde está, sem voltar ao lugar antigo', async () => {
  const THREE = await import('three');
  const { FurnitureMotion } = await import('../lib/furniture-motion');
  const scene = new THREE.Scene();
  const motion = new FurnitureMotion(scene);
  const d = pair();
  const parts = generateComposition(d).parts;
  motion.update(parts, { height: 500, materialId: d.modules[0].materialId }, false, [], 0);
  const ids = new Set(parts.filter((p) => p.owners[0] === 'a').map((p) => p.id));
  const id = [...ids][0];
  const home = motion.entries.get(id)!.mesh.position.clone();
  motion.setDrag({ ids, modules: new Set(['a']), offset: new THREE.Vector3(-300, 0, 0), blocked: false });
  for (let t = 16; t <= 2000; t += 16) motion.tick(t);
  assert.ok(Math.abs(motion.entries.get(id)!.mesh.position.x - (home.x - 300)) < 1);
  // O projeto gravado chega com o nicho 300 mm à esquerda.
  const next = tryOp(d, moveOp(d, moveGroup(d, 'a')!, [-300, 0, 0]));
  assert.ok(next.ok);
  if (!next.ok) return;
  motion.rebaseDrag(new THREE.Vector3(-300, 0, 0));
  motion.update(generateComposition(next.design).parts, { height: 500, materialId: d.modules[0].materialId }, false, [], 2016);
  // Nenhum quadro volta ao lugar antigo.
  for (let t = 2016; t <= 3000; t += 16) {
    motion.tick(t);
    assert.ok(Math.abs(motion.entries.get(id)!.mesh.position.x - (home.x - 300)) < 1, `quadro ${t}`);
  }
  assert.equal(motion.moving, false);
});

void test('reaplicar as mesmas peças durante a prévia não dobra o deslocamento', async () => {
  const THREE = await import('three');
  const { FurnitureMotion } = await import('../lib/furniture-motion');
  const motion = new FurnitureMotion(new THREE.Scene());
  const d = pair();
  const parts = generateComposition(d).parts;
  const look = { height: 500, materialId: d.modules[0].materialId };
  motion.update(parts, look, false, [], 0);
  const ids = new Set(parts.filter((p) => p.owners[0] === 'a').map((p) => p.id));
  const id = [...ids][0];
  const home = motion.entries.get(id)!.mesh.position.x;
  motion.setDrag({ ids, modules: new Set(['a']), offset: new THREE.Vector3(-300, 0, 0), blocked: false });
  for (let t = 16; t <= 2000; t += 16) motion.tick(t);
  // A página redesenha ao soltar (seleção, ocupado): as mesmas peças de novo.
  motion.update(parts, look, false, [id], 2016);
  for (let t = 2016; t <= 2400; t += 16) {
    motion.tick(t);
    assert.ok(Math.abs(motion.entries.get(id)!.mesh.position.x - (home - 300)) < 1, `quadro ${t}: ${motion.entries.get(id)!.mesh.position.x}`);
  }
});
