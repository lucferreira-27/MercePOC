import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FurnitureMotion, TRANSITION_MS } from '../lib/furniture-motion';
import {
  PROFILE,
  preset,
  generateComposition,
  openingPose,
  applyModularOp,
} from '../lib/composition';
import { normalize } from '../lib/studio';
void test('doors animate about their real hinge; rotated modules initialize and finish at canonical positions', () => {
  let d = normalize({
    schemaVersion: 3,
    profile: PROFILE,
    modules: [preset('rack', 'a')],
    connections: [],
  });
  const motion = new FurnitureMotion(new THREE.Scene()),
    parts = generateComposition(d).parts,
    door = parts.find((p) => p.kind === 'door')!,
    pivot = new THREE.Vector3(...door.motion!.pivot);
  motion.update(parts, d, false, [], 0);
  const original = motion.entries.get(door.id)!.mesh.position.distanceTo(pivot);
  motion.update(
    parts.map((p) => (p.id === door.id ? openingPose(p, 1) : p)),
    d,
    false,
    [],
    100,
  );
  motion.tick(100 + TRANSITION_MS / 2);
  assert.ok(
    Math.abs(
      motion.entries.get(door.id)!.mesh.position.distanceTo(pivot) - original,
    ) < 1e-6,
  );
  motion.tick(100 + TRANSITION_MS);
  assert.deepEqual(
    motion.entries.get(door.id)!.mesh.position.toArray(),
    openingPose(door, 1).position,
  );
  d = normalize(
    applyModularOp(d, {
      kind: 'module.edit',
      id: 'a',
      rotation: 90,
      position: [100, 0, 100],
    }),
  );
  const rotated = generateComposition(d).parts;
  motion.update(rotated, d, false, [], 1000);
  motion.tick(1000 + TRANSITION_MS);
  for (const part of rotated)
    assert.ok(
      motion.entries
        .get(part.id)!
        .mesh.position.distanceTo(new THREE.Vector3(...part.position)) < 1e-6,
    );
  motion.dispose();
  const fresh = new FurnitureMotion(new THREE.Scene());
  fresh.update(rotated, d, false, [], 0);
  for (const part of rotated)
    assert.deepEqual(
      fresh.entries.get(part.id)!.mesh.position.toArray(),
      part.position,
    );
  fresh.dispose();
});
