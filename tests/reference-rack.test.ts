import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyModularOp, generateComposition, openingLimit, preset, PROFILE, SCHEMA_VERSION, type Composition, type ModularOp } from '../lib/composition';
import { fittingsOf } from '../lib/fittings';
import { DEFAULT_PRICES, quoteOf } from '../lib/quote';

/**
 * Referência enviada pelo usuário (foto de um rack industrial): estrutura de
 * aço preto em volta, portas de tela metálica em quadro preto nas pontas,
 * nicho aberto no meio com prateleira, madeira clara, puxador barra preto e
 * pés de tubo que continuam as colunas. Montado só com operações do contrato,
 * as mesmas que a IA usa no design_apply: se isto quebrar, o estúdio deixou
 * de conseguir fazer esse móvel.
 */
function referenceRack(): Composition {
  const H = 550,
    D = 450,
    feet = 100;
  const look = { frame: true, frameMaterialId: 'steel-black', legs: 'tube', legMaterialId: 'steel-black', front: 'mesh', insertMaterialId: 'steel-black', handle: 'bar', handleMaterialId: 'steel-black' } as const;
  let d: Composition = { schemaVersion: SCHEMA_VERSION, profile: PROFILE, modules: [{ ...preset('niche', 'esq'), name: 'Porta esquerda', width: 560, height: H, depth: D, materialId: 'oak', feet, look }], connections: [] };
  const ops: ModularOp[] = [
    { kind: 'module.add', id: 'meio', preset: 'niche', name: 'Nicho' },
    { kind: 'module.edit', id: 'meio', width: 500, height: H, depth: D, materialId: 'oak', feet, look, position: [9000, 0, 0] },
    { kind: 'connect', parent: 'esq', child: 'meio', side: 'right', shared: true, align: 'back', offset: 0 },
    { kind: 'module.add', id: 'dir', preset: 'niche', name: 'Porta direita' },
    { kind: 'module.edit', id: 'dir', width: 560, height: H, depth: D, materialId: 'oak', feet, look, position: [9000, 0, 0] },
    { kind: 'connect', parent: 'meio', child: 'dir', side: 'right', shared: true, align: 'back', offset: 0 },
    { kind: 'front.set', id: 'esq:root', type: 'single', hinge: 'left', materialId: 'black' },
    { kind: 'front.set', id: 'dir:root', type: 'single', hinge: 'right', materialId: 'black' },
    { kind: 'cell.split', id: 'meio:root', axis: 'y', gapMm: 230 },
  ];
  for (const op of ops) d = applyModularOp(d, op);
  return d;
}

void test('rack industrial da foto de referência: o estúdio monta pelo contrato', () => {
  const d = referenceRack();
  const g = generateComposition(d);
  // 1,58 m de largura, 0,65 m de altura com os pés.
  assert.equal(Math.round(g.bounds.max[0] - g.bounds.min[0]), 1584);
  assert.equal(Math.round(g.bounds.max[1] - g.bounds.min[1]), 650);
  // Duas portas de quadro preto com tela de aço preto, que abrem inteiras.
  const doors = g.parts.filter((p) => p.kind === 'door');
  assert.equal(doors.length, 2);
  for (const door of doors) {
    assert.equal(door.materialId, 'black');
    assert.equal(door.face?.kind, 'frame');
    assert.deepEqual(door.handle, { type: 'bar', materialId: 'steel-black' });
    assert.ok(openingLimit(g.parts, door.motion!.id) > 0.98);
  }
  assert.deepEqual(g.parts.filter((p) => p.kind === 'insert').map((p) => p.materialId), ['steel-black', 'steel-black']);
  // Nicho aberto no meio com uma prateleira, em carvalho.
  assert.equal(g.parts.filter((p) => p.kind === 'shelf' && p.owners.includes('meio')).length, 1);
  assert.equal(g.parts.find((p) => p.id === 'meio:top')?.materialId, 'oak');
  // Contorno de aço: perímetro do conjunto e colunas da frente entre os vãos,
  // sem cruzar o tampo; pés de tubo nas quinas, alinhados com o contorno.
  const fit = fittingsOf(d);
  const frame = fit.filter((f) => f.kind === 'frame');
  assert.equal(frame.length, 9 + 5 + 8);
  const legs = fit.filter((f) => f.kind === 'leg');
  assert.equal(legs.length, 4);
  const xs = legs.map((f) => Math.round(f.position[0]));
  assert.equal(Math.min(...xs), Math.round(g.bounds.min[0]));
  assert.equal(Math.max(...xs), Math.round(g.bounds.max[0]));
  // Orçamento com a tela, o tubo do contorno e a serralheria.
  const q = quoteOf(d, DEFAULT_PRICES);
  for (const label of ['Aço preto 2 mm', 'Estrutura em aço preto (tubo 20 × 20)', 'Pé de tubo de aço', 'Serralheria (corte, solda e pintura)'])
    assert.ok(q.lines.some((l) => l.label.startsWith(label)), label);
});
