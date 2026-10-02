import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyModularOp, generateComposition, openAllGroups, openingLimit, openingPose, preset, PROFILE, SCHEMA_VERSION, SLIDE_TRACK, type Composition, type Module } from '../lib/composition';
import { fittingsOf, handlePlacement } from '../lib/fittings';
import { DEFAULT_PRICES, quoteOf } from '../lib/quote';
import { surfaceKind } from '../lib/scene-materials';

const box = (id: string, extra: Partial<Module> = {}): Module => ({ ...preset('niche', id), width: 1000, height: 2000, depth: 600, ...extra });
const one = (m: Module): Composition => ({ schemaVersion: SCHEMA_VERSION, profile: PROFILE, modules: [m], connections: [] });

void test('porta de correr: folhas em dois trilhos que se sobrepõem, prateleiras recuadas atrás delas', () => {
  let d = one(box('w'));
  d = applyModularOp(d, { kind: 'cell.split', id: 'w:root', axis: 'y', gapMm: 900 });
  d = applyModularOp(d, { kind: 'front.set', id: 'w:root', type: 'sliding', count: 2 });
  const g = generateComposition(d);
  const leaves = g.parts.filter((p) => p.motion?.type === 'slide');
  assert.equal(leaves.length, 2);
  const [a, b] = leaves;
  // Sobreposição de 30 mm e o trilho de trás recuado.
  assert.equal(Math.round(a.position[0] + a.size[0] / 2 - (b.position[0] - b.size[0] / 2)), 30);
  assert.equal(Math.round(a.position[2] - b.position[2]), SLIDE_TRACK);
  // A prateleira fica atrás das duas folhas.
  const shelf = g.parts.find((p) => p.kind === 'shelf')!;
  assert.ok(shelf.position[2] + shelf.size[2] / 2 <= b.position[2] - b.size[2] / 2 + 1e-6);
  // Cada folha corre até cobrir a outra, sem bater; abrir uma não mexe na outra.
  for (const leaf of leaves) assert.ok(openingLimit(g.parts, leaf.motion!.id) > 0.98, leaf.id);
  const open = openingPose(a, 1);
  assert.equal(Math.round(open.position[0] - a.position[0]), a.size[0] - 30);
  // Puxador do lado de onde a folha sai.
  assert.ok(handlePlacement(a)!.x < 0);
  assert.ok(handlePlacement(b)!.x > 0);
  const q = quoteOf(d, DEFAULT_PRICES);
  assert.equal(q.lines.find((l) => l.label.startsWith('Kit de porta de correr'))?.qty, 2);
  assert.equal(q.counts.hinges, 0);
});

void test('porta de correr: 2 a 4 folhas, nenhuma estreita demais', () => {
  let d = one(box('w', { width: 600 }));
  assert.throws(() => applyModularOp(d, { kind: 'front.set', id: 'w:root', type: 'sliding', count: 3 }), /menos de 250 mm; use menos folhas/);
  d = one(box('w', { width: 1200 }));
  const four = applyModularOp(d, { kind: 'front.set', id: 'w:root', type: 'sliding', count: 4 });
  const leaves = generateComposition(four).parts.filter((p) => p.motion?.type === 'slide');
  assert.deepEqual(leaves.map((p) => p.motion!.direction), [1, -1, 1, -1]);
  assert.throws(() => applyModularOp(d, { kind: 'front.set', id: 'w:root', type: 'sliding', count: 5 }), /2 a 4 folhas/);
});

void test('basculante: sobe girando na aresta de cima, com pistão e duas dobradiças', () => {
  let d = one(box('a', { width: 800, height: 400, depth: 350, wall: true, position: [0, 1500, 0] }));
  d = applyModularOp(d, { kind: 'front.set', id: 'a:root', type: 'flap' });
  const g = generateComposition(d);
  const flap = g.parts.find((p) => p.motion?.type === 'flap')!;
  assert.ok(openingLimit(g.parts, flap.motion!.id) > 0.98);
  const up = openingPose(flap, 1);
  // Aberta: passou da horizontal, com a borda de baixo para cima e para a frente.
  assert.ok(up.tilt! < -Math.PI / 2);
  assert.ok(up.position[1] > flap.position[1]);
  assert.ok(up.position[2] > flap.position[2]);
  // Puxador embaixo, no meio.
  const spec = handlePlacement(flap)!;
  assert.equal(spec.x, 0);
  assert.ok(spec.y < 0);
  const q = quoteOf(d, DEFAULT_PRICES);
  assert.equal(q.counts.hinges, 2);
  assert.equal(q.lines.find((l) => l.label === 'Pistão de basculante')?.qty, 1);
  // Vão alto demais para basculante.
  assert.throws(() => applyModularOp(one(box('b', { height: 900 })), { kind: 'front.set', id: 'b:root', type: 'flap' }), /basculante com 150 a 700 mm/);
});

void test('basculante embaixo de um módulo que avança não abre inteira; rente, abre', () => {
  let d = one(box('a', { width: 800, height: 400, depth: 350 }));
  d = applyModularOp(d, { kind: 'front.set', id: 'a:root', type: 'flap' });
  d = applyModularOp(d, { kind: 'module.add', id: 'b', preset: 'niche' });
  d = applyModularOp(d, { kind: 'module.edit', id: 'b', width: 800, height: 400, depth: 350 });
  d = applyModularOp(d, { kind: 'connect', parent: 'a', child: 'b', side: 'top', shared: false, align: 'back', offset: 0 });
  const flush = generateComposition(d);
  assert.ok(openingLimit(flush.parts, flush.parts.find((p) => p.motion?.type === 'flap')!.motion!.id) > 0.98);
  d = applyModularOp(d, { kind: 'disconnect', child: 'b' });
  d = applyModularOp(d, { kind: 'module.edit', id: 'b', depth: 600 });
  d = applyModularOp(d, { kind: 'connect', parent: 'a', child: 'b', side: 'top', shared: false, align: 'back', offset: 0 });
  const g = generateComposition(d);
  const flap = g.parts.find((p) => p.motion?.type === 'flap')!;
  assert.ok(openingLimit(g.parts, flap.motion!.id) < 0.98);
});

