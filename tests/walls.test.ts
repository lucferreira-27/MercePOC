import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  editedWall,
  emptyRoom,
  fitReport,
  fitWallsToCeiling,
  moveWallTo,
  nextWallId,
  presetWall,
  resizeMainWall,
  resizeWallEnd,
  resizeWallHeight,
  roomChangeLabel,
  roomSchema,
  rotateWall,
  wallAt,
  wallFootprint,
  wallName,
  type Obstacle,
  type Room,
  type Wall,
} from '../lib/room';
import { PROFILE, preset, type Composition } from '../lib/composition';
import { create, get, redo, reviseRoom, undo } from '../lib/store';
import { undoIsStep } from '../lib/placement';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-walls-'));

const side: Wall = { id: 'wall-1', xMm: 2850, zMm: 0, widthMm: 1200, heightMm: 2700, thicknessMm: 150, rotation: 90 };
const withWalls = (walls: Wall[], extra: Partial<Room> = {}): Room => ({ ...emptyRoom(), ...extra, walls });

/** Um módulo de 1000 × 2000 × 400 mm centrado em x = 0: ocupa x de -500 a 500. */
function design(): Composition {
  return { schemaVersion: 3, profile: PROFILE, modules: [{ ...preset('niche', 'a'), width: 1000, height: 2000, depth: 400, position: [0, 0, 0] }], connections: [] };
}
const bounds = { min: [-500, 0, -200], max: [500, 2000, 200] };

void test('parede é um elemento próprio do ambiente, validado pelo schema', () => {
  assert.equal(roomSchema.safeParse(withWalls([side])).success, true);
  assert.equal(roomSchema.safeParse(withWalls([{ ...side, rotation: 45 as 90 }])).success, false, 'só ao longo do fundo ou saindo dele');
  assert.equal(roomSchema.safeParse(withWalls([{ ...side, thicknessMm: 10 }])).success, false, 'espessura mínima');
  assert.equal(roomSchema.safeParse(withWalls([{ ...side, zMm: -10 }])).success, false, 'não passa para trás da parede do fundo');
  assert.equal(roomSchema.safeParse({ ...withWalls([]), obstacles: [{ ...side, kind: 'wall' }] }).success, false, 'parede não é tipo de obstáculo');
});

void test('parede nova fecha o canto direito, com o pé-direito e id livre', () => {
  const wall = presetWall(withWalls([side]));
  assert.equal(wall.id, 'wall-2');
  assert.deepEqual(wallFootprint(wall), { x0: 2850, x1: 3000, z0: 0, z1: 1200 });
  assert.equal(wall.heightMm, 2700);
  assert.equal(nextWallId([]), 'wall-1');
  assert.equal(wallName(wall), 'Parede 2');
  assert.equal(wallName({ ...wall, label: 'Lavanderia' }), 'Lavanderia');
  assert.equal(presetWall({ ...emptyRoom(), depthMm: 600 }).widthMm, 600, 'não passa da profundidade do ambiente');
});

void test('mover: passo de 1 cm, gruda no canto e na face do fundo, não sai do ambiente', () => {
  const room = withWalls([side], { depthMm: 3000 });
  assert.deepEqual(pick(moveWallTo(side, 1234, 503, room)), [1230, 500], 'passo de 1 cm');
  assert.deepEqual(pick(moveWallTo(side, 2890, 40, room)), [2850, 0], 'borda direita e face do fundo grudam');
  assert.deepEqual(pick(moveWallTo(side, 5000, 9000, room)), [3000, 1800], 'só até uma espessura fora do canto e até a profundidade');
  assert.deepEqual(pick(moveWallTo(side, -900, -50, room)), [-150, 0]);
  const other: Wall = { ...side, id: 'wall-2', xMm: 1000, zMm: 1500, rotation: 0, widthMm: 900 };
  const two = withWalls([side, other], { depthMm: 3000 });
  assert.equal(moveWallTo(side, 1920, 800, two).xMm, 1900, 'gruda na ponta da outra parede');
});

const pick = (w: Wall) => [w.xMm, w.zMm];

