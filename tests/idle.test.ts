import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FurnitureMotion, TRANSITION_MS } from '../lib/furniture-motion';
import { defaults } from '../lib/furniture';
import { generateDesign, migrateParams } from '../lib/design';
import { designOf, generateDesign as generateStudio, normalize, selectedPartIds } from '../lib/studio';
import { buildTemplate, templates } from '../lib/templates';

void test('a cena parada não redesenha: só estado novo ou transição em curso', () => {
  const motion = new FurnitureMotion(new THREE.Scene()),
    design = migrateParams(defaults),
    parts = generateDesign(design).parts;
  motion.update(parts, design, false, [], 0);
  assert.equal(motion.takeChanged(), true, 'a primeira pose precisa ser desenhada');
  motion.tick(16);
  assert.equal(motion.takeChanged(), false, 'nada mudou: nenhum quadro novo');
  // Passar o cursor sobre a mesma peça não é mudança; outra peça é.
  motion.setHover(parts[0].id);
  motion.tick(32);
  assert.equal(motion.takeChanged(), true);
  motion.setHover(parts[0].id);
  motion.tick(48);
  assert.equal(motion.takeChanged(), false);
  // Seleção nova anima até o fim e então para de pedir quadros.
  motion.update(parts, design, false, [parts[1].id], 100);
  motion.tick(100 + TRANSITION_MS / 2);
  assert.equal(motion.takeChanged(), true);
  motion.tick(100 + TRANSITION_MS);
  assert.equal(motion.takeChanged(), true, 'o último quadro da transição é desenhado');
  motion.tick(100 + TRANSITION_MS + 16);
  assert.equal(motion.takeChanged(), false);
  motion.dispose();
});

void test('o arrasto pede quadros até assentar e depois para', () => {
  const motion = new FurnitureMotion(new THREE.Scene()),
    design = migrateParams(defaults),
    parts = generateDesign(design).parts;
  motion.update(parts, design, false, [], 0);
  motion.takeChanged();
  const ids = new Set([parts[0].id]);
  motion.setDrag({ ids, modules: new Set(), offset: new THREE.Vector3(100, 0, 0), blocked: false });
  let t = 16, frames = 0;
  while (t < 3000) {
    motion.tick(t);
    if (motion.takeChanged()) frames++;
    t += 16;
  }
  assert.ok(frames > 5 && frames < 120, `quadros do arrasto: ${frames}`);
  const mesh = motion.entries.get(parts[0].id)!.mesh;
  assert.ok(Math.abs(mesh.position.x - (parts[0].position[0] + 100)) < 0.5);
  motion.tick(t + 16);
  assert.equal(motion.takeChanged(), false, 'assentado, a cena descansa');
  motion.dispose();
});

void test('designOf gera uma vez por versão e devolve o mesmo que generateDesign', () => {
  const d = normalize(buildTemplate(templates[0]));
  const a = designOf(d);
  assert.equal(designOf(d), a, 'a mesma versão não é gerada de novo');
  assert.deepEqual(a.parts, generateStudio(d).parts);
  // Outra versão (objeto novo) gera o dela.
  const copy = structuredClone(d);
  assert.notEqual(designOf(copy), a);
  assert.deepEqual(selectedPartIds(d, [d.modules[0].id]), selectedPartIds(copy, [d.modules[0].id]));
});
