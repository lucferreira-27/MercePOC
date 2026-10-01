import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE,
  applyModularOp,
  generateComposition,
  preset,
  type Composition,
  type ModularOp,
} from '../lib/composition';
import { planView, planSvg } from '../lib/plan-render';

function build(ops: ModularOp[]) {
  let d: Composition = {
    schemaVersion: 4,
    profile: PROFILE,
    modules: [preset('niche', 'a')],
    connections: [],
  };
  for (const op of ops) d = applyModularOp(d, op);
  return generateComposition(d).parts;
}

const comAlturas = build([
  { kind: 'module.edit', id: 'a', width: 800, height: 2400, depth: 400 },
  { kind: 'cell.split', id: 'a:root', axis: 'y', gapMm: 700 },
  { kind: 'front.set', id: 'a:root:low', type: 'drawers', count: 3 },
  { kind: 'cell.split', id: 'a:root:high', axis: 'y', gapMm: 900 },
]);

void test('cada peça desenha as faces visíveis da vista', () => {
  // Uma face só na frontal (a silhueta da frente) e três na isométrica (tampo
  // e as duas faces de frente). Com uma face só na isométrica, as laterais
  // sumiam e o móvel virava um monte de prateleira flutuando.
  const frente = planView(comAlturas, 'front');
  const iso = planView(comAlturas, 'iso');
  assert.equal(frente.panels.length, comAlturas.length);
  assert.equal(iso.panels.length, comAlturas.length * 3);
});

void test('o desenho cabe no painel, sem estourar a moldura', () => {
  for (const vista of ['front', 'iso'] as const) {
    const g = planView(comAlturas, vista);
    for (const panel of g.panels)
      for (const [x, y] of panel.points) {
        assert.ok(x >= 0 && x <= g.width, `${vista}: x ${x} fora de 0..${g.width}`);
        assert.ok(y >= 0 && y <= g.height, `${vista}: y ${y} fora de 0..${g.height}`);
      }
    assert.ok(g.ground.length >= 4, `${vista}: sem silhueta no chão`);
  }
});

void test('a frente é pintada depois do corpo, nunca por baixo dele', () => {
  // A ordem de pintura é a profundidade: se a porta viesse antes do painel de
  // fundo, ela apareceria escondida atrás do módulo.
  const painel = planView(comAlturas, 'front');
  const indices = painel.panels.reduce<Record<string, number>>((acc, p, i) => {
    acc[p.kind] = i;
    return acc;
  }, {});
  assert.ok(indices.drawer !== undefined && indices.back !== undefined);
  assert.ok(indices.drawer > indices.back, 'gaveta pintada antes do fundo');
  assert.equal(painel.panels.at(-1)?.kind, 'drawer');
});

void test('o desenho é em escala: a proporção desenhada é a do móvel', () => {
  // Cada vista se enquadra na moldura, então o tamanho absoluto não diz nada;
  // o que tem de valer é a razão largura/altura, senão o desenho mente sobre
  // a proporção do móvel e a comparação com a foto perde o sentido.
  const razao = (largura: number, altura: number) => {
    const g = planView(
      build([{ kind: 'module.edit', id: 'a', width: largura, height: altura, depth: 400 }]),
      'front',
    );
    const xs = g.panels.flatMap((p) => p.points.map((v) => v[0]));
    const ys = g.panels.flatMap((p) => p.points.map((v) => v[1]));
    return (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
  };
  const alto = razao(400, 2400);
  const baixo = razao(400, 600);
  assert.ok(alto < baixo / 3, `razão do alto ${alto.toFixed(3)} não é bem menor que a do baixo ${baixo.toFixed(3)}`);
  assert.ok(Math.abs(alto - 400 / 2400) < 0.02, `razão do alto ${alto.toFixed(3)} longe de ${(400 / 2400).toFixed(3)}`);
});

void test('o SVG sai como uma imagem de duas vistas', () => {
  const svg = planSvg(comAlturas);
  assert.match(svg, /^<svg [^>]*width="920" height="620"/);
  assert.equal(svg.match(/<rect[^>]*fill="#ffffff"/g)?.length, 2);
});

void test('isométrica pinta pelo plano que separa as peças: tampo comprido por cima, gaveta embaixo do tampo da caixa', async () => {
  const { assetById, buildAsset } = await import('../lib/assets');
  const { drawingParts } = await import('../lib/fittings');
  const { paintOrder } = await import('../lib/plan-render');
  // Tampo de mármore de 2,44 m sobre três balcões: o centro dele cai no do
  // meio, e pelo centro o tampo da última caixa era pintado por cima.
  const kitchen = drawingParts(buildAsset(assetById('cozinha')!, { style: 'midcentury' }));
  const order = paintOrder(kitchen, 'iso').map((p) => p.id);
  const slab = order.indexOf('b1:slab');
  for (const id of ['b1:top', 'b2:top', 'b3:top']) assert.ok(order.indexOf(id) < slab, id);
  // A caixa da gaveta de cima fica embaixo do tampo da caixa: pinta antes.
  const sideboard = drawingParts(buildAsset(assetById('aparador')!, { style: 'scandinavian' }));
  const iso = paintOrder(sideboard, 'iso').map((p) => p.id);
  const top = iso.indexOf('a2:top');
  for (const id of iso.filter((v) => /:drawer-\d+:(left|right|back|inner|bottom)$/.test(v))) assert.ok(iso.indexOf(id) < top, id);
});
