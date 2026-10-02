import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateComposition, type Composition } from '../lib/composition';
import { fittingsOf } from '../lib/fittings';
import { DEFAULT_PRICES, quoteOf } from '../lib/quote';
import { REFERENCES } from './fixtures/references';

/**
 * Fotos de referência do usuário, montadas pelo contrato: cada uma tem de
 * validar e ter as peças que fazem a foto ser reconhecível.
 */
const parts = (d: Composition) => generateComposition(d).parts;

void test('referências montam e passam na validação, com orçamento', () => {
  for (const [name, build] of Object.entries(REFERENCES)) {
    const d = build();
    assert.doesNotThrow(() => generateComposition(d), name);
    assert.ok(quoteOf(d, DEFAULT_PRICES).total > 0, name);
  }
});

void test('aparador industrial: portas de tela em quadro de aço, gavetas de carvalho, tampo de nogueira maciça', () => {
  const p = parts(REFERENCES['aparador-industrial']());
  assert.equal(p.filter((v) => v.kind === 'door' && v.category === 'metal').length, 2);
  assert.equal(p.filter((v) => v.id.endsWith(':front') && v.materialId === 'oak').length, 3);
  assert.equal(p.filter((v) => v.kind === 'slab' && v.materialId === 'walnut-solid').length, 1);
});

void test('bancada de oficina: gaveteiros, nicho, tampo maciço, painel perfurado, aéreo com LED', () => {
  const d = REFERENCES['bancada-oficina']();
  const p = parts(d);
  assert.equal(p.filter((v) => v.id.endsWith(':front')).length, 6 + 5 + 3);
  assert.equal(p.find((v) => v.kind === 'panel')?.face?.kind, 'perforated');
  assert.ok(fittingsOf(d).some((f) => f.kind === 'led'));
});

void test('cozinha de pinus: quadro de aço com almofada de pinus, tampo Nero, base aparente', () => {
  const p = parts(REFERENCES['cozinha-pinus']());
  const steelDoors = p.filter((v) => v.kind === 'door' && v.category === 'metal');
  assert.equal(steelDoors.length, 2 + 2 + 6);
  assert.equal(p.filter((v) => v.kind === 'insert' && v.materialId === 'pine').length, steelDoors.length);
  assert.equal(p.filter((v) => v.kind === 'slab' && v.materialId === 'nero').length, 1);
});

void test('garagem: shaker em carvalho defumado, moldura, LED e painel de ferramentas', () => {
  const p = parts(REFERENCES.garagem());
  assert.ok(p.some((v) => v.kind === 'door' && v.face?.kind === 'shaker'));
  assert.ok(p.some((v) => v.kind === 'cornice'));
  assert.equal(p.find((v) => v.kind === 'panel')?.face?.kind, 'perforated');
});

void test('estante desencontrada: sem fundo, base aparente e prateleiras em alturas diferentes por coluna', () => {
  const p = parts(REFERENCES['estante-desencontrada']());
  assert.ok(!p.some((v) => v.kind === 'back'));
  assert.ok(p.some((v) => v.kind === 'plinth'));
  const heights = (x0: number, x1: number) =>
    p
      .filter((v) => v.kind === 'shelf' && v.position[0] > x0 && v.position[0] < x1)
      .map((v) => Math.round(v.position[1]))
      .sort((a, b) => a - b);
  // A divisória vertical fica em x -43 (330 mm de vão depois da lateral).
  const left = heights(-400, -60),
    right = heights(-30, 400);
  assert.ok(left.length >= 3 && right.length >= 3, `${left.join(",")} | ${right.join(",")}`);
  // Nenhuma prateleira da esquerda alinha com uma da direita: é o desencontro.
  assert.ok(left.every((y) => right.every((z) => Math.abs(y - z) > 40)), `${left.join(",")} | ${right.join(",")}`);
});

void test('torres de aço: duas estruturas abertas de cinco níveis, console entre elas e a ponte em cima', () => {
  const d = REFERENCES['torres-aco']();
  const p = parts(d);
  assert.equal(d.modules.filter((m) => m.kind === 'table' && m.look?.legs === 'frame').length, 2);
  // Cinco níveis por torre: o tampo e quatro prateleiras.
  for (const id of ['t1', 't2']) assert.equal(p.filter((v) => v.owners.includes(id) && (v.kind === 'shelf' || v.kind === 'slab')).length, 5);
  assert.ok(p.some((v) => v.id === 'ponte:ledge'));
  assert.equal(fittingsOf(d).filter((f) => f.kind === 'stand').length, 2);
});

void test('aparador com nível aberto: a estrutura de aço sobe do tampo e segura a prateleira', () => {
  const d = REFERENCES['aparador-nivel-aberto']();
  const level = d.modules.find((m) => m.kind === 'table')!;
  const top = parts(d).find((v) => v.kind === 'slab' && v.owners.includes('a1'))!;
  assert.equal(level.position[1], top.position[1] + top.size[1] / 2);
  // Centrado em cima do aparador, na largura dele.
  assert.ok(Math.abs(level.position[0] - top.position[0]) < 1 && level.width === top.size[0]);
  assert.ok(fittingsOf(d).some((f) => f.kind === 'stand' && f.moduleId === level.id));
});
