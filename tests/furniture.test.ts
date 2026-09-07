import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaults,
  generate,
  cutCSV,
  cortecloud,
  paramsSchema,
} from '../lib/furniture';
import { decisionSchema } from '../lib/gateway';
import { create, get, revise, save, view } from '../lib/store';
process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-test-'));
void test('reference cabinet and dimensions', () => {
  const g = generate(defaults);
  assert.equal(g.parts.length, 9);
  assert.deepEqual(g.openings, [338.4, 338.4, 338.4, 338.4, 338.4]);
  assert.equal(g.parts.find((p) => p.id === 'base')!.c, 764);
  assert.equal(g.parts.find((p) => p.id === 'shelf-1')!.c, 762);
  assert.equal(g.parts.find((p) => p.id === 'back')!.thickness, 6);
});
void test('resizing updates horizontal pieces and back but keeps panel thickness', () => {
  const g = generate({ ...defaults, width: 1000 });
  assert.equal(g.parts.find((p) => p.id === 'base')!.c, 964);
  assert.equal(g.parts.find((p) => p.id === 'shelf-1')!.c, 962);
  assert.equal(g.parts.find((p) => p.id === 'back')!.l, 1000);
  assert.equal(g.parts.find((p) => p.id === 'left')!.thickness, 18);
});
void test('explicit bottom opening is clear distance', () => {
  const g = generate({ ...defaults, bottomOpening: 450 });
  assert.equal(g.openings[0], 450);
  assert.equal(
    g.parts.find((p) => p.id === 'shelf-1')!.position[1] - 9 - 18,
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
    { shelfCount: 2.5 },
    { materialId: 'invented' },
  ])
    assert.throws(() =>
      generate({ ...defaults, ...changes } as typeof defaults),
    );
  assert.throws(() => generate({ ...defaults, height: 400, shelfCount: 8 }));
  assert.throws(() =>
    generate({ ...defaults, shelfCount: 0, bottomOpening: 450 }),
  );
});
void test('all generated geometry matches piece dimensions and has no unintended solid overlap', () => {
  for (const w of [300, 800, 1200])
    for (const h of [900, 1800, 2400])
      for (const n of [0, 2, 4]) {
        let g;
        try {
          g = generate({ ...defaults, width: w, height: h, shelfCount: n });
        } catch {
          continue;
        }
        for (const p of g.parts) {
          assert.deepEqual(
            [...p.size].sort((a, b) => a - b),
            [p.c, p.l, p.thickness].sort((a, b) => a - b),
          );
          for (const q of g.parts) {
            if (p.id === q.id) continue;
            const overlap = p.size.map(
              (s, i) =>
                Math.min(p.position[i] + s / 2, q.position[i] + q.size[i] / 2) -
                Math.max(p.position[i] - s / 2, q.position[i] - q.size[i] / 2),
            );
            assert.ok(
              !overlap.every((v) => v > 0.001),
              `${p.id} collides with ${q.id}`,
            );
          }
        }
      }
});
void test('CSV and Cortecloud use the canonical piece list', () => {
  const g = generate(defaults),
    cc = cortecloud(defaults);
  assert.equal(cc.parts.length, g.parts.length);
  cc.parts.forEach((v, i) => {
    assert.equal(v.c, g.parts[i].c);
    assert.equal(v.l, g.parts[i].l);
    assert.equal(v.material, g.parts[i].material);
    assert.equal(v.machining, null);
  });
  assert.equal(cutCSV(defaults).split('\r\n').length, 10);
  assert.ok(cutCSV(defaults).startsWith('\uFEFF'));
});
void test('schema rejects extra model fields and actions', () => {
  assert.throws(() =>
    decisionSchema.parse({ action: 'execute', message: 'x', changes: {} }),
  );
  assert.throws(() =>
    decisionSchema.parse({
      action: 'update',
      message: 'x',
      changes: { script: 'bad' },
    }),
  );
  assert.throws(() => paramsSchema.parse({ ...defaults, width: Infinity }));
});
void test('deterministic repeated generation', () =>
  assert.deepEqual(
    generate(defaults),
    generate(JSON.parse(JSON.stringify(defaults))),
  ));
void test('persistence, undo/redo, branching and optimistic locking', () => {
  const p = create();
  let raw = get(p.id);
  revise(raw, { ...defaults, width: 1000 }, 'Resize');
  save(raw, 0);
  assert.equal(get(p.id).version, 1);
  assert.equal(view(get(p.id)).params.width, 1000);
  assert.throws(() => save(raw, 0));
  raw = get(p.id);
  raw.cursor--;
  save(raw, 1);
  assert.equal(view(get(p.id)).params.width, 800);
  raw = get(p.id);
  raw.cursor++;
  save(raw, 2);
  assert.equal(view(get(p.id)).params.width, 1000);
  raw = get(p.id);
  raw.cursor = 0;
  revise(raw, { ...defaults, depth: 450 }, 'Branch');
  save(raw, 3);
  assert.equal(get(p.id).revisions.length, 2);
  assert.equal(view(get(p.id)).params.width, 800);
  assert.equal(view(get(p.id)).params.depth, 450);
});
