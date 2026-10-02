import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assets, buildAsset } from '../lib/assets';
import { preset, PROFILE, SCHEMA_VERSION, type Composition, type Module } from '../lib/composition';
import { drawingParts } from '../lib/fittings';
import { LEG_TYPES, LEGS, STYLE_IDS } from '../lib/look';
import { floatingParts, structureIssues } from '../lib/structure';
import { REFERENCES } from './fixtures/references';

/**
 * Nada flutua: toda peça desenhada (chapa, tampo, pé, estrutura, cavalete,
 * travessão, longarina, puxador, LED) está presa por peças que se tocam ao
 * piso, à parede ou à estrutura. A colisão só confere sobreposição; sem isto,
 * um travessão 30 mm curto passava em todos os testes.
 */
const one = (m: Module): Composition => ({ schemaVersion: SCHEMA_VERSION, profile: PROFILE, modules: [m], connections: [] });
const said = (list: ReturnType<typeof structureIssues>) => list.map((f) => f.message).slice(0, 4).join(' | ');

void test('a conferência acha a peça solta no ar', () => {
  const d = buildAsset(assets.find((a) => a.id === 'mesa-jantar')!, { style: 'rustic' });
  const drawn = drawingParts(d);
  const beam = drawn.find((p) => p.id.endsWith(':beam'))!;
  const lifted = drawn.map((p) => (p === beam ? { ...p, position: [p.position[0], p.position[1] + 200, p.position[2]] as [number, number, number] } : p));
  assert.deepEqual(floatingParts(d, drawn), []);
  assert.deepEqual(floatingParts(d, lifted).map((f) => f.id), [beam.id]);
});

for (const style of [undefined, ...STYLE_IDS])
  void test(`nada flutua, atravessa ou trava: todo móvel da biblioteca ${style ? `no estilo ${style}` : 'sem estilo'}, nas medidas de ponta`, () => {
    for (const a of assets)
      for (const s of [a.size.default, a.size.min, a.size.max]) {
        const d = buildAsset(a, { ...s, ...(style ? { style } : {}) });
        assert.equal(said(structureIssues(d)), '', `${a.id} ${JSON.stringify(s)}`);
      }
  });

void test('nada flutua, atravessa ou trava: toda base de mesa e de caixa, com níveis e gavetas, e as referências', () => {
  for (const legs of LEG_TYPES) {
    if (LEGS[legs].table)
      for (const extra of [{}, { shelves: 2 }, { drawers: 2 }, { shelves: 1, drawers: 1 }]) {
        const m: Module = { ...preset('table', 't'), materialId: 'oak-solid', ...(legs === 'wall' ? { wall: true } : {}), ...(legs === 'wall' ? { drawers: (extra as { drawers?: number }).drawers } : extra), look: { legs } };
        assert.equal(said(structureIssues(one(m))), '', `mesa ${legs} ${JSON.stringify(extra)}`);
      }
    if (LEGS[legs].box) {
      const m: Module = { ...preset('drawers', 'b'), feet: LEGS[legs].box![0] + 20, look: { legs } };
      assert.equal(said(structureIssues(one(m))), '', `caixa ${legs}`);
    }
  }
  for (const [name, build] of Object.entries(REFERENCES)) assert.equal(said(structureIssues(build())), '', name);
});

void test('a conferência acha a porta que bate no vizinho ao abrir', () => {
  // Outro móvel 20 mm na frente da porta: a folha, girando, entra nele.
  const a: Module = { ...preset('niche', 'a'), width: 500, height: 700, depth: 400, root: { id: 'a:root', front: { id: 'fa', type: 'single', hinge: 'right', heights: [1] } } };
  const b: Module = { ...preset('niche', 'b'), width: 500, height: 700, depth: 400, position: [0, 0, 420] };
  const close: Composition = { schemaVersion: SCHEMA_VERSION, profile: PROFILE, modules: [a, b], connections: [] };
  assert.ok(structureIssues(close).some((v) => v.kind === 'nao-abre'), JSON.stringify(structureIssues(close)));
  // A 60 cm, abre inteira.
  const far: Composition = { ...close, modules: [a, { ...b, position: [0, 0, 1000] }] };
  assert.deepEqual(structureIssues(far).filter((v) => v.kind === 'nao-abre'), []);
});
