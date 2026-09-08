import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FurnitureMotion,
  TRANSITION_MS,
  visualPosition,
} from '../lib/furniture-motion';
import { defaults, generate } from '../lib/furniture';
import { addShelf, generateDesign, migrateParams, resizeDesign } from '../lib/design';
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
void test('exploded positions and colors transition; reduced motion applies immediately', () => {
  const motion = new FurnitureMotion(new THREE.Scene());
  const design = migrateParams(defaults);
  motion.update(generateDesign(design).parts, design, false, [], 0);
  const before = motion.entries.get('back')!.mesh.position.z,
    parts = generateDesign(design).parts;
  motion.update(parts, design, true, ['back'], 100);
  motion.tick(100 + TRANSITION_MS / 2);
  assert.equal(motion.entries.get('back')!.mesh.position.z, before - 140);
  motion.tick(100 + TRANSITION_MS);
  assert.deepEqual(
    motion.entries.get('back')!.mesh.position.toArray(),
    visualPosition(
      parts.find((p) => p.id === 'back')!,
      defaults.height,
      true,
    ).toArray(),
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
  assert.equal(base.edge.material.opacity, 0.9);
  assert.equal(base.edge.material.color.getHexString(), '5ea336');
  motion.setHover(null);
  motion.tick(TRANSITION_MS);
  assert.equal(base.edge.material.opacity, 0.25);
  assert.equal(base.edge.material.color.getHexString(), '302b24');
  motion.dispose();
});