void test('alças das pontas: a outra ponta fica parada, mínimo de 10 cm', () => {
  const room = withWalls([side], { depthMm: 3000 });
  assert.equal(resizeWallEnd(side, 'end', 2403, room).widthMm, 2400);
  assert.equal(resizeWallEnd(side, 'end', 20, room).widthMm, 100, 'mínimo de 10 cm');
  assert.equal(resizeWallEnd(side, 'end', 2970, room).widthMm, 3000, 'gruda na profundidade');
  const fromStart = resizeWallEnd(side, 'start', 400, room);
  assert.deepEqual([fromStart.zMm, fromStart.widthMm], [400, 800], 'puxar a ponta de trás encurta pela frente dela');
  const along: Wall = { ...side, rotation: 0, xMm: 500, zMm: 1000, widthMm: 1000 };
  const left = resizeWallEnd(along, 'start', -3000, withWalls([along]));
  assert.deepEqual([left.xMm, left.widthMm], [-150, 1650], 'ao longo do fundo: anda em x até fora do canto');
});

void test('alça do topo: gruda no teto e nunca passa dele', () => {
  const room = withWalls([side]);
  assert.equal(resizeWallHeight(side, 1104, room).heightMm, 1100);
  assert.equal(resizeWallHeight(side, 2660, room).heightMm, 2700, 'perto do teto vai até ele');
  assert.equal(resizeWallHeight(side, 9000, room).heightMm, 2700);
  assert.equal(resizeWallHeight(side, 0, room).heightMm, 100);
});

