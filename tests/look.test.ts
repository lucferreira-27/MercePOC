import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyModularOp,
  generateComposition,
  openingLimit,
  openingPose,
  preset,
  PROFILE,
  SCHEMA_VERSION,
  type Composition,
  type Module,
} from '../lib/composition';
import { categoryOf, materials, sheetIds } from '../lib/furniture';
import { cutPlan, materialFromLabel } from '../lib/cutplan';
import { fittingsOf, drawingParts } from '../lib/fittings';
import { describeLook, lookChanges, type Look } from '../lib/look';
import { DEFAULT_PRICES, mergePrices, quote, quoteOf } from '../lib/quote';
import { describeDesignChanges, normalize } from '../lib/studio';

const box = (id: string, extra: Partial<Module> = {}): Module => ({ ...preset('niche', id), width: 600, height: 700, depth: 450, ...extra });
const one = (m: Module): Composition => ({ schemaVersion: SCHEMA_VERSION, profile: PROFILE, modules: [m], connections: [] });
/** Fileira de `n` caixas com painel compartilhado, montada pelo contrato. */
function row(n: number, extra: Partial<Module> = {}): Composition {
  let d = one(box('a1', extra));
  for (let i = 2; i <= n; i++) {
    d = applyModularOp(d, { kind: 'module.add', id: `a${i}`, preset: 'niche' });
    d = applyModularOp(d, { kind: 'module.edit', id: `a${i}`, width: 600, height: 700, depth: 450, position: [9000 + i * 1000, 0, 0] });
    d = applyModularOp(d, { kind: 'connect', parent: `a${i - 1}`, child: `a${i}`, side: 'right', shared: true, align: 'back', offset: 0 });
  }
  return d;
}
const withLook = (d: Composition, look: Look, ids = d.modules.map((m) => m.id)): Composition => ({
  ...d,
  modules: d.modules.map((m) => (ids.includes(m.id) ? { ...m, look: { ...m.look, ...look } } : m)),
});
const marble = { materialId: 'marble', thickness: 20, overhang: 20, edge: 'rounded' } as const;

void test('catálogo: cada material tem categoria, e nome não confunde o plano de corte', () => {
  for (const m of materials) assert.ok(['sheet', 'solid', 'metal', 'glass', 'stone', 'fiber'].includes(m.category), m.id);
  assert.equal(new Set(materials.map((m) => m.name)).size, materials.length);
  assert.deepEqual(sheetIds.slice(0, 9), ['white', 'sand', 'oak', 'freijo', 'walnut', 'sage', 'petrol', 'graphite', 'black']);
  // "Carvalho defumado 18" não é "Carvalho natural" nem o maciço.
  assert.equal(materialFromLabel('Carvalho defumado 18')?.id, 'smoked');
  assert.equal(materialFromLabel('Defumado maciço 30')?.id, 'smoked-solid');
  for (const id of ['marble', 'glass-clear', 'steel-black', 'cane', 'oak-solid']) assert.notEqual(categoryOf(id), 'sheet');
});

void test('validação: corpo, frente, pé, tampo e fundo com a categoria certa, em frase', () => {
  const fails = (m: Module, re: RegExp) => assert.throws(() => generateComposition(one(m)), re);
  fails(box('a', { materialId: 'marble' }), /corpo em Mármore branco não dá: o corpo é de chapa/);
  fails(box('a', { feet: 30, look: { legs: 'hairpin' } }), /Pés: 0 \(sem pés\) ou de 50 a 300 mm|pé grampo de 100 a 300 mm/);
  fails(box('a', { feet: 80, look: { legs: 'hairpin' } }), /pé grampo de 100 a 300 mm \(pediu 80\)/);
  fails(box('a', { look: { legs: 'tube' } }), /pé de tubo quadrado pede a altura em feet/);
  fails(box('a', { feet: 150, look: { legs: 'hairpin', legMaterialId: 'oak' } }), /pé grampo em metal/);
  fails(box('a', { feet: 150, look: { legs: 'trestle' } }), /cavalete não vai em caixa/);
  fails(box('a', { feet: 60, look: { legs: 'turned' } }), /pé torneado de 100 a 300 mm \(pediu 60\)/);
  fails(box('a', { look: { top: { materialId: 'glass-clear', thickness: 30, overhang: 0, edge: 'square' } } }), /tampo de vidro com 6 a 19 mm/);
  fails(box('a', { look: { top: { materialId: 'cane', thickness: 10, overhang: 0, edge: 'square' } } }), /tampo de palhinha não existe/);
  fails(box('a', { look: { top: marble, cornice: true } }), /moldura no topo e tampo sobreposto não vão juntos/);
  fails(box('a', { back: false, look: { backMaterialId: 'sage' } }), /módulo sem fundo/);
  fails(box('a', { look: { front: 'glass', insertMaterialId: 'steel-black' } }), /frente de vidro com quadro leva vidro/);
  fails({ ...preset('panel', 'p'), look: { legs: 'tube' } }, /painel de parede aceita só superfície lisa, ripada ou perfurada e LED/);
  const drawer = box('a');
  drawer.root.front = { id: 'f', type: 'drawers', hinge: 'left', heights: [1, 1], style: 'glass' };
  fails(drawer, /gaveta não leva de vidro com quadro/);
  const stone = box('a');
  stone.root.front = { id: 'f', type: 'single', hinge: 'left', heights: [1], materialId: 'marble' };
  fails(stone, /frente em Mármore branco não dá/);
});

