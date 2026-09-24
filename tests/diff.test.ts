import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designDiff, diffStat, playbackFrames, signOf } from '../lib/diff';
import { describeHighlights, executeRequest, migrateParams, type ShelfOp } from '../lib/studio';
import { defaults } from '../lib/furniture';

const base = () => migrateParams(defaults);
const run = (ops: ShelfOp[]) => {
  const before = base();
  const r = executeRequest(before, ops);
  assert.ok(r.ok, r.ok ? '' : r.error);
  return { before, after: r.design };
};

void test('diff de peças: nova entra em added, a que saiu vira fantasma, a que mexeu em changed', () => {
  const { before, after } = run([
    { kind: 'module.add', id: 'n', preset: 'niche' },
    { kind: 'module.edit', id: before0(), width: 900 },
  ]);
  const d = designDiff(before, after);
  assert.ok(d.added.some((id) => id.startsWith('n:')));
  assert.ok(d.changed.length > 0);
  assert.equal(d.removed.length, 0);
  const back = designDiff(after, before);
  assert.ok(back.removed.some((p) => p.id.startsWith('n:')));
});
function before0() {
  return base().modules[0].id;
}

void test('quadros: um por operação que fecha, o último é o resultado salvo', () => {
  const ops: ShelfOp[] = [
    { kind: 'module.add', id: 'n', preset: 'niche' },
    { kind: 'module.edit', id: 'n', width: 600, height: 600, depth: 350, position: [15000, 0, 0] },
    { kind: 'connect', parent: before0(), child: 'n', side: 'right', shared: false, align: 'back', offset: 0 },
  ];
  const { before, after } = run(ops);
  const frames = playbackFrames(before, ops, after);
  assert.equal(frames.length, 3);
  assert.deepEqual(frames.map((f) => f.op), [0, 1, 2]);
  assert.deepEqual(frames.at(-1)!.design.modules.map((m) => m.position), after.modules.map((m) => m.position));
});

void test('linhas do turno trazem sinal, operações e alvos; asset.add ganha linha própria', () => {
  const ops: ShelfOp[] = [
    { kind: 'asset.add', asset: 'rack-tv', placement: 'right' },
    { kind: 'module.edit', id: before0(), name: 'Estante da sala' },
  ];
  const { before, after } = run(ops);
  const lines = describeHighlights(before, after, ops);
  const asset = lines.find((l) => l.tool === 'asset.add')!;
  assert.equal(asset.sign, '+');
  assert.deepEqual(asset.ops, [0]);
  assert.ok(asset.targets!.length >= 2);
  assert.match(asset.title, /Rack de TV adicionado à direita/);
  const edit = lines.find((l) => l.tool === 'module.edit')!;
  assert.equal(edit.sign, '~');
  assert.deepEqual(edit.targets, [before0()]);
  assert.deepEqual(diffStat(lines), { '+': 1, '-': 0, '~': 1 });
});

void test('mensagem antiga sem sinal: o sinal vem da ferramenta', () => {
  assert.equal(signOf({ tool: 'module.remove', title: 'Estante removida' }), '-');
  assert.equal(signOf({ tool: 'front.set', title: 'Frente removida' }), '-');
  assert.equal(signOf({ tool: 'front.set', title: 'Porta colocada' }), '+');
  assert.equal(signOf({ tool: 'cell.move', title: 'Divisória movida' }), '~');
});

void test('só tirar os pés já conta como mudança no resumo do turno', async () => {
  const { describeDesignChanges } = await import('../lib/studio');
  const { buildAsset, assetById } = await import('../lib/assets');
  const { normalize } = await import('../lib/studio');
  const before = normalize(buildAsset(assetById('comoda')!));
  const r = executeRequest(before, [{ kind: 'module.edit', id: before.modules[0].id, feet: 0 }]);
  assert.ok(r.ok);
  assert.ok(describeDesignChanges(before, r.design).some((c) => /sem pés/.test(c)));
});
