import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FurnitureMotion,
  TRANSITION_MS,
  visualPosition,
} from '../lib/furniture-motion';
import { defaults, generate } from '../lib/furniture';
void test('resizing reuses meshes, interpolates, and reaches exact canonical geometry', () => {
  const scene = new THREE.Scene(),
    motion = new FurnitureMotion(scene),
    original = generate(defaults).parts;
  motion.update(original, defaults, false, null, 0);
  const base = motion.entries.get('base')!.mesh;
  const next = { ...defaults, width: 1000, materialId: 'white' as const },
    parts = generate(next).parts;
  motion.update(parts, next, false, null, 100);
  assert.equal(motion.entries.get('base')!.mesh, base);
  assert.equal(base.scale.x, 764);
  motion.tick(100 + TRANSITION_MS / 2);
  assert.equal(base.scale.x, 864);
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
  motion.update(generate(defaults).parts, defaults, false, null, 0);
  const first = { ...defaults, width: 1000 };
  motion.update(generate(first).parts, first, false, null, 0);
  motion.tick(300);
  const mesh = motion.entries.get('base')!.mesh,
    current = mesh.scale.x;
  const next = { ...defaults, width: 1100 };
  motion.update(generate(next).parts, next, false, null, 300);
  assert.equal(mesh.scale.x, current);
  motion.tick(300 + TRANSITION_MS);
  assert.equal(mesh.scale.x, 1064);
  motion.dispose();
});
void test('shelves enter and exit gradually, can reappear mid-exit, and dispose after exit', () => {
  const motion = new FurnitureMotion(new THREE.Scene());
  motion.update(generate(defaults).parts, defaults, false, null, 0);
  const added = { ...defaults, shelfCount: 5 };
  motion.update(generate(added).parts, added, false, null, 100);
  const shelf = motion.entries.get('shelf-5')!.mesh;
  assert.equal(shelf.material.opacity, 0);
  motion.tick(100 + TRANSITION_MS / 2);
  assert.equal(shelf.material.opacity, 0.5);
  motion.update(generate(defaults).parts, defaults, false, null, 500);
  assert.equal(motion.pickable().includes(shelf), false);
  motion.tick(650);
  const opacity = shelf.material.opacity;
  motion.update(generate(added).parts, added, false, null, 650);
  assert.equal(shelf.material.opacity, opacity);
  motion.tick(650 + TRANSITION_MS);
  assert.equal(shelf.material.opacity, 1);
  motion.update(generate(defaults).parts, defaults, false, null, 1500);
  motion.tick(1500 + TRANSITION_MS);
  assert.equal(motion.entries.has('shelf-5'), false);
  motion.dispose();
});
void test('exploded positions and colors transition; reduced motion applies immediately', () => {
  const motion = new FurnitureMotion(new THREE.Scene());
  motion.update(generate(defaults).parts, defaults, false, null, 0);
  const before = motion.entries.get('back')!.mesh.position.z,
    parts = generate(defaults).parts;
  motion.update(parts, defaults, true, 'back', 100);
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
  assert.equal(
    motion.entries.get('back')!.mesh.material.color.getHexString(),
    'c8f57c',
  );
  motion.update(parts, defaults, false, null, 1000, true);
  assert.equal(motion.entries.get('back')!.mesh.position.z, before);
  assert.equal(
    motion.entries.get('back')!.mesh.material.color.getHexString(),
    'bd925c',
  );
  motion.dispose();
});
