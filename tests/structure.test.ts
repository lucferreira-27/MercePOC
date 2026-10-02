import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assets, buildAsset } from '../lib/assets';
import { preset, PROFILE, SCHEMA_VERSION, type Composition, type ModularPart, type Module } from '../lib/composition';
import { drawingFaults, paintConflicts } from '../lib/plan-geometry';
import { drawingParts } from '../lib/fittings';
import { materialOf } from '../lib/furniture';
import { LEG_TYPES, LEGS, STYLE_IDS } from '../lib/look';
import { deltaE, MIN_DELTA_E, standOut } from '../lib/color';
import { floatingParts, structureIssues } from '../lib/structure';
import { REFERENCES } from './fixtures/references';

/**
 * Nada flutua: toda peça desenhada (chapa, tampo, pé, estrutura, cavalete,
 * travessão, longarina, puxador, LED) está presa por peças que se tocam ao
 * piso, à parede ou à estrutura. A colisão só confere sobreposição; sem isto,
 * um travessão 30 mm curto passava em todos os testes.
 */
const one = (m: Module): Composition => ({ schemaVersion: SCHEMA_VERSION, profile: PROFILE, modules: [m], connections: [] });
const materialOfColor = (id: string) => materialOf(id).color;
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

void test('a conferência acha ferragem cruzando ferragem, mas aceita a junta', () => {
  // Um pé desenhado em cima do outro: cada um dentro do outro, não é junta.
  const t: Module = { ...preset('table', 't'), materialId: 'oak-solid', look: { legs: 'tapered' } };
  const drawn = drawingParts(one(t));
  const [a, b] = drawn.filter((p) => p.id.includes(':foot-'));
  const stacked = drawn.map((p) => (p === b ? { ...p, position: a.position } : p));
  assert.deepEqual(structureIssues(one(t), drawn), []);
  assert.ok(structureIssues(one(t), stacked).some((v) => v.kind === 'cruza'), said(structureIssues(one(t), stacked)));
  // Cavalete com longarina e estrutura de tubo soldada: a parte comum fica na ponta, é junta.
  for (const legs of ['trestle', 'frame'] as const) assert.deepEqual(structureIssues(one({ ...t, look: { legs } })).filter((v) => v.kind === 'cruza'), []);
});

void test('gancho e puxador nunca somem na cor da peça: o metal troca pelo que aparece', () => {
  // Gancho preto em painel preto, barra preta em frente de aço preto: os dois sumiam no desenho.
  for (const on of ['#27292b', '#2a2b2d', '#ecece6', '#c7a14b', '#b9bfc5'])
    for (const id of ['steel-black', 'steel-brushed', 'brass'] as const) assert.ok(deltaE(materialOfColor(standOut(id, on)), on) >= MIN_DELTA_E, `${id} em ${on}`);
  assert.equal(standOut('brass', '#27292b'), 'brass');
  assert.notEqual(standOut('steel-black', '#27292b'), 'steel-black');
  const entry = buildAsset(assets.find((a) => a.id === 'entrada')!, { style: 'minimalist' });
  assert.deepEqual(structureIssues(entry).filter((v) => v.kind === 'contraste'), []);
});

void test('a conferência acha o puxador afundado na frente (some do desenho)', () => {
  // O puxador usinado ficava 1,5 mm dentro da frente e não aparecia na vista.
  const d = buildAsset(assets.find((a) => a.id === 'escrivaninha')!, { style: 'minimalist' });
  const drawn = drawingParts(d);
  const h = drawn.find((p) => p.id.endsWith(':handle'))!;
  const front = drawn.find((p) => h.id.startsWith(p.id))!;
  const sunk = drawn.map((p) => (p === h ? { ...p, position: front.position } : p));
  assert.deepEqual(structureIssues(d, drawn), []);
  assert.ok(structureIssues(d, sunk).some((v) => v.kind === 'escondida'), said(structureIssues(d, sunk)));
});

void test('a conferência do desenho acha peça de trás pintada por cima, contra o raio do olho', () => {
  const d = buildAsset(assets.find((a) => a.id === 'rack')!, { style: 'industrial' });
  const parts = drawingParts(d).filter((p) => !p.decal);
  assert.deepEqual(drawingFaults(parts, 'iso'), []);
  // Pintando o tampo primeiro, as peças de baixo saem por cima dele.
  const topFirst = (v: ModularPart[]) => [...v].sort((a, b) => Number(b.id.endsWith(':top')) - Number(a.id.endsWith(':top')));
  assert.ok(drawingFaults(parts, 'iso', 12, topFirst).some((f) => f.hidden.id.endsWith(':top')));
});

void test('o tampo do rack industrial sai pintado depois de tudo o que está embaixo dele', () => {
  // A saída do ciclo pegava o tampo, fora do ciclo, antes das laterais e da divisória da gaveta.
  const d = buildAsset(assets.find((a) => a.id === 'rack')!, { style: 'industrial' });
  const parts = drawingParts(d).filter((p) => !p.decal);
  assert.deepEqual(paintConflicts(parts, 'iso').filter(([back]) => back.id.endsWith(':top')).map(([b, f]) => `${b.id} > ${f.id}`), []);
  assert.deepEqual(paintConflicts(parts, 'iso').filter(([, fore]) => fore.id.endsWith(':top')).map(([b, f]) => `${b.id} > ${f.id}`), []);
});

void test('toda faixa de pé anunciada monta nas duas pontas (o pé quadrado dizia 40 mm, o motor só aceitava 50)', () => {
  for (const legs of LEG_TYPES) {
    const range = LEGS[legs].box;
    if (!range) continue;
    for (const feet of range) {
      const m: Module = { ...preset('drawers', 'b'), feet, look: { legs } };
      assert.doesNotThrow(() => structureIssues(one(m)), `${legs} ${feet} mm`);
    }
  }
});

void test('a conferência do desenho acha a coluna do cavalete atravessando a sapata (aparecia na frente dela)', () => {
  const d = buildAsset(assets.find((a) => a.id === 'mesa-centro')!, { style: 'rustic' });
  const drawn = drawingParts(d);
  assert.deepEqual(structureIssues(d, drawn).filter((v) => v.kind === 'desenho'), []);
  // Como era: a coluna do piso ao tampo, por dentro da sapata e do chapéu.
  const through = drawn.map((p) => (/:trestle-1:seg-[01]$/.test(p.id) ? { ...p, size: [p.size[0], p.size[1] + 120, p.size[2]] as [number, number, number] } : p));
  assert.ok(structureIssues(d, through).some((v) => v.kind === 'desenho'), said(structureIssues(d, through)));
});