void test('girar em volta do centro da base', () => {
  const wall: Wall = { ...side, xMm: 1000, zMm: 500 };
  const turned = rotateWall(wall, withWalls([wall]));
  assert.equal(turned.rotation, 0);
  const a = wallFootprint(wall),
    b = wallFootprint(turned);
  assert.deepEqual([(a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2], [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2]);
  assert.equal(rotateWall(rotateWall(wall, withWalls([wall])), withWalls([wall])).xMm, 1000, 'dois giros voltam ao lugar');
});

void test('parede do fundo: pontas mudam a largura sem passar por cima dos obstáculos', () => {
  const door: Obstacle = { id: 'door-1', kind: 'door', xMm: 400, yMm: 0, widthMm: 800, heightMm: 2100 };
  const room: Room = { ...withWalls([side]), obstacles: [door] };
  assert.equal(resizeMainWall(room, bounds, 'end', 3604).widthMm, 3600);
  assert.equal(resizeMainWall(room, bounds, 'end', 100).widthMm, 1250, 'para no batente da porta');
  assert.equal(resizeMainWall(room, bounds, 'end', 1030).widthMm, 1250);
  const moved = resizeMainWall({ ...room, obstacles: [] }, bounds, 'end', 980);
  assert.equal(moved.widthMm, 1000, 'gruda no lado direito do móvel');
});

void test('ponta esquerda prende a parede e deixa obstáculos e paredes no mesmo lugar do mundo', () => {
  const door: Obstacle = { id: 'door-1', kind: 'door', xMm: 1400, yMm: 0, widthMm: 800, heightMm: 2100 };
  const room: Room = { ...withWalls([side]), obstacles: [door] };
  const world = (r: Room, x: number) => wallAt(r, bounds).x + x;
  const next = resizeMainWall(room, bounds, 'start', -600);
  assert.equal(next.widthMm, 3600);
  assert.deepEqual(next.anchor, { x: -1100, z: -200 });
  assert.equal(next.offsetMm, 600);
  assert.equal(world(next, next.obstacles![0].xMm), world(room, door.xMm), 'a porta fica onde estava');
  assert.equal(world(next, next.walls![0].xMm), world(room, side.xMm), 'a parede lateral também');
  const inward = resizeMainWall(room, bounds, 'start', 2000);
  assert.equal(inward.widthMm, 3000 - 1350, 'para no batente da porta');
  assert.equal(resizeMainWall(room, bounds, 'start', 3), room, 'sem mudança, o mesmo ambiente');
});

void test('pé-direito: não desce sobre obstáculo; paredes no teto acompanham', () => {
  const low: Wall = { ...side, id: 'wall-2', heightMm: 1100 };
  const room: Room = { ...withWalls([side, low]), obstacles: [{ id: 'w', kind: 'window', xMm: 100, yMm: 1100, widthMm: 900, heightMm: 1000 }] };
  const up = resizeMainWall(room, bounds, 'top', 3000);
  assert.deepEqual(up.walls?.map((w) => w.heightMm), [3000, 1100], 'a do teto sobe junto, a mureta fica');
  const down = resizeMainWall(room, bounds, 'top', 1000);
  assert.equal(down.heightMm, 2130, 'para acima da janela com o caixilho');
  assert.deepEqual(fitWallsToCeiling([side, low], 2700, 1000).map((w) => w.heightMm), [1000, 1000]);
});

void test('parede que cruza o móvel não cabe; encostada cabe', () => {
  // O móvel ocupa x de -500 a 500; a parede do fundo começa em -500.
  const through = fitReport(design(), withWalls([{ ...side, xMm: 900 }]));
  assert.equal(through.fits, false);
  assert.equal(through.issues[0].code, 'wall-overlap');
  assert.match(through.issues[0].message, /^A parede 1 cruza o módulo/);
  assert.deepEqual(through.crossedWalls, ['wall-1']);
  const touching = fitReport(design(), withWalls([{ ...side, xMm: 1000 }]));
  assert.equal(touching.fits, true);
  assert.deepEqual(touching.crossedWalls, []);
  const inFront = fitReport(design(), withWalls([{ ...side, xMm: 0, zMm: 450, rotation: 0, widthMm: 1000 }]));
  assert.equal(inFront.fits, true, 'na frente do móvel, sem tocar');
  const low = fitReport(design(), withWalls([{ ...side, xMm: 900, heightMm: 2000 }], { heightMm: 2700 }));
  assert.equal(low.fits, false, 'mureta também é alvenaria');
});

void test('rótulos da versão e ajustes que juntam numa só', () => {
  const a = withWalls([side]);
  assert.equal(roomChangeLabel(withWalls([]), a), 'Pôs a parede 1');
  assert.equal(roomChangeLabel(a, withWalls([])), 'Tirou a parede 1');
  assert.equal(roomChangeLabel(a, withWalls([{ ...side, xMm: 10 }])), 'Moveu a parede 1');
  assert.equal(roomChangeLabel(a, withWalls([{ ...side, widthMm: 900 }])), 'Mudou a parede 1');
  assert.equal(roomChangeLabel(a, withWalls([rotateWall(side, a)])), 'Girou a parede 1');
  assert.equal(roomChangeLabel(undefined, a), 'Ambiente com a parede 1');
  assert.equal(roomChangeLabel(a, resizeMainWall(a, bounds, 'start', -300)), 'Medidas da parede', 'o canto novo reconta as paredes, mas quem mudou foi o fundo');
  assert.equal(editedWall(a, withWalls([{ ...side, widthMm: 900, heightMm: 1000 }])), 'wall-1');
  assert.equal(editedWall(a, withWalls([{ ...side, thicknessMm: 200 }])), null, 'espessura é pelo painel: versão nova');
  assert.equal(editedWall(a, withWalls([{ ...side, xMm: 1 }], { widthMm: 4000 })), null);
});

void test('ajustes seguidos da mesma parede ficam numa versão e desfazem um a um', () => {
  const p = get(create().id);
  reviseRoom(p, withWalls([side]), 'Pôs a parede 1');
  const t0 = Date.now();
  reviseRoom(p, withWalls([{ ...side, widthMm: 1500 }]), 'Mudou a parede 1', t0);
  reviseRoom(p, withWalls([{ ...side, widthMm: 1500, heightMm: 1100 }]), 'Mudou a parede 1', t0 + 1000);
  reviseRoom(p, withWalls([{ ...side, widthMm: 1500, heightMm: 1100, xMm: 1000 }]), 'Moveu a parede 1', t0 + 2000);
  assert.equal(p.revisions.length, 3, 'inicial, parede posta, uma versão de ajustes');
  assert.equal(p.revisions[2].placement?.wall, true);
  const now = () => p.room!.walls![0];
  assert.equal(undoIsStep(p), true);
  assert.equal(undo(p), 'step');
  assert.deepEqual([now().xMm, now().widthMm, now().heightMm], [2850, 1500, 1100]);
  assert.equal(undo(p), 'step');
  assert.deepEqual([now().widthMm, now().heightMm], [1500, 2700], 'desfazer volta a medida, não só o lugar');
  assert.equal(undo(p), 'version');
  assert.equal(now().widthMm, 1200);
  assert.equal(redo(p), 'version');
  assert.equal(redo(p), 'step');
  assert.equal(redo(p), 'step');
  assert.deepEqual([now().xMm, now().heightMm], [1000, 1100]);
  // Outra parede, ou mudar a espessura: versão nova.
  reviseRoom(p, withWalls([{ ...now(), thicknessMm: 200 }]), 'Mudou a parede 1', t0 + 3000);
  assert.equal(p.revisions.length, 4);
});