void test('tampo sobreposto: uma peça por fileira, avanço na frente e nas pontas livres, fora do plano de corte', () => {
  const d = withLook(row(3), { top: marble });
  const g = generateComposition(d);
  const slabs = g.parts.filter((p) => p.kind === 'slab');
  assert.equal(slabs.length, 1);
  const s = slabs[0];
  assert.deepEqual(s.owners, ['a1', 'a2', 'a3']);
  // Três caixas de 600 com dois painéis divididos: 1764 + 20 de cada lado.
  assert.equal(Math.round(s.size[0]), 3 * 600 - 2 * 18 + 40);
  assert.equal(Math.round(s.size[2]), 470);
  assert.equal(Math.round(s.position[1] - s.size[1] / 2), 700);
  assert.equal(s.category, 'stone');
  assert.deepEqual(s.face, { kind: 'edge', profile: 'rounded', radius: 10 });
  assert.ok(!cutPlan(g.parts).sheets.some((sh) => sh.placements.some((v) => v.id === s.id)));
  const q = quoteOf(d, DEFAULT_PRICES);
  const line = q.lines.find((l) => l.label === 'Mármore branco 20 mm')!;
  assert.equal(line.section, 'Materiais');
  assert.equal(line.unit, 'm²');
  assert.ok(Math.abs(line.qty - Math.round(1.804 * 0.47 * 1.15 * 100) / 100) < 0.011);
  assert.ok(q.lines.some((l) => l.label.startsWith('Acabamento de borda da pedra')));
});

void test('tampo: vizinho mais alto barra o avanço; tampos diferentes se encontram no meio do painel', () => {
  let d = row(3);
  d = applyModularOp(d, { kind: 'module.add', id: 'tall', preset: 'niche' });
  d = applyModularOp(d, { kind: 'module.edit', id: 'tall', width: 500, height: 1800, depth: 450, position: [9000, 0, 0] });
  d = applyModularOp(d, { kind: 'connect', parent: 'a3', child: 'tall', side: 'right', shared: false, align: 'back', offset: 0 });
  const g = generateComposition(withLook(d, { top: marble }, ['a1', 'a2', 'a3']));
  const slab = g.parts.find((p) => p.kind === 'slab')!;
  const right = slab.position[0] + slab.size[0] / 2;
  const tallLeft = Math.min(...g.parts.filter((p) => p.owners.includes('tall')).map((p) => p.position[0] - p.size[0] / 2));
  assert.ok(Math.abs(right - tallLeft) < 0.01, `tampo para rente na torre: ${right} × ${tallLeft}`);
  // Meio da fileira com outro tampo: duas peças, sem sobrepor.
  const mixed = withLook(withLook(row(3), { top: marble }), { top: { materialId: 'oak-solid', thickness: 30, overhang: 20, edge: 'square' } }, ['a2']);
  const parts = generateComposition(mixed).parts.filter((p) => p.kind === 'slab');
  assert.equal(parts.length, 3);
});

