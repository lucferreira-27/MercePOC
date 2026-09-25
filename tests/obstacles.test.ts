import test from 'node:test';
import assert from 'node:assert/strict';
import { applyObstacleEdits, obstacleEditsSchema, type Room } from '../lib/room';
import { obstacleCrosses } from '../lib/scene-room';
import { handleSpec } from '../lib/furniture-motion';
import { moduleSpans } from '../lib/scene-dims';
import type { Part } from '../lib/furniture';

const room = (): Room => ({
  schemaVersion: 1,
  widthMm: 3000,
  heightMm: 2700,
  obstacles: [{ id: 'door-1', kind: 'door', xMm: 2000, yMm: 0, widthMm: 800, heightMm: 2100 }],
});

void test('IA põe, move e tira obstáculos da parede sem mexer no resto', () => {
  const edits = obstacleEditsSchema.parse({
    add: [
      { kind: 'window', xMm: 900.4, yMm: 1000, widthMm: 800, heightMm: 1000 },
      { kind: 'outlet', xMm: 200, yMm: 300, widthMm: 80, heightMm: 80 },
    ],
    move: [{ id: 'door-1', xMm: 2100 }],
  });
  const { room: next, skipped } = applyObstacleEdits(room(), edits);
  assert.deepEqual(skipped, []);
  assert.deepEqual(
    next.obstacles?.map((o) => `${o.id}:${o.xMm}`),
    ['door-1:2100', 'window-1:900', 'outlet-1:200'],
    'ids novos não colidem com os existentes e x vira mm inteiro',
  );
  assert.equal(next.widthMm, 3000);
  const removed = applyObstacleEdits(next, obstacleEditsSchema.parse({ remove: ['window-1'] })).room;
  assert.deepEqual(removed.obstacles?.map((o) => o.id), ['door-1', 'outlet-1']);
});

void test('sem ambiente, a IA começa uma parede que cabe o móvel', () => {
  const { room: made } = applyObstacleEdits(undefined, obstacleEditsSchema.parse({ add: [{ kind: 'outlet', xMm: 300, yMm: 300, widthMm: 80, heightMm: 80 }] }), 3400);
  assert.equal(made.widthMm, 4600);
  assert.equal(made.obstacles?.length, 1);
});

void test('obstáculo inválido ou id desconhecido volta como não aplicado', () => {
  const { room: next, skipped } = applyObstacleEdits(
    room(),
    obstacleEditsSchema.parse({ add: [{ kind: 'window', xMm: 0, yMm: -50, widthMm: 900, heightMm: 900 }], move: [{ id: 'nada', xMm: 10 }] }),
  );
  assert.deepEqual(skipped, ['nada', 'window']);
  assert.equal(next.obstacles?.length, 1);
});

void test('vermelho só quando cruza um módulo de verdade, não a caixa do conjunto', () => {
  // Estante alta à esquerda (0..800, até 1800) e rack baixo à direita (1100..2300, até 550).
  const modules = [
    { min: [0, 0, 0], max: [800, 1800, 350] },
    { min: [1100, 0, 0], max: [2300, 550, 350] },
  ];
  const window = { id: 'w', kind: 'window' as const, xMm: 1200, yMm: 1100, widthMm: 900, heightMm: 1000 };
  assert.equal(obstacleCrosses(window, modules, 0), false, 'janela acima do rack');
  assert.equal(obstacleCrosses({ ...window, xMm: 500 }, modules, 0), true, 'janela sobre a estante');
});

void test('puxador: porta do lado oposto à dobradiça, gaveta só na frente', () => {
  const door = {
    id: 'a:door-l',
    size: [400, 1700, 18],
    position: [200, 900, 180],
    rotation: 0,
    motion: { id: 'm', type: 'door', pivot: [0, 900, 180] as [number, number, number] },
  } as unknown as Part;
  const spec = handleSpec(door as never)!;
  assert.equal(spec.vertical, true);
  assert.ok(spec.x > 0, 'dobradiça à esquerda, puxador à direita');
  assert.equal(spec.y + 900, 1000, 'porta alta: puxador a 1 m do piso');
  const box = { id: 'a:drawer-0:side-l', size: [18, 150, 400], position: [0, 100, 0], motion: { type: 'drawer', pivot: [0, 0, 0] } };
  assert.equal(handleSpec(box as never), null);
  const front = { ...box, id: 'a:drawer-0:front', size: [600, 180, 18] };
  assert.equal(handleSpec(front as never)?.vertical, false);
});

