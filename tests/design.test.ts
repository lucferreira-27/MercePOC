import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addShelf,
  applyOp,
  describeDesignChanges,
  distributeShelves,
  gapsOf,
  generateDesign,
  migrateParams,
  moveShelves,
  removeShelves,
  resizeDesign,
  resolveShelfId,
  setGapBelow,
  shelfLabel,
  type Design,
} from '../lib/design';
import { defaults, generate, type Params } from '../lib/furniture';

const base = (over: Partial<Params> = {}): Params => ({ ...defaults, ...over });
const designOf = (over: Partial<Params> = {}) => migrateParams(base(over));

/** Geometria legada com ids traduzidos para comparar com o design. */
function legacyParts(p: Params) {
  return generate(p).parts.map((v) => ({
    ...v,
    id: v.id.replace(/^shelf-(\d+)$/, 'sh-$1'),
  }));
}

void test('migrateParams: preserva exatamente a geometria da distribuição igual', () => {
  const d = designOf();
  assert.deepEqual(generateDesign(d).parts, legacyParts(base()));
  assert.equal(d.shelves.length, 4);
  assert.deepEqual(
    d.shelves.map((s) => s.id),
    ['sh-1', 'sh-2', 'sh-3', 'sh-4'],
  );
});
void test('migrateParams: preserva o vão inferior personalizado', () => {
  const d = designOf({ bottomOpening: 450, shelfCount: 5 });
  assert.deepEqual(generateDesign(d).parts, legacyParts(base({ bottomOpening: 450, shelfCount: 5 })));
  assert.equal(Math.round(gapsOf(d)[0]), 450);
});
void test('migrateParams: migra estante sem prateleiras', () => {
  const d = designOf({ shelfCount: 0 });
  assert.deepEqual(d.shelves, []);
  assert.deepEqual(generateDesign(d).parts, legacyParts(base({ shelfCount: 0 })));
});

void test('operações de prateleira: move uma prateleira e recalcula os vãos vizinhos', () => {
  const d = designOf({ width: 1000, height: 2000, shelfCount: 5, materialId: 'graphite' });
  const before = gapsOf(d);
  const after = moveShelves(d, ['sh-2'], 100);
  assert.equal(after.shelves.find((s) => s.id === 'sh-2')!.elevation - d.shelves.find((s) => s.id === 'sh-2')!.elevation, 100);
  assert.equal(Math.round(gapsOf(after)[1]), Math.round(before[1]) + 100);
  assert.equal(Math.round(gapsOf(after)[2]), Math.round(before[2]) - 100);
});
void test('operações de prateleira: move várias prateleiras preservando a distância entre elas', () => {
  const d = designOf();
  const after = moveShelves(d, ['sh-1', 'sh-2'], 50);
  const e = (x: Design, id: string) => x.shelves.find((s) => s.id === id)!.elevation;
  assert.equal(e(after, 'sh-2') - e(after, 'sh-1'), e(d, 'sh-2') - e(d, 'sh-1'));
});
void test('operações de prateleira: rejeita colisão de forma atômica', () => {
  const d = designOf();
  assert.throws(() => moveShelves(d, ['sh-1'], 5000), /mínimo/);
  assert.deepEqual(moveShelves(d, ['sh-1'], 10).shelves.length, d.shelves.length);
  assert.deepEqual(d.shelves.map((s) => s.elevation), migrateParams(base()).shelves.map((s) => s.elevation));
});
void test('operações de prateleira: define o vão abaixo com medida concreta no erro', () => {
  const d = designOf();
  assert.throws(() => setGapBelow(d, 'sh-3', 50), /50 mm.*mínimo de 100 mm/);
  const after = setGapBelow(d, 'sh-1', 400);
  assert.equal(Math.round(gapsOf(after)[0]), 400);
});
void test('operações de prateleira: rejeita peça que não é prateleira editável', () => {
  const d = designOf();
  assert.throws(() => moveShelves(d, ['base'], 100), /não é uma prateleira editável/);
  assert.throws(() => removeShelves(d, ['top']), /não é uma prateleira editável/);
  assert.throws(() => setGapBelow(d, 'shelf-9', 200), /não é uma prateleira editável/);
});
void test('operações de prateleira: distribui igualmente', () => {
  const moved = moveShelves(designOf(), ['sh-1'], 120);
  const after = distributeShelves(moved);
  const gaps = gapsOf(after);
  assert.ok(gaps.every((g) => Math.abs(g - gaps[0]) < 1e-6));
  assert.ok(gaps[0] >= 100);
});
void test('operações de prateleira: adiciona no centro do vão com id novo e estável', () => {
  const d = designOf();
  const after = addShelf(d, 0);
  assert.equal(after.shelves.length, 5);
  const added = after.shelves.find((s) => s.id === 'sh-5')!;
  assert.ok(added);
  const gaps = gapsOf(after);
  assert.equal(Math.round(gaps[0]), Math.round(gaps[1]));
  assert.deepEqual(
    after.shelves.filter((s) => s.id !== 'sh-5').map((s) => s.elevation),
    d.shelves.map((s) => s.elevation),
  );
});
void test('operações de prateleira: rejeita adicionar em vão pequeno com medidas', () => {
  const d = designOf({ height: 600, shelfCount: 2 });
  assert.throws(() => addShelf(d, 0), /Vão de \d+ mm.*abaixo do mínimo/);
});
void test('operações de prateleira: remove e mantém ids estáveis', () => {
  const d = designOf();
  const after = removeShelves(d, ['sh-2']);
  assert.deepEqual(
    after.shelves.map((s) => s.id),
    ['sh-1', 'sh-3', 'sh-4'],
  );
  assert.equal(shelfLabel(after, 'sh-3'), 'Prateleira 2');
});

