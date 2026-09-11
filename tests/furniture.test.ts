import { resizeDesign as resizeStudio } from '../lib/studio';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaults,
  generate,
  paramsSchema,
} from '../lib/furniture';
import {
  addShelf,
  cortecloud,
  cutCSV,
  designSchema,
  generateDesign,
  migrateParams,
  resizeDesign,
  setGapBelow,
} from '../lib/design';
import { decisionSchema } from '../lib/gateway';
import { create, fork, get, revise, save, view } from '../lib/store';
void test('reference cabinet and dimensions', () => {
  const g = generate(defaults);
  assert.equal(g.parts.length, 9);
  assert.deepEqual(g.openings, [338.4, 338.4, 338.4, 338.4, 338.4]);
  assert.equal(g.parts.find((p) => p.id === 'base')!.c, 764);
  assert.equal(g.parts.find((p) => p.id === 'shelf-1')!.c, 762);
});
void test('resizing updates horizontal pieces and back but keeps panel thickness', () => {
  const g = generateDesign(resizeDesign(migrateParams(defaults), { width: 1000 }));
  assert.equal(g.parts.find((p) => p.id === 'base')!.c, 964);
  assert.equal(g.parts.find((p) => p.id === 'sh-1')!.c, 962);
});
void test('explicit bottom opening is clear distance', () => {
  const d = setGapBelow(migrateParams(defaults), 'sh-1', 450);
  const g = generateDesign(d);
  assert.equal(g.openings[0], 450);
  assert.equal(
    g.parts.find((p) => p.id === 'sh-1')!.position[1] - 9 - 18,
    450,
  );
  assert.ok(
    Math.abs(g.openings.reduce((a, b) => a + b, 0) + 4 * 18 + 36 - 1800) <
      0.001,
  );
});
void test('invalid geometry is rejected', () => {
  for (const changes of [
    { width: -1 },
    { width: 5000 },
    { depth: NaN },
    { materialId: 'invented' },
  ] as { width?: number; depth?: number; materialId?: 'white' }[])
    assert.throws(() =>
      generateDesign({ ...migrateParams(defaults), ...changes }),
    );
  assert.throws(() => resizeDesign(migrateParams(defaults), { height: 500 }));
  assert.throws(() => addShelf(migrateParams({ ...defaults, height: 600, shelfCount: 2 }), 0));
});
void test('all generated geometry matches piece dimensions and has no unintended solid overlap', () => {
  for (const w of [300, 800, 1200])
    for (const h of [900, 1800, 2400])
      for (const n of [0, 2, 4]) {
        let g;
        try {
          const d = migrateParams({ ...defaults, width: w, height: h, shelfCount: n });
          g = generateDesign(d);
        } catch {
          continue;
        }
        for (const p of g.parts) {
          assert.deepEqual(
            [...p.size].sort((a: number, b: number) => a - b),
            [p.c, p.l, p.thickness].sort((a: number, b: number) => a - b),
          );
          for (const q of g.parts) {
            if (p.id === q.id) continue;
            const overlap = p.size.map(
              (s: number, i: number) =>
                Math.min(p.position[i] + s / 2, q.position[i] + q.size[i] / 2) -
                Math.max(p.position[i] - s / 2, q.position[i] - q.size[i] / 2),
            );
            assert.ok(
              !overlap.every((v: number) => v > 0.001),
              `${p.id} collides with ${q.id}`,
            );
          }
        }
      }
});
void test('CSV and Cortecloud use the canonical piece list', () => {
  const d = migrateParams(defaults),
    g = generateDesign(d),
    cc = cortecloud(d);
  assert.equal(cc.parts.length, g.parts.length);
  cc.parts.forEach((v, i) => {
    assert.equal(v.c, g.parts[i].c);
    assert.equal(v.l, g.parts[i].l);
    assert.equal(v.material, g.parts[i].material);
    assert.equal(v.machining, null);
  });
  assert.equal(cutCSV(d).split('\r\n').length, 10);
  assert.ok(cutCSV(d).startsWith('\uFEFF'));
  assert.ok(cutCSV(migrateParams(defaults)).includes('sh-1'));
});
void test('schema rejects extra model fields and actions', () => {
  assert.throws(() =>
    decisionSchema.parse({ action: 'execute', message: 'x', ops: [] }),
  );
  assert.throws(() =>
    decisionSchema.parse({
      action: 'update',
      message: 'x',
      ops: [{ kind: 'teleport' }],
    }),
  );
  assert.throws(() => paramsSchema.parse({ ...defaults, width: Infinity }));
  assert.throws(() => designSchema.parse({ ...migrateParams(defaults), script: 'bad' }));
});
void test('deterministic repeated generation', () =>
  assert.deepEqual(
    generateDesign(migrateParams(defaults)),
    generateDesign(JSON.parse(JSON.stringify(migrateParams(defaults)))),
  ));
void test('persistence, undo/redo, branching and optimistic locking', () => {
  const p = create();
  let raw = get(p.id);
  const seedWidth = raw.revisions[raw.cursor].params.width;
  const firstWidth = raw.revisions[0].params.width;
  revise(raw, resizeStudio(raw.revisions[raw.cursor].params, { width: 1000 }), 'Resize');
  save(raw, 0);
  assert.equal(get(p.id).version, 1);
  assert.equal(view(get(p.id)).params.width, 1000);
  assert.throws(() => save(raw, 0));
  raw = get(p.id);
  raw.cursor--;
  save(raw, 1);
  assert.equal(view(get(p.id)).params.width, seedWidth);
  raw = get(p.id);
  raw.cursor++;
  save(raw, 2);
  assert.equal(view(get(p.id)).params.width, 1000);
  raw = get(p.id);
  raw.cursor = 0;
  revise(raw, resizeStudio(raw.revisions[raw.cursor].params, { depth: 450 }), 'Branch');
  save(raw, 3);
  assert.equal(get(p.id).revisions.length, 2);
  assert.equal(view(get(p.id)).params.width, firstWidth);
  assert.equal(view(get(p.id)).params.depth, 450);
});
void test('migration preserves legacy geometry and fork keeps history consistent', () => {
  const legacy = { ...defaults, width: 1000, bottomOpening: 450, shelfCount: 5 };
  const fromLegacy = generateDesign(migrateParams(legacy)).parts;
  const expected = generate(legacy).parts.map((v) => ({ ...v, id: v.id.replace(/^shelf-(\d+)$/, 'sh-$1') }));
  assert.equal(fromLegacy.length, expected.length);
  for (const [i, part] of fromLegacy.entries()) {
    assert.deepEqual(part.size, expected[i].size);
    assert.deepEqual(part.position, expected[i].position);
    assert.equal(part.c, expected[i].c);
    assert.equal(part.material, expected[i].material);
  }
  const p = create();
  const alt = fork(p.id, 0, 'Minha estante · alternativa');
  assert.equal(alt.revisions.length, 1);
  assert.equal(alt.messages.at(-1)?.content.includes('versão 1'), true);
  assert.deepEqual(alt.params, view(get(p.id)).params);
});
