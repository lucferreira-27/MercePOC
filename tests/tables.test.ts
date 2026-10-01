import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyModularOp, generateComposition, preset, PROFILE, SCHEMA_VERSION, type Composition, type Module } from '../lib/composition';
import { drawingParts, fittingsOf } from '../lib/fittings';
import { DEFAULT_PRICES, quoteOf } from '../lib/quote';
import { applyStyle } from '../lib/styles';
import { tableSpec } from '../lib/tables';

/**
 * Mesa e estrutura aberta (`kind: 'table'`): tampo em cima de uma base, níveis
 * embaixo e gavetas no avental. Cada base vira as ferragens dela, com preço; a
 * validação diz o motivo de cada recusa.
 */
const table = (extra: Partial<Module> = {}): Module => ({ ...preset('table', 'm'), materialId: 'oak-solid', ...extra });
const one = (...modules: Module[]): Composition => ({ schemaVersion: SCHEMA_VERSION, profile: PROFILE, modules, connections: [] });
const fails = (m: Partial<Module>, pattern: RegExp) => assert.throws(() => generateComposition(one(table(m))), pattern);

void test('mesa de pés: tampo, avental entre os pés, nível embaixo e gavetas com caixa e puxador', () => {
  const d = one(table({ shelves: 1, drawers: 2, look: { legs: 'tapered', top: { materialId: 'walnut-solid', thickness: 30, overhang: 25, edge: 'rounded' } } }));
  const g = generateComposition(d);
  const slab = g.parts.find((p) => p.id === 'm:slab')!;
  assert.deepEqual([slab.size, slab.position[1], slab.c, slab.l], [[1200, 30, 600], 735, 1200, 600]);
  assert.deepEqual(slab.face, { kind: 'edge', profile: 'rounded', radius: 10 });
  // Com gaveta, a frente do avental é das gavetas: fundo e laterais ficam.
  assert.deepEqual(g.parts.filter((p) => p.kind === 'apron').map((p) => p.id).sort(), ['m:apron-back', 'm:apron-left', 'm:apron-right']);
  assert.equal(g.parts.filter((p) => p.kind === 'shelf').length, 1);
  const fronts = g.parts.filter((p) => p.id.endsWith(':front'));
  assert.equal(fronts.length, 2);
  assert.ok(fronts.every((p) => p.motion?.type === 'drawer' && p.handle?.type === 'bar'));
  // O piso conta: a mesa começa no chão, não na prateleira de baixo.
  assert.equal(g.bounds.min[1], 0);
  const f = fittingsOf(d);
  assert.equal(f.filter((v) => v.kind === 'leg' && v.type === 'tapered').length, 4);
  assert.equal(f.filter((v) => v.kind === 'handle').length, 2);
  assert.equal(quoteOf(d, DEFAULT_PRICES).lines.find((l) => l.label === 'Pé cônico de madeira')?.qty, 4);
});

void test('cada base vira as ferragens dela, com preço', () => {
  const kinds = (look: Module['look'], extra: Partial<Module> = {}) => fittingsOf(one(table({ look, ...extra }))).map((f) => `${f.kind}:${f.type}`);
  assert.deepEqual(kinds({ legs: 'frame' }, { shelves: 3, height: 1500, depth: 400 }), ['stand:frame']);
  assert.deepEqual(kinds({ legs: 'sled' }), ['stand:sled', 'stand:sled']);
  assert.deepEqual(kinds({ legs: 'trestle' }), ['leg:trestle', 'leg:trestle', 'leg:beam']);
  assert.deepEqual(kinds({ legs: 'casters' }, { shelves: 2 }), ['stand:frame', 'leg:casters', 'leg:casters', 'leg:casters', 'leg:casters']);
  assert.deepEqual(kinds({ legs: 'wall' }, { wall: true }), ['leg:wall', 'leg:wall']);
  // Estrutura de aço: um quadro embaixo de cada nível, cobrado por metro de tubo.
  const shelf = one(table({ look: { legs: 'frame' }, shelves: 3, height: 1500, depth: 400, width: 1000 }));
  const stand = fittingsOf(shelf).find((f) => f.kind === 'stand')!;
  assert.equal(stand.levels?.length, 3);
  const q = quoteOf(shelf, DEFAULT_PRICES);
  assert.ok(q.lines.some((l) => l.label.startsWith('Estrutura em aço preto')));
  assert.equal(quoteOf(one(table({ look: { legs: 'trestle' } })), DEFAULT_PRICES).lines.find((l) => l.label.startsWith('Cavalete'))?.qty, 2);
  // O desenho mostra os tubos da estrutura, não um bloco cheio embaixo da mesa.
  const drawn = drawingParts(shelf).filter((p) => p.id.startsWith('m:stand'));
  assert.ok(drawn.length > 10 && drawn.every((p) => Math.min(...p.size) <= 20));
});