void test('rodapé recuado e base aparente: chapa embaixo da caixa, fileira sem colisão', () => {
  const plinth = generateComposition(withLook(row(3, { feet: 100 }), { legs: 'plinth' }));
  const boards = plinth.parts.filter((p) => p.kind === 'plinth');
  assert.equal(boards.length, 3);
  for (const b of boards) {
    assert.equal(Math.round(b.position[1]), 50);
    assert.equal(Math.round(b.position[2] + b.size[2] / 2), 225 - 40);
  }
  const skirt = generateComposition(withLook(row(3, { feet: 100 }), { legs: 'skirt' }));
  // Frente em cada módulo e lateral só nas pontas da fileira.
  assert.equal(skirt.parts.filter((p) => p.kind === 'plinth').length, 5);
  const q = quoteOf(withLook(row(3, { feet: 100 }), { legs: 'plinth' }), DEFAULT_PRICES);
  assert.equal(q.lines.find((l) => l.label === 'Sapata niveladora do rodapé')?.qty, 12);
});

void test('moldura no topo: faixa, laterais nas pontas livres e capa; nada em cima dela', () => {
  const d = withLook(row(2, { height: 2000 }), { cornice: true });
  const parts = generateComposition(d).parts.filter((p) => p.kind === 'cornice');
  assert.deepEqual(parts.map((p) => p.id.split(':')[1]), ['cornice', 'cornice-left', 'cornice-right', 'cornice-cap']);
  const cap = parts.at(-1)!;
  assert.equal(Math.round(cap.position[1] + cap.size[1] / 2), 2000 + 40 + 18);
  let stacked = applyModularOp(d, { kind: 'module.add', id: 'up', preset: 'niche' });
  assert.throws(() => applyModularOp(stacked, { kind: 'connect', parent: 'a1', child: 'up', side: 'top', shared: false, align: 'back', offset: 0 }), /tem moldura no topo/);
  stacked = applyModularOp(withLook(row(1), { top: marble }), { kind: 'module.add', id: 'up', preset: 'niche' });
  stacked = applyModularOp(stacked, { kind: 'connect', parent: 'a1', child: 'up', side: 'top', shared: false, align: 'back', offset: 0 });
  // Em cima de um tampo, o módulo apoia no tampo.
  assert.equal(stacked.modules.find((m) => m.id === 'up')!.position[1], 720);
});

void test('porta de vidro: quadro vazado com o miolo, que abre junto; gaveta do mesmo módulo leva moldura', () => {
  const m = box('a', { look: { front: 'glass', insertMaterialId: 'glass-smoked', handle: 'knob', handleMaterialId: 'brass' } });
  m.root.split = { id: 'a:div', axis: 'y', ratio: 0.3, children: [{ id: 'a:low', front: { id: 'fl', type: 'drawers', hinge: 'left', heights: [1] } }, { id: 'a:high', front: { id: 'fh', type: 'double', hinge: 'left', heights: [1] } }] };
  const g = generateComposition(one(m));
  const doors = g.parts.filter((p) => p.kind === 'door');
  const inserts = g.parts.filter((p) => p.kind === 'insert');
  assert.equal(doors.length, 2);
  assert.equal(inserts.length, 2);
  assert.equal(doors[0].face?.kind, 'frame');
  assert.equal(inserts[0].materialId, 'glass-smoked');
  assert.equal(inserts[0].motion?.id, doors[0].motion?.id);
  assert.equal(g.parts.find((p) => p.id === 'fl:drawer-0:front')?.face?.kind, 'shaker');
  assert.deepEqual(doors[0].handle, { type: 'knob', materialId: 'brass' });
  // Abre inteira e o vidro gira com a porta, preso no quadro.
  assert.ok(openingLimit(g.parts, doors[0].motion!.id) > 0.98);
  const [door, glass] = [openingPose(doors[0], 1), openingPose(inserts[0], 1)];
  assert.ok(Math.abs(door.rotation - glass.rotation) < 1e-9);
  assert.ok(Math.hypot(door.position[0] - glass.position[0], door.position[2] - glass.position[2]) < 10);
  const q = quoteOf(one(m), DEFAULT_PRICES);
  assert.ok(q.lines.some((l) => l.section === 'Materiais' && l.label === 'Vidro fumê 4 mm'));
  assert.equal(q.lines.find((l) => l.label === 'Puxador botão')?.qty, 3);
  assert.equal(q.lines.find((l) => l.label.startsWith('Usinagem'))?.qty, 3);
});

