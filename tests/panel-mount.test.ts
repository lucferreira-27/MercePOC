import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyModularOp, generateComposition, preset, PROFILE, type Composition, type Module } from '../lib/composition';
import { describeDesignChanges } from '../lib/studio';

/** Parede no z = -250 (rotação 0): o fundo de quem encosta nela fica em -250. */
const WALL = -250;
const box = (id: string, over: Partial<Module>): Module => ({ ...preset('niche', id), ...over });
const flat = (id: string, type: 'panel' | 'ledge', over: Partial<Module>): Module => ({ ...preset(type, id), ...over });
const byId = (d: Composition, id: string) => d.modules.find((m) => m.id === id)!;

/** Parede da TV: fileira de dois racks suspensos, prateleira de parede em cima e o painel acima de tudo. */
function tvWall(): Composition {
  return {
    schemaVersion: 3,
    profile: PROFILE,
    modules: [
      box('r1', { name: 'Rack 1', width: 900, height: 400, depth: 450, wall: true, position: [0, 300, WALL + 225] }),
      box('r2', { name: 'Rack 2', width: 900, height: 400, depth: 450, wall: true, position: [0, 0, 0] }),
      flat('l', 'ledge', { name: 'Prateleira', width: 1782, height: 25, depth: 300, position: [441, 750, WALL + 150] }),
      flat('p', 'panel', { name: 'Painel da TV', width: 1782, height: 1000, depth: 18, position: [441, 1000, WALL + 9] }),
    ],
    connections: [{ id: 'c1', parent: 'r1', child: 'r2', side: 'right', shared: true, align: 'back', offset: 0 }],
  };
}

void test('painel que cresce até atrás da fileira prende racks e prateleira na frente dele', () => {
  const d = tvWall();
  generateComposition(d);
  const out = applyModularOp(d, { kind: 'module.edit', id: 'p', height: 1700, position: [441, 300, WALL + 9] });
  // A fileira anda junto pela raiz, e a prateleira de parede também: 18 mm, a espessura do painel.
  assert.equal(byId(out, 'r1').position[2], WALL + 225 + 18);
  assert.equal(byId(out, 'r2').position[2], WALL + 225 + 18);
  assert.equal(byId(out, 'l').position[2], WALL + 150 + 18);
  // Só a profundidade muda: x e altura ficam.
  assert.equal(byId(out, 'r1').position[0], 0);
  assert.equal(byId(out, 'r1').position[1], 300);
  assert.equal(byId(out, 'l').position[1], 750);
  // O painel fica onde a pessoa pediu, encostado na parede.
  assert.deepEqual(byId(out, 'p').position, [441, 300, WALL + 9]);
  generateComposition(out);
});

void test('painel que não chega ao móvel não mexe em nada', () => {
  const d = tvWall();
  const out = applyModularOp(d, { kind: 'module.edit', id: 'p', width: 1600 });
  assert.equal(byId(out, 'r1').position[2], WALL + 225);
  assert.equal(byId(out, 'l').position[2], WALL + 150);
});

void test('cabeceira na parede lateral (90°) prende o criado na frente dela, na espessura dela', () => {
  // Parede lateral em x = 0: com rotação 90° a frente aponta para +x.
  const d: Composition = {
    schemaVersion: 3,
    profile: PROFILE,
    modules: [
      box('n', { name: 'Criado', width: 500, height: 550, depth: 400, rotation: 90, position: [200, 0, 1200] }),
      flat('h', 'panel', { name: 'Cabeceira', width: 1600, height: 400, depth: 30, rotation: 90, position: [15, 900, 0] }),
    ],
    connections: [],
  };
  generateComposition(d);
  const out = applyModularOp(d, { kind: 'module.edit', id: 'h', width: 2600, height: 1200, position: [15, 0, 500] });
  assert.deepEqual(byId(out, 'n').position, [230, 0, 1200]);
  generateComposition(out);
});

void test('móvel longe da parede não é empurrado pelo painel atrás dele', () => {
  // Balcão solto, 300 mm à frente da parede: o painel atrás dele não o toca.
  const d: Composition = {
    schemaVersion: 3,
    profile: PROFILE,
    modules: [
      box('b', { name: 'Balcão', width: 800, height: 900, depth: 500, position: [0, 0, WALL + 300 + 250] }),
      flat('p', 'panel', { name: 'Painel', width: 1200, height: 800, depth: 25, position: [0, 1000, WALL + 12.5] }),
    ],
    connections: [],
  };
  const out = applyModularOp(d, { kind: 'module.edit', id: 'p', height: 1700, position: [0, 0, WALL + 12.5] });
  assert.equal(byId(out, 'b').position[2], WALL + 300 + 250);
});

