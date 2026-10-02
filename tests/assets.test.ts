import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assets, applyAssetOp, buildAsset, assetCatalogForPrompt } from '../lib/assets';
import { generateComposition, feetOf, preset, PROFILE, type Composition } from '../lib/composition';
import { fitReport } from '../lib/room';
import { executeRequest, normalize } from '../lib/studio';

const sizes = (a: (typeof assets)[number]) => {
  const { min, max, default: d } = a.size;
  const mid = (k: 'width' | 'height' | 'depth') => Math.round((min[k] + max[k]) / 2);
  return [d, min, max, { width: mid('width'), height: mid('height'), depth: mid('depth') }, { ...d, width: min.width + 137 }];
};

for (const a of assets)
  void test(`ativo ${a.id} monta em todas as medidas do intervalo`, () => {
    for (const s of sizes(a)) {
      const d = buildAsset(a, s);
      const g = generateComposition(d);
      const width = g.bounds.max[0] - g.bounds.min[0];
      // A receita respeita o envelope pedido.
      assert.ok(Math.abs(width - s.width) <= 1, `${a.id} ${JSON.stringify(s)}: largura ${width}`);
      // Nenhuma caixa passa da altura pedida (pés incluídos).
      const tallest = Math.max(...d.modules.map((m) => m.height + (m.feet ?? 0)));
      assert.ok(tallest <= s.height + 1, `${a.id}: módulo de ${tallest} mm`);
      assert.ok(d.modules.length <= 12);
      if (a.feet) assert.ok(feetOf(d).length > 0, `${a.id}: pés`);
      // O ambiente de exemplo aceita o móvel.
      if (a.room) {
        const report = fitReport(d, a.room(buildInput(a, s), width));
        assert.deepEqual(report.issues.map((i) => i.message), [], `${a.id}: ${JSON.stringify(s)}`);
      }
    }
  });

function buildInput(a: (typeof assets)[number], s: { width: number; height: number; depth: number }) {
  return { ...s, body: a.body, front: a.front, feet: a.feet ?? 0 };
}

void test('medida fora do intervalo do ativo é recusada com o limite', () => {
  const rack = assets.find((a) => a.id === 'rack-tv')!;
  assert.throws(() => buildAsset(rack, { width: 5000 }), /largura de 1000 a 3000 mm/);
  assert.throws(() => buildAsset(assets.find((a) => a.id === 'estante')!, { feet: 100 }), /não leva pés/);
});

const base = (): Composition => ({
  schemaVersion: 4,
  profile: PROFILE,
  modules: [{ ...preset('niche', 'a'), width: 800, height: 1800, depth: 350 }],
  connections: [],
});

void test('asset.add substitui o projeto ou encosta ao lado, alinhado pela parede', () => {
  const replaced = applyAssetOp(base(), { kind: 'asset.add', asset: 'rack-tv', placement: 'replace' });
  assert.equal(replaced.modules.some((m) => m.id === 'a'), false);
  assert.ok(replaced.modules.every((m) => m.id.startsWith('rt-')));

  const beside = applyAssetOp(base(), { kind: 'asset.add', asset: 'comoda', placement: 'right', width: 1000 });
  const g = generateComposition(beside);
  assert.equal(beside.modules[0].id, 'a');
  assert.ok(Math.abs(g.bounds.max[0] - g.bounds.min[0] - 1800) < 1);
  // Fundo alinhado: a cômoda (45) e a estante (35) encostam na mesma parede.
  const back = (id: string) =>
    Math.min(...g.parts.filter((p) => p.owners.includes(id)).map((p) => p.position[2] - p.size[2] / 2));
  assert.ok(Math.abs(back('a') - back('c-c1')) < 1e-6);

  const twice = applyAssetOp(beside, { kind: 'asset.add', asset: 'comoda', placement: 'left', width: 800 });
  assert.ok(twice.modules.some((m) => m.id.startsWith('c2-')));
  assert.throws(() => applyAssetOp(beside, { kind: 'asset.add', asset: 'comoda', id: 'c', placement: 'left' }), /Prefixo c já usado/);
});

void test('asset.add entra no lote do chat junto com edições nos módulos novos', () => {
  const r = executeRequest(normalize(base()), [
    { kind: 'asset.add', asset: 'rack-tv', id: 'tv', width: 2400, placement: 'replace' },
    { kind: 'module.edit', id: 'tv-r1', name: 'Porta da esquerda' },
    { kind: 'front.set', id: 'tv-r2:root:high', type: 'single' },
  ]);
  assert.ok(r.ok, r.ok ? '' : r.error);
});

void test('catálogo cabe no prompt e cita todos os ativos', () => {
  const text = assetCatalogForPrompt();
  for (const a of assets) assert.match(text, new RegExp(`- ${a.id}:`));
  assert.ok(text.length < 6000, `catálogo com ${text.length} caracteres`);
});