void test('vidro na folha de correr e na basculante: o miolo acompanha', () => {
  let d = one(box('w', { look: { front: 'glass' } }));
  d = applyModularOp(d, { kind: 'front.set', id: 'w:root', type: 'sliding', count: 2 });
  const g = generateComposition(d);
  assert.equal(g.parts.filter((p) => p.kind === 'insert').length, 2);
  assert.equal(fittingsOf(d).filter((f) => f.kind === 'handle').length, 2);
});

void test('abrir todas: a folha de correr de trás fica, a da frente corre por cima', () => {
  let d = one(box('w'));
  d = applyModularOp(d, { kind: 'front.set', id: 'w:root', type: 'sliding', count: 2 });
  d = applyModularOp(d, { kind: 'module.add', id: 'g', preset: 'drawers' });
  const parts = generateComposition(d).parts;
  const groups = openAllGroups(parts);
  assert.ok(groups.some((g) => g.endsWith(':leaf-0')));
  assert.ok(!groups.some((g) => g.endsWith(':leaf-1')));
  assert.equal(groups.filter((g) => g.includes(':drawer-')).length, 3);
});

void test('porta de serralheria: quadro de aço com tela ou almofada de madeira, cobrado por metro de tubo', () => {
  let d = one(box('a', { width: 800, height: 900, depth: 450, look: { front: 'framed', insertMaterialId: 'pine' } }));
  d = applyModularOp(d, { kind: 'front.set', id: 'a:root', type: 'double', materialId: 'steel-black' });
  const g = generateComposition(d);
  const doors = g.parts.filter((p) => p.kind === 'door');
  assert.deepEqual(doors.map((p) => p.category), ['metal', 'metal']);
  const panels = g.parts.filter((p) => p.kind === 'insert');
  // Almofada de pinus de 15 mm: chapa, entra no plano de corte, atrás da face do quadro.
  assert.deepEqual(panels.map((p) => [p.materialId, p.thickness]), [['pine', 15], ['pine', 15]]);
  assert.ok(panels[0].position[2] + panels[0].size[2] / 2 < doors[0].position[2] + doors[0].size[2] / 2);
  const q = quoteOf(d, DEFAULT_PRICES);
  const tube = q.lines.find((l) => l.label === 'Quadro das portas em aço preto (tubo 20 × 20)')!;
  const perimeter = doors.reduce((a, p) => a + (2 * (p.c + p.l)) / 1000, 0);
  assert.equal(tube.qty, Math.round(perimeter * 1.1 * 100) / 100);
  assert.ok(q.lines.some((l) => l.label.startsWith('Serralheria')));
  assert.ok(!q.lines.some((l) => l.label.startsWith('Usinagem')));
  assert.ok(q.plan.groups.some((g) => g.material === 'Pinus' && g.thickness === 15));
  // Aço só como quadro: porta lisa ou gaveta de aço não.
  assert.throws(() => applyModularOp(one(box('b')), { kind: 'front.set', id: 'b:root', type: 'single', materialId: 'steel-black' }), /Aço só no quadro de uma porta/);
  assert.throws(() => applyModularOp(one(box('c', { look: { front: 'mesh' } })), { kind: 'front.set', id: 'c:root', type: 'drawers', count: 2, materialId: 'steel-black' }), /Aço só no quadro de uma porta/);
});

void test('na cena, metal só vira tela no miolo: quadro, tampo e moldura de aço são chapa cheia', () => {
  let d = one(box('a', { width: 800, height: 900, depth: 450, look: { front: 'mesh', insertMaterialId: 'brass', top: { materialId: 'steel-brushed', thickness: 4, overhang: 10, edge: 'square' } } }));
  d = applyModularOp(d, { kind: 'front.set', id: 'a:root', type: 'double', materialId: 'steel-black' });
  const parts = generateComposition(d).parts.filter((p) => p.category === 'metal');
  const kinds = new Map(parts.map((p) => [p.kind, surfaceKind(p.materialId!, p.kind)]));
  assert.deepEqual(Object.fromEntries(kinds), { door: null, insert: 'mesh', slab: null });
  assert.equal(surfaceKind('nero', 'slab'), 'stone');
  assert.equal(surfaceKind('glass-ribbed', 'insert'), 'ribbed');
  assert.equal(surfaceKind('glass-clear', 'insert'), null);
});

void test('painel de ferramentas: chapa perfurada só em painel de parede, com usinagem', () => {
  let d: Composition = { schemaVersion: SCHEMA_VERSION, profile: PROFILE, modules: [{ ...preset('panel', 'p'), materialId: 'black' }], connections: [] };
  d = applyModularOp(d, { kind: 'module.edit', id: 'p', look: { front: 'perforated' } });
  const panel = generateComposition(d).parts.find((p) => p.kind === 'panel')!;
  assert.deepEqual(panel.face, { kind: 'perforated', pitch: 25 });
  assert.equal(quoteOf(d, DEFAULT_PRICES).lines.find((l) => l.label.startsWith('Usinagem'))?.qty, 1);
  assert.throws(() => generateComposition(one(box('a', { look: { front: 'perforated' } }))), /é só de painel de parede/);
});