void test('frente por frente: estilo e puxador próprios, null volta ao do módulo', () => {
  let d = one(box('a', { look: { front: 'shaker', handle: 'cup' } }));
  d = applyModularOp(d, { kind: 'front.set', id: 'a:root', type: 'single', style: 'slatted', handle: 'none' });
  let door = generateComposition(d).parts.find((p) => p.kind === 'door')!;
  assert.deepEqual([door.face?.kind, door.handle?.type], ['slatted', 'none']);
  d = applyModularOp(d, { kind: 'front.set', id: 'a:root', type: 'single', style: null, handle: null });
  door = generateComposition(d).parts.find((p) => p.kind === 'door')!;
  assert.deepEqual([door.face?.kind, door.handle?.type], ['shaker', 'cup']);
  const q = quoteOf(applyModularOp(d, { kind: 'front.set', id: 'a:root', type: 'single', handle: 'none' }), DEFAULT_PRICES);
  assert.equal(q.lines.find((l) => l.label === 'Fecho toque (sem puxador)')?.qty, 1);
});

void test('acabamento pelo contrato: remendo com null, base que vale para a fileira, pés 0 tiram a base', () => {
  let d = row(3, { feet: 150 });
  d = applyModularOp(d, { kind: 'module.edit', id: 'a2', look: { legs: 'hairpin', handle: 'knob' } });
  assert.deepEqual(d.modules.map((m) => m.look?.legs), ['hairpin', 'hairpin', 'hairpin']);
  assert.deepEqual(d.modules.map((m) => m.look?.handle), [undefined, 'knob', undefined]);
  d = applyModularOp(d, { kind: 'module.edit', id: 'a2', look: { handle: null } });
  assert.equal(d.modules[1].look?.handle, undefined);
  d = applyModularOp(d, { kind: 'module.edit', id: 'a1', feet: 0 });
  assert.ok(d.modules.every((m) => !m.feet && !m.look));
  // Ligado com painel compartilhado, o vizinho fica com a mesma base.
  let e = one(box('a', { feet: 100, look: { legs: 'plinth' } }));
  e = applyModularOp(e, { kind: 'module.add', id: 'b', preset: 'niche' });
  e = applyModularOp(e, { kind: 'connect', parent: 'a', child: 'b', side: 'right', shared: true, align: 'back', offset: 0 });
  assert.equal(e.modules[1].look?.legs, 'plinth');
});

void test('ferragens: pés de cada tipo dentro da planta, estrutura em metros, LED e contorno', () => {
  for (const legs of ['palito', 'tapered', 'splayed', 'block', 'bun', 'hairpin', 'tube', 'pipe', 'casters'] as const) {
    const feet = legs === 'bun' || legs === 'casters' ? 80 : 200;
    const d = one(box('a', { feet, look: { legs } }));
    const legsFit = fittingsOf(d).filter((f) => f.kind === 'leg');
    assert.equal(legsFit.length, 4, legs);
    for (const f of legsFit) {
      assert.ok(Math.abs(f.position[0]) + f.size[0] / 2 <= 300 + 1e-6, `${legs} passa da largura`);
      assert.ok(Math.abs(f.position[2]) + f.size[2] / 2 <= 225 + 1e-6, `${legs} passa da profundidade`);
      assert.equal(f.bom.qty, 1);
    }
  }
  const legacy = fittingsOf(one(box('a', { feet: 150 }))).filter((f) => f.kind === 'leg');
  assert.deepEqual(legacy.map((f) => f.bom.qty), [0, 0, 0, 0], 'pé palito da v3 segue fora do orçamento');
  const stand = fittingsOf(one(box('a', { feet: 200, look: { legs: 'frame' } })));
  assert.equal(stand.length, 1);
  assert.equal(Math.round(stand[0].bom.qty * 1000), 4 * 200 + 2 * 560 + 2 * 410);
  const framed = fittingsOf(withLook(row(2), { frame: true, led: true }));
  // Contorno do conjunto: 12 arestas por fora e, na junta, só a coluna da
  // frente (sem cruzar o tampo nem o fundo): 4 + 4 + 1 no primeiro, 4 + 4 no segundo.
  assert.equal(framed.filter((f) => f.kind === 'frame').length, 17);
  assert.equal(framed.filter((f) => f.kind === 'led').length, 2);
  const q = quoteOf(withLook(row(2), { frame: true }), DEFAULT_PRICES);
  assert.ok(q.lines.some((l) => l.label === 'Estrutura em aço preto (tubo 20 × 20)'));
  assert.ok(q.lines.some((l) => l.label.startsWith('Serralheria')));
  // O desenho (render_look, PDF) mostra pés, contorno e puxadores.
  const drawn = drawingParts(withLook(row(2, { feet: 150 }), { legs: 'tube', frame: true }));
  assert.ok(drawn.some((p) => p.id.endsWith(':foot-0')) && drawn.some((p) => p.id.includes(':frame-')));
});

