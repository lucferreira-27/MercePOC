import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assets, buildAsset } from '../lib/assets';
import { preset, PROFILE, SCHEMA_VERSION, type Composition, type Module } from '../lib/composition';
import { drawingParts } from '../lib/fittings';
import { LEG_TYPES, LEGS, STYLE_IDS } from '../lib/look';
import { floatingParts } from '../lib/structure';
import { REFERENCES } from './fixtures/references';

/**
 * Nada flutua: toda peça desenhada (chapa, tampo, pé, estrutura, cavalete,
 * travessão, longarina, puxador, LED) está presa por peças que se tocam ao
 * piso, à parede ou à estrutura. A colisão só confere sobreposição; sem isto,
 * um travessão 30 mm curto passava em todos os testes.
 */
const one = (m: Module): Composition => ({ schemaVersion: SCHEMA_VERSION, profile: PROFILE, modules: [m], connections: [] });
const show = (list: ReturnType<typeof floatingParts>) => list.map((f) => f.id).slice(0, 6).join(', ');

void test('a conferência acha a peça solta no ar', () => {
  const d = buildAsset(assets.find((a) => a.id === 'mesa-jantar')!, { style: 'rustic' });
  const drawn = drawingParts(d);
  const beam = drawn.find((p) => p.id.endsWith(':beam'))!;
  const lifted = drawn.map((p) => (p === beam ? { ...p, position: [p.position[0], p.position[1] + 200, p.position[2]] as [number, number, number] } : p));
  assert.deepEqual(floatingParts(d, drawn), []);
  assert.deepEqual(floatingParts(d, lifted).map((f) => f.id), [beam.id]);
});

for (const style of [undefined, ...STYLE_IDS])
  void test(`nada flutua: todo móvel da biblioteca ${style ? `no estilo ${style}` : 'sem estilo'}, nas medidas de ponta`, () => {
    for (const a of assets)
      for (const s of [a.size.default, a.size.min, a.size.max]) {
        const d = buildAsset(a, { ...s, ...(style ? { style } : {}) });
        assert.deepEqual(show(floatingParts(d)), '', `${a.id} ${JSON.stringify(s)}`);
      }
  });

void test('nada flutua: toda base de mesa e de caixa, com níveis e gavetas, e as referências', () => {
  for (const legs of LEG_TYPES) {
    if (LEGS[legs].table)
      for (const extra of [{}, { shelves: 2 }, { drawers: 2 }, { shelves: 1, drawers: 1 }]) {
        const m: Module = { ...preset('table', 't'), materialId: 'oak-solid', ...(legs === 'wall' ? { wall: true } : {}), ...(legs === 'wall' ? { drawers: (extra as { drawers?: number }).drawers } : extra), look: { legs } };
        assert.deepEqual(show(floatingParts(one(m))), '', `mesa ${legs} ${JSON.stringify(extra)}`);
      }
    if (LEGS[legs].box) {
      const m: Module = { ...preset('drawers', 'b'), feet: LEGS[legs].box![0] + 20, look: { legs } };
      assert.deepEqual(show(floatingParts(one(m))), '', `caixa ${legs}`);
    }
  }
  for (const [name, build] of Object.entries(REFERENCES)) assert.deepEqual(show(floatingParts(build())), '', name);
});
