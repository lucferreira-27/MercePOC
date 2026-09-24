import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplate, templates } from '../lib/templates';
import { generateComposition, type ModularPart } from '../lib/composition';
import { cutPlan, DEFAULT_SHEET } from '../lib/cutplan';
import { DEFAULT_PRICES, hingesFor, mergePrices, quote } from '../lib/quote';
import { materials } from '../lib/furniture';
import { fitReport } from '../lib/room';
import { modularOpSchema } from '../lib/composition';

const part = (id: string, c: number, l: number, material = 'Branco fosco 18'): ModularPart => ({
  id,
  name: id,
  kind: 'shelf',
  size: [c, 18, l],
  position: [0, 0, 0],
  c,
  l,
  thickness: 18,
  material,
  color: '#fff',
  owners: ['m'],
  rotation: 0,
  edges: { c1: 'x', c2: null, l1: null, l2: null },
});

for (const t of templates)
  void test(`modelo "${t.name}" monta pelo motor e gera peças válidas`, () => {
    const d = buildTemplate(t);
    const g = generateComposition(d);
    assert.ok(d.modules.length >= 1);
    assert.ok(g.parts.length >= 6);
    for (const p of g.parts) {
      assert.ok(Number.isInteger(p.c * 10), `${p.name}: C em décimo de mm`);
      assert.ok(p.c > 0 && p.l > 0);
    }
  });

void test('guarda-roupa cabe no quarto de exemplo que ele traz', () => {
  const t = templates.find((v) => v.id === 'guarda-roupa')!;
  const report = fitReport(buildTemplate(t), t.room!);
  assert.equal(report.fits, true, JSON.stringify(report.issues));
});

void test('acabamentos novos entram no contrato de operações', () => {
  for (const m of materials)
    assert.ok(
      modularOpSchema.safeParse({ kind: 'module.edit', id: 'x', materialId: m.id }).success,
      m.id,
    );
  assert.equal(new Set(materials.map((m) => m.id)).size, materials.length);
});

void test('plano de corte: peças não se sobrepõem e ficam dentro da chapa útil', () => {
  const d = buildTemplate(templates.find((v) => v.id === 'guarda-roupa')!);
  const plan = cutPlan(generateComposition(d).parts);
  assert.equal(plan.oversize.length, 0);
  const s = DEFAULT_SHEET;
  for (const sheet of plan.sheets) {
    for (const p of sheet.placements) {
      assert.ok(p.x >= s.trim && p.y >= s.trim, `${p.name} dentro do refilo`);
      assert.ok(p.x + p.w <= s.length - s.trim + 1e-6, `${p.name} no comprimento`);
      assert.ok(p.y + p.h <= s.width - s.trim + 1e-6, `${p.name} na largura`);
    }
    for (let i = 0; i < sheet.placements.length; i++)
      for (let j = i + 1; j < sheet.placements.length; j++) {
        const a = sheet.placements[i],
          b = sheet.placements[j];
        const apart =
          a.x + a.w + s.kerf <= b.x + 1e-6 ||
          b.x + b.w + s.kerf <= a.x + 1e-6 ||
          a.y + a.h + s.kerf <= b.y + 1e-6 ||
          b.y + b.h + s.kerf <= a.y + 1e-6;
        assert.ok(apart, `${a.name} e ${b.name} separadas pelo disco`);
      }
    assert.ok(sheet.efficiency > 0 && sheet.efficiency <= 1);
  }
  const placed = plan.sheets.reduce((a, v) => a + v.placements.length, 0);
  assert.equal(placed, generateComposition(d).parts.length);
});

void test('plano de corte: chapa com veio não gira a peça, chapa lisa gira', () => {
  // 1800 × 2000 só cabe girada (a chapa útil tem 1820 de largura).
  const wood = cutPlan([part('a', 1800, 1000, 'Carvalho natural 18')]);
  assert.equal(wood.sheets[0].placements[0].rotated, false);
  const tall = cutPlan([part('b', 1000, 2000, 'Branco fosco 18')]);
  assert.equal(tall.sheets[0].placements[0].rotated, true);
  const grainTall = cutPlan([part('c', 1000, 2000, 'Nogueira 18')]);
  assert.equal(grainTall.oversize.length, 1, 'com veio não gira: vira peça fora da chapa');
});

void test('plano de corte: peças pequenas dividem a mesma chapa', () => {
  const plan = cutPlan(Array.from({ length: 12 }, (_, i) => part(`p${i}`, 500, 300)));
  assert.equal(plan.sheets.length, 1);
  assert.equal(plan.groups[0].parts, 12);
});

void test('orçamento: dobradiças pela altura, corrediças por gaveta, total com margem', () => {
  assert.deepEqual([600, 900, 901, 1500, 2000, 2300].map(hingesFor), [2, 2, 3, 3, 4, 5]);
  const d = buildTemplate(templates.find((v) => v.id === 'guarda-roupa')!);
  const g = generateComposition(d);
  const q = quote(g.parts, d.modules.length, DEFAULT_PRICES);
  assert.equal(q.counts.drawers, 3);
  assert.equal(q.counts.doors, 10);
  assert.ok(q.counts.hinges >= 20);
  assert.equal(q.lines.find((l) => l.label.startsWith('Corrediça'))?.qty, 3);
  const sum = q.lines.reduce((a, l) => a + l.total, 0);
  assert.ok(Math.abs(sum - q.cost) < 0.01);
  assert.ok(Math.abs(q.total - q.cost * (1 + DEFAULT_PRICES.margin / 100)) < 0.02);
  const sheets = q.lines.filter((l) => l.section === 'Chapas').reduce((a, l) => a + l.qty, 0);
  assert.equal(sheets, q.plan.sheets.length);
});

void test('orçamento: sem puxador não cobra puxador', () => {
  const d = buildTemplate(templates.find((v) => v.id === 'aparador')!);
  const g = generateComposition(d);
  const q = quote(g.parts, d.modules.length, { ...DEFAULT_PRICES, handles: false });
  assert.equal(q.lines.some((l) => l.label === 'Puxador'), false);
});

void test('preços salvos antigos ganham os acabamentos novos e ignoram lixo', () => {
  const merged = mergePrices({ hinge: 20, margin: 'x', sheets: { oak: 500, bogus: 1 } });
  assert.equal(merged.hinge, 20);
  assert.equal(merged.margin, DEFAULT_PRICES.margin);
  assert.equal(merged.sheets.oak, 500);
  assert.equal(merged.sheets.walnut, DEFAULT_PRICES.sheets.walnut);
  assert.equal('bogus' in merged.sheets, false);
});
