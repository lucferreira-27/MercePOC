import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FurnitureMotion,
  TRANSITION_MS,
  moduleCentres,
  visualPosition,
  EDGE,
} from '../lib/furniture-motion';
import { defaults, generate } from '../lib/furniture';
import { addShelf, generateDesign, migrateParams, resizeDesign } from '../lib/design';
import {
  PROFILE,
  applyModularOp,
  generateComposition,
  preset,
} from '../lib/composition';
void test('resizing reuses meshes, interpolates, and reaches exact canonical geometry', () => {
  const scene = new THREE.Scene(),
    motion = new FurnitureMotion(scene),
    design = migrateParams(defaults),
    original = generateDesign(design).parts;
  motion.update(original, design, false, [], 0);
  const base = motion.entries.get('base')!.mesh;
  const next = resizeDesign(design, { width: 1000, materialId: 'white' }),
    parts = generateDesign(next).parts;
  assert.equal(motion.entries.get('base')!.mesh, base);
  assert.equal(base.scale.x, 764);
  motion.update(parts, next, false, [], 100);
  motion.tick(100 + TRANSITION_MS / 2);
  motion.tick(100 + TRANSITION_MS);
  assert.equal(base.scale.x, 964);
  for (const p of parts) {
    const mesh = motion.entries.get(p.id)!.mesh;
    assert.deepEqual(mesh.scale.toArray(), p.size);
    assert.deepEqual(mesh.position.toArray(), p.position);
  }
  assert.equal(original.find((p) => p.id === 'base')!.c, 764);
  motion.dispose();
  assert.equal(scene.children.length, 0);
});
void test('rapid edits begin at current interpolated state without jumping', () => {
  const motion = new FurnitureMotion(new THREE.Scene());
  const design = migrateParams(defaults);
  motion.update(generate(defaults).parts, design, false, [], 0);
  const first = resizeDesign(design, { width: 1000 });
  motion.update(generateDesign(first).parts, first, false, [], 0);
  motion.tick(300);
  const mesh = motion.entries.get('base')!.mesh,
    current = mesh.scale.x;
  const next = resizeDesign(design, { width: 1100 });
  motion.update(generateDesign(next).parts, next, false, [], 300);
  assert.equal(mesh.scale.x, current);
  motion.tick(300 + TRANSITION_MS);
  assert.equal(mesh.scale.x, 1064);
  motion.dispose();
});
void test('shelves enter and exit gradually, can reappear mid-exit, and dispose after exit', () => {
  const motion = new FurnitureMotion(new THREE.Scene());
  const design = migrateParams(defaults);
  motion.update(generate(defaults).parts, design, false, [], 0);
  const added = addShelf(design, 2);
  motion.update(generateDesign(added).parts, added, false, [], 100);
  const id = added.shelves.at(-1)!.id;
  const shelf = motion.entries.get(id)!.mesh;
  const addedParts = generateDesign(added).parts;
  motion.update(addedParts, added, false, [], 100);
  assert.equal(shelf.material.opacity, 0);
  motion.tick(100 + TRANSITION_MS / 2);
  assert.equal(shelf.material.opacity, 0.5);
  const baseParts = generate(defaults).parts;
  motion.update(baseParts, design, false, [], 500);
  assert.equal(motion.pickable().includes(shelf), false);
  motion.tick(650);
  const opacity = shelf.material.opacity;
  motion.update(addedParts, added, false, [], 650);
  assert.equal(shelf.material.opacity, opacity);
  motion.tick(650 + TRANSITION_MS);
  assert.equal(shelf.material.opacity, 1);
  motion.update(baseParts, design, false, [], 1500);
  motion.tick(1500 + TRANSITION_MS);
  assert.equal(motion.entries.has(id), false);
  motion.dispose();
});
void test('exploded view separates every part from its own module centre', () => {
  const design = migrateParams(defaults);
  const parts = generateDesign(design).parts;
  const centres = moduleCentres(parts);
  const centreOf = (part: (typeof parts)[number]) =>
    centres.get((part as { owners?: string[] }).owners?.[0] ?? 'módulo')!;
  const distance = (part: (typeof parts)[number], exploded: boolean) =>
    visualPosition(part, centreOf(part), exploded).sub(centreOf(part)).length();
  // Nenhuma peça fica presa: todas se afastam do centro do seu módulo.
  for (const part of parts)
    assert.ok(
      distance(part, true) > distance(part, false),
      `${part.id} não se afastou`,
    );
  // As prateleiras se afastam: os vãos entre elas crescem.
  const shelfYs = (exploded: boolean) =>
    parts
      .filter((p) => p.kind === 'shelf')
      .map((p) => visualPosition(p, centreOf(p), exploded).y)
      .sort((a, b) => a - b);
  const gaps = (ys: number[]) =>
    ys.slice(1).map((y, i) => Math.round(y - ys[i]));
  const closedGaps = gaps(shelfYs(false)),
    openGaps = gaps(shelfYs(true));
  assert.equal(openGaps.length, closedGaps.length);
  for (const [i, gap] of openGaps.entries())
    assert.ok(
      gap > closedGaps[i],
      `vão ${i} não cresceu (${closedGaps[i]} → ${gap})`,
    );
});
void test('exploding one module does not drag its neighbours sideways', () => {
  // Dois módulos lado a lado: separar as peças de um não pode deslocar o
  // outro em bloco, que era o efeito de explodir em torno da origem.
  const d = applyModularOp(
    { schemaVersion: 3, profile: PROFILE, modules: [preset('shelf', 'a')], connections: [] },
    { kind: 'module.add', id: 'b', preset: 'shelf' },
  );
  const parts = generateComposition(d).parts;
  const centres = moduleCentres(parts);
  assert.equal(centres.size, 2);
  const aCentre = centres.get('a')!,
    bCentre = centres.get('b')!;
  const drift = (moduleId: string) => {
    const own = parts.filter(
      (p) => (p as { owners?: string[] }).owners?.[0] === moduleId,
    );
    const centre = centres.get(moduleId)!;
    const mean = (exploded: boolean) =>
      own.reduce(
        (sum, p) => sum.add(visualPosition(p, centre, exploded)),
        new THREE.Vector3(),
      ).divideScalar(own.length);
    return mean(true).sub(mean(false));
  };
  // O deslocamento médio de um módulo é o simétrico do outro em X.
  const a = drift('a'),
    b = drift('b');
  assert.ok(Math.abs(a.x - b.x) < 300, `deslocamento de a=${a.x}, b=${b.x}`);
  assert.ok(bCentre.x > aCentre.x);
  assert.equal(d.modules.length, 2);
});
void test('exploded positions and colors transition; reduced motion applies immediately', () => {
  const motion = new FurnitureMotion(new THREE.Scene());
  const design = migrateParams(defaults);
  motion.update(generateDesign(design).parts, design, false, [], 0);
  const before = motion.entries.get('back')!.mesh.position.z,
    parts = generateDesign(design).parts,
    centre = moduleCentres(parts).get(
      (parts.find((p) => p.id === 'back') as { owners?: string[] }).owners?.[0] ??
        'módulo',
    )!,
    target = visualPosition(
      parts.find((p) => p.id === 'back')!,
      centre,
      true,
    );
  motion.update(parts, design, true, ['back'], 100);
  motion.tick(100 + TRANSITION_MS / 2);
  // O ponto médio é a interpolação suave entre fechado e explodido.
  assert.ok(
    motion.entries.get('back')!.mesh.position.z < before &&
      motion.entries.get('back')!.mesh.position.z > target.z,
  );
  motion.tick(100 + TRANSITION_MS);
  assert.deepEqual(
    motion.entries.get('back')!.mesh.position.toArray(),
    target.toArray(),
  );
  motion.update(parts, design, false, [], 1000, true);
  assert.equal(motion.entries.get('back')!.mesh.position.z, before);
  assert.equal(
    motion.entries.get('back')!.mesh.material.color.getHexString(),
    'bd925c',
  );
  motion.dispose();
});
void test('hover emphasizes edges without moving geometry', () => {
  const motion = new FurnitureMotion(new THREE.Scene());
  const design = migrateParams(defaults);
  motion.update(generateDesign(design).parts, design, false, [], 0);
  motion.tick(TRANSITION_MS);
  const base = motion.entries.get('base')!;
  const x = base.mesh.scale.x;
  motion.setHover('base');
  motion.tick(TRANSITION_MS);
  assert.equal(base.mesh.scale.x, x);
  assert.equal(base.edge.material.opacity, EDGE.hotOpacity);
  assert.equal(`#${base.edge.material.color.getHexString()}`, EDGE.hot);
  motion.setHover(null);
  motion.tick(TRANSITION_MS);
  assert.equal(base.edge.material.opacity, EDGE.restOpacity);
  assert.equal(`#${base.edge.material.color.getHexString()}`, EDGE.rest);
  motion.dispose();
});