/** Armário solto encostado na parede, e um painel que ainda não chega nele. */
function cabinet(): Composition {
  return {
    schemaVersion: 3,
    profile: PROFILE,
    modules: [
      flat('p', 'panel', { name: 'Painel', width: 1000, height: 400, depth: 18, position: [0, 1200, WALL + 9] }),
      box('a', { name: 'Armário', width: 600, height: 700, depth: 400, position: [0, 0, WALL + 200] }),
    ],
    connections: [],
  };
}
const mounted = () => applyModularOp(cabinet(), { kind: 'module.edit', id: 'p', height: 1600, position: [0, 0, WALL + 9] });

void test('painel que pega só a borda do armário continua sendo erro, e o erro diz o que fazer', () => {
  const d: Composition = {
    ...cabinet(),
    modules: [
      flat('p', 'panel', { name: 'Painel', width: 1000, height: 1200, depth: 18, position: [0, 0, WALL + 9] }),
      box('a', { name: 'Armário', width: 600, height: 700, depth: 400, position: [800, 0, WALL + 200] }),
    ],
  };
  assert.throws(() => applyModularOp(d, { kind: 'module.edit', id: 'p', width: 1010 }), /cobre só parte do fundo de Armário/);
});

void test('pilha conectada com o painel só atrás do de cima continua sendo erro: o de baixo sairia da parede', () => {
  const d: Composition = {
    schemaVersion: 3,
    profile: PROFILE,
    modules: [
      box('base', { name: 'Balcão', width: 600, height: 800, depth: 400, position: [0, 0, WALL + 200] }),
      box('top', { name: 'Aéreo', width: 600, height: 700, depth: 400, position: [0, 0, 0] }),
      flat('p', 'panel', { name: 'Painel', width: 600, height: 300, depth: 18, position: [2000, 1000, WALL + 9] }),
    ],
    connections: [{ id: 'c', parent: 'base', child: 'top', side: 'top', shared: false, align: 'back', offset: 0 }],
  };
  assert.throws(() => applyModularOp(d, { kind: 'module.edit', id: 'p', position: [0, 1000, WALL + 9], height: 400 }), /cobre só parte do fundo/);
});

void test('avanço que bate no móvel da frente é recusado, e o erro diz que foi o avanço', () => {
  const d = cabinet();
  d.modules.push(box('f', { name: 'Balcão da frente', width: 600, height: 700, depth: 400, position: [0, 0, WALL + 400 + 200] }));
  assert.throws(() => applyModularOp(d, { kind: 'module.edit', id: 'p', height: 1600, position: [0, 0, WALL + 9] }), /Ao prender Armário na frente de Painel \(avança 18 mm\)/);
});

void test('painel que encolhe, some ou muda de espessura solta ou reajusta o armário', () => {
  const d = mounted();
  assert.deepEqual(byId(d, 'a').mountedOn, { panel: 'p', by: 18 });
  const shrunk = applyModularOp(d, { kind: 'module.edit', id: 'p', height: 400, position: [0, 1200, WALL + 9] });
  assert.equal(byId(shrunk, 'a').position[2], WALL + 200, 'ficou longe da parede depois do painel encolher');
  assert.equal(byId(shrunk, 'a').mountedOn, undefined);
  const gone = applyModularOp(d, { kind: 'module.remove', id: 'p' });
  assert.equal(byId(gone, 'a').position[2], WALL + 200);
  const thicker = applyModularOp(d, { kind: 'module.edit', id: 'p', depth: 30, position: [0, 0, WALL + 15] });
  assert.equal(byId(thicker, 'a').position[2], WALL + 200 + 30);
  assert.deepEqual(byId(thicker, 'a').mountedOn, { panel: 'p', by: 30 });
});

void test('arrastar o armário preso de lado mantém preso; arrastar para fora do painel volta à parede', () => {
  const d = mounted();
  const side = applyModularOp(d, { kind: 'module.edit', id: 'a', position: [150, 0, WALL + 200 + 18] });
  assert.deepEqual(byId(side, 'a').position, [150, 0, WALL + 200 + 18]);
  const away = applyModularOp(d, { kind: 'module.edit', id: 'a', position: [1500, 0, WALL + 200 + 18] });
  assert.deepEqual(byId(away, 'a').position, [1500, 0, WALL + 200]);
  assert.equal(byId(away, 'a').mountedOn, undefined);
});

void test('o resumo das mudanças diz que o armário passou para a frente do painel, não "posição ajustada"', () => {
  const before = cabinet();
  const after = mounted();
  const lines = describeDesignChanges(before as never, after as never);
  assert.ok(lines.some((l) => /Armário: passa para a frente de Painel, avança 18 mm/.test(l)), lines.join(' | '));
  assert.ok(!lines.some((l) => /"Armário": posição ajustada/.test(l)), lines.join(' | '));
  const back = describeDesignChanges(after as never, applyModularOp(after, { kind: 'module.remove', id: 'p' }) as never);
  assert.ok(back.some((l) => /Armário: sai da frente de Painel e volta para a parede/.test(l)), back.join(' | '));
});