void test('cotas de módulo ficam na frente do próprio módulo', () => {
  const parts = [
    { id: 'a1', owners: ['a'], size: [800, 1800, 350], position: [400, 900, 0], rotation: 0 },
    { id: 'b1', owners: ['b'], size: [1200, 550, 350], position: [1700, 275, 700], rotation: 0 },
  ] as unknown as Part[];
  const [a, b] = moduleSpans(parts);
  assert.equal(a.front, 175);
  assert.equal(b.front, 875);
});

void test('resposta da IA com obstáculos passa pelo contrato', async () => {
  const { decisionSchema } = await import('../lib/gateway');
  const d = decisionSchema.parse({
    action: 'answer',
    approach: 'Porta na parede direita.',
    message: 'Coloquei uma porta de 80 cm.',
    obstacles: { add: [{ kind: 'door', xMm: 2100, yMm: 0, widthMm: 800, heightMm: 2100 }] },
  });
  assert.equal(d.obstacles?.add[0].kind, 'door');
  assert.deepEqual(d.obstacles?.remove, []);
});

void test('obstáculo não pode ocupar o lugar de outro na parede', async () => {
  const { obstacleOverlap } = await import('../lib/room');
  const tv = { id: 'tv-1', kind: 'tv' as const, xMm: 1200, yMm: 1950, widthMm: 700, heightMm: 400 };
  const window = { id: 'window-1', kind: 'window' as const, xMm: 2050, yMm: 1150, widthMm: 800, heightMm: 900 };
  assert.equal(obstacleOverlap({ ...window, xMm: 1470, yMm: 1610 }, [tv, window])?.id, 'tv-1');
  assert.equal(obstacleOverlap(window, [tv, window]), null, 'no lugar dela, não bate em si mesma');
  assert.equal(obstacleOverlap({ ...window, xMm: 1930, yMm: 1150 }, [tv, window]), null, 'caixilho encostado na TV não é bater');
  const door = { id: 'door-1', kind: 'door' as const, xMm: 3250, yMm: 0, widthMm: 800, heightMm: 2100 };
  assert.equal(obstacleOverlap({ ...window, xMm: 2420 }, [door])?.id, 'door-1', 'caixilho e batente se cruzam');
  assert.equal(obstacleOverlap({ ...window, xMm: 2360 }, [door]), null, 'com o batente de folga, cabe');
});

void test('painel, servidor e IA recusam obstáculo em cima de outro', async () => {
  const { obstacleClash } = await import('../lib/room');
  const tv = { id: 'tv-1', kind: 'tv' as const, xMm: 1200, yMm: 1950, widthMm: 700, heightMm: 400 };
  const win = { id: 'window-1', kind: 'window' as const, xMm: 1500, yMm: 1600, widthMm: 800, heightMm: 900 };
  assert.equal(obstacleClash([tv, win]), 'A TV bate na janela. Afaste um dos dois na parede.');
  assert.equal(obstacleClash([tv, { ...win, xMm: 2000 }]), null);
  const other = { id: 'x', kind: 'other' as const, label: 'Quadro', xMm: 1300, yMm: 2000, widthMm: 100, heightMm: 100 };
  assert.equal(obstacleClash([{ ...win, xMm: 2000 }, other, tv]), 'O obstáculo "Quadro" bate na TV. Afaste um dos dois na parede.');
  // IA: pôr ou mover para cima de outro volta como não aplicado.
  const base: Room = { ...room(), obstacles: [tv] };
  const r = applyObstacleEdits(
    base,
    obstacleEditsSchema.parse({ add: [{ kind: 'window', xMm: 1300, yMm: 1700, widthMm: 800, heightMm: 900 }], move: [{ id: 'tv-1', xMm: 1100 }] }),
  );
  assert.deepEqual(r.skipped, ['window'], 'a janela cairia sobre a TV já movida');
  assert.equal(r.room.obstacles?.find((o) => o.id === 'tv-1')?.xMm, 1100, 'mover para lugar livre continua valendo');
});