void test('validação da mesa em frases', () => {
  fails({ look: { legs: 'plinth' } }, /rodapé recuado não é base de mesa/);
  fails({ feet: 100 }, /mesa não usa feet/);
  fails({ look: { legs: 'wall' } }, /pede wall: true/);
  fails({ height: 450, shelves: 4 }, /4 níveis não cabem/);
  fails({ width: 500, drawers: 2 }, /2 gavetas não cabem/);
  fails({ depth: 250, drawers: 1 }, /gaveta pede \d+ mm de fundo/);
  fails({ look: { legs: 'wall' }, wall: true, shelves: 1 }, /parede não leva nível/);
  fails({ look: { frame: true } }, /mesa não leva frame/);
  fails({ materialId: 'marble' }, /chapa ou madeira maciça/);
  fails({ look: { top: { materialId: 'glass-clear', thickness: 30, overhang: 20, edge: 'square' } } }, /tampo de vidro com 6 a 19 mm/);
  // Caixa não leva nível nem gaveta de mesa; mesa não tem compartimento nem conexão.
  assert.throws(() => generateComposition(one({ ...preset('niche', 'b'), shelves: 2 })), /são de mesa/);
  const d = one(table(), { ...preset('niche', 'b'), position: [2000, 0, 0] });
  assert.throws(() => applyModularOp(d, { kind: 'cell.split', id: 'm:root', axis: 'y' }), /module.edit \{shelves, drawers\}/);
  assert.throws(() => applyModularOp(d, { kind: 'connect', parent: 'b', child: 'm', side: 'right', shared: false, align: 'front', offset: 0 }), /é uma mesa .* não se conecta/);
});

void test('mesa pelo contrato: module.add com preset table e module.edit com níveis e gavetas', () => {
  let d = one({ ...preset('niche', 'b') });
  d = applyModularOp(d, { kind: 'module.add', id: 't', preset: 'table' });
  d = applyModularOp(d, { kind: 'module.edit', id: 't', shelves: 1, drawers: 1, look: { legs: 'hairpin' } });
  const t = d.modules.find((m) => m.id === 't')!;
  assert.deepEqual([t.kind, t.shelves, t.drawers, t.look?.legs], ['table', 1, 1, 'hairpin']);
  d = applyModularOp(d, { kind: 'module.edit', id: 't', shelves: 0, drawers: 0 });
  const back = d.modules.find((m) => m.id === 't')!;
  assert.ok(!('shelves' in back) && !('drawers' in back));
});

void test('estilo na mesa: base e tampo do estilo; rodízio, parede, estrutura com níveis e tampo de vidro ficam', () => {
  const dressed = applyStyle(one(table({ look: { legs: 'tapered' } })), 'rustic').modules[0];
  assert.deepEqual([dressed.look?.legs, dressed.look?.top?.materialId, dressed.height], ['trestle', 'pine-solid', 750]);
  const cart = applyStyle(one(table({ shelves: 2, look: { legs: 'casters' } })), 'midcentury').modules[0];
  assert.equal(cart.look?.legs, 'casters');
  const shelf = applyStyle(one(table({ shelves: 3, height: 1500, look: { legs: 'frame' } })), 'scandinavian').modules[0];
  assert.equal(shelf.look?.legs, 'frame');
  const vanity = applyStyle(one(table({ drawers: 2, look: { legs: 'tapered', top: { materialId: 'glass-clear', thickness: 10, overhang: 20, edge: 'rounded' } } })), 'classic').modules[0];
  assert.deepEqual([vanity.look?.legs, vanity.look?.top?.materialId], ['turned', 'glass-clear']);
  // A altura da mesa é a do tampo: o estilo troca o tampo e a base embaixo dele cede.
  assert.equal(tableSpec(dressed).lh, 750 - 40);
});

void test('painel de parede com ganchos de cabideiro, cobrados por unidade', () => {
  const panel: Module = { ...preset('panel', 'p'), width: 1200, height: 900, hooks: 5 };
  const d = one(panel);
  const hooks = fittingsOf(d).filter((f) => f.kind === 'hook');
  assert.equal(hooks.length, 5);
  assert.equal(quoteOf(d, DEFAULT_PRICES).lines.find((l) => l.label === 'Gancho de cabideiro')?.qty, 5);
  assert.throws(() => generateComposition(one({ ...panel, hooks: 16, width: 1000 })), /16 ganchos não cabem/);
  assert.throws(() => generateComposition(one({ ...preset('niche', 'b'), hooks: 2 })), /gancho de cabideiro vai em painel/);
});