void test('resizeDesign: preserva a proporção dos vãos ao mudar a altura', () => {
  const d = designOf({ height: 2000, shelfCount: 5, bottomOpening: 450 });
  const before = gapsOf(d);
  const after = resizeDesign(d, { height: 1800 });
  const round = (xs: number[]) => xs.map(Math.round);
  const free = (h: number) => h - 36 - 5 * 18;
  const expected = before.map((g) => (g * free(1800)) / free(2000));
  assert.deepEqual(round(gapsOf(after)), round(expected));
  assert.equal(after.height, 1800);
});
void test('resizeDesign: rejeita altura que espreme os vãos', () => {
  const d = designOf();
  assert.throws(() => resizeDesign(d, { height: 500 }), /mínimo de 100 mm/);
});
void test('resizeDesign: largura não move as elevações', () => {
  const d = designOf();
  const after = resizeDesign(d, { width: 1000 });
  assert.deepEqual(
    after.shelves.map((s) => s.elevation),
    d.shelves.map((s) => s.elevation),
  );
});

void test('contrato e descrições: resolve ids legados shelf-N para sh-N', () => {
  const d = designOf();
  assert.equal(resolveShelfId('shelf-2', d), 'sh-2');
  assert.equal(resolveShelfId('sh-3', d), 'sh-3');
  assert.equal(resolveShelfId('shelf-9', d), null);
  assert.equal(resolveShelfId('base', d), null);
});
void test('contrato e descrições: ida e volta de movimento não cria diferença', () => {
  const d = designOf();
  assert.deepEqual(moveShelves(moveShelves(d, ['sh-2'], 60), ['sh-2'], -60), d);
});
void test('contrato e descrições: descreve mover, remover e redistribuir', () => {
  const d = designOf();
  assert.match(describeDesignChanges(d, moveShelves(d, ['sh-2'], 100)).join('\n'), /Prateleira 2 subiu 100 mm/);
  assert.match(describeDesignChanges(d, removeShelves(d, ['sh-2'])).join('\n'), /removida/);
  const all = moveShelves(setGapBelow(d, 'sh-1', 400), ['sh-1', 'sh-2', 'sh-3', 'sh-4'], 30);
  assert.deepEqual(describeDesignChanges(all, distributeShelves(all)), ['Prateleiras redistribuídas igualmente']);
});
void test('contrato e descrições: aplica operações via applyOp', () => {
  const d = designOf();
  assert.deepEqual(applyOp(d, { kind: 'move', ids: ['sh-1'], deltaMm: 50 }), moveShelves(d, ['sh-1'], 50));
  assert.deepEqual(applyOp(d, { kind: 'distribute' }), distributeShelves(d));
});