void test('orçamento: tabela salva da v3 continua valendo, com as ferragens novas no padrão', () => {
  const saved = { ...structuredClone(DEFAULT_PRICES), handle: 30 } as Record<string, unknown>;
  delete saved.hardware;
  (saved.sheets as Record<string, number>) = { white: 300 };
  const p = mergePrices(saved);
  assert.equal(p.handle, 30);
  assert.equal(p.sheets.white, 300);
  assert.equal(p.sheets.marble, DEFAULT_PRICES.sheets.marble);
  assert.deepEqual(p.hardware, DEFAULT_PRICES.hardware);
  // Sem quoteOf (só as peças), o orçamento da v3 sai igual.
  const d = one(box('a'));
  assert.equal(quote(generateComposition(d).parts, 1, DEFAULT_PRICES).total, quoteOf(d, DEFAULT_PRICES).total);
});

void test('acabamento em frases para o cartão de mudanças e para a IA', () => {
  const look: Look = { legs: 'splayed', legMaterialId: 'walnut-solid', handle: 'groove', front: 'cane', top: { materialId: 'oak-solid', thickness: 30, overhang: 15, edge: 'chamfer' }, backMaterialId: 'petrol', led: true };
  assert.deepEqual(describeLook({ feet: 180, look }), [
    'pé inclinado de 180 mm em nogueira maciça',
    'cava (puxador usinado)',
    'frente de palhinha com quadro',
    'tampo de carvalho maciço 30 mm, avanço de 15 mm, borda chanfrada',
    'fundo em azul petróleo',
    'fita de LED',
  ]);
  assert.deepEqual(lookChanges({ look }, { look: { ...look, led: undefined, handle: 'knob' } }), ['puxador botão', 'sem LED']);
  const before = normalize(one(box('a', { feet: 150 })));
  const after = normalize(applyModularOp(before, { kind: 'module.edit', id: 'a', look: { legs: 'tube', legMaterialId: 'steel-black' } }));
  assert.ok(describeDesignChanges(before, after).includes('Nicho: pé de tubo quadrado de 150 mm em aço preto'));
});

void test('pés escolhidos vão por fileira: pontas e só os apoios que o vão pede', () => {
  // Três caixas de 600 (1764 mm): quatro pés nas pontas, como um aparador.
  const short = fittingsOf(withLook(row(3, { feet: 200 }), { legs: 'splayed' })).filter((f) => f.kind === 'leg');
  assert.equal(short.length, 4);
  // Quatro caixas (2346 mm): um par no meio, na junta do meio.
  const long = withLook(row(4, { feet: 200 }), { legs: 'tapered' });
  const legs = fittingsOf(long).filter((f) => f.kind === 'leg');
  assert.equal(legs.length, 6);
  const xs = [...new Set(legs.map((f) => Math.round(f.position[0])))].sort((a, b) => a - b);
  const g = generateComposition(long);
  const joint = g.parts.find((p) => p.id === 'a2:right')!.position[0];
  assert.equal(xs[1], Math.round(joint));
  // Estrutura de aço e base trenó correm a fileira inteira.
  const stand = fittingsOf(withLook(row(4, { feet: 200 }), { legs: 'frame' })).filter((f) => f.kind === 'stand');
  assert.equal(stand.length, 1);
  assert.equal(stand[0].posts?.length, 1);
  assert.equal(fittingsOf(withLook(row(3, { feet: 200 }), { legs: 'sled' })).filter((f) => f.kind === 'stand').length, 2);
  assert.equal(quoteOf(withLook(row(3, { feet: 200 }), { legs: 'splayed' }), DEFAULT_PRICES).lines.find((l) => l.label === 'Pé inclinado de madeira')?.qty, 4);
});
