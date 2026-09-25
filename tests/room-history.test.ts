import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create, fork, get, moveCursor, redo, reviseRoom, revise, seek, settleRoom, undo, type Project } from '../lib/store';
import { undoIsStep } from '../lib/placement';
import {
  emptyRoom,
  freeSpot,
  movedObstacle,
  presetObstacle,
  roomChangeLabel,
  type Obstacle,
  type Room,
} from '../lib/room';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-room-history-'));

const door: Obstacle = { id: 'door-1', kind: 'door', xMm: 2000, yMm: 0, widthMm: 800, heightMm: 2100 };
const withObstacles = (list: Obstacle[]): Room => ({ ...emptyRoom(), obstacles: list });
const xOf = (p: Project, id = 'door-1') => p.room?.obstacles?.find((o) => o.id === id)?.xMm;

/** Projeto recém-criado, já relido do banco (as versões ganham o ambiente). */
function project(): Project {
  return get(create().id);
}

void test('pôr e tirar obstáculo vira versão, e Ctrl+Z traz o ambiente de volta', () => {
  const p = project();
  assert.equal(p.revisions[0].room, null, 'versão antiga sem ambiente');
  reviseRoom(p, withObstacles([door]), roomChangeLabel(p.room, withObstacles([door])));
  assert.equal(p.revisions.length, 2);
  assert.equal(p.revisions[1].label, 'Ambiente com a porta');
  const win: Obstacle = { id: 'window-1', kind: 'window', xMm: 400, yMm: 1100, widthMm: 900, heightMm: 900 };
  const next = withObstacles([door, win]);
  reviseRoom(p, next, roomChangeLabel(p.room, next));
  assert.equal(p.revisions[2].label, 'Pôs a janela');
  const gone = withObstacles([win]);
  reviseRoom(p, gone, roomChangeLabel(p.room, gone));
  assert.equal(p.revisions[3].label, 'Tirou a porta');
  assert.equal(xOf(p), undefined);

  assert.equal(undo(p), 'version');
  assert.equal(xOf(p), 2000, 'desfazer devolve a porta');
  assert.equal(undo(p), 'version');
  assert.equal(p.room?.obstacles?.length, 1);
  assert.equal(undo(p), 'version');
  assert.equal(p.room, undefined, 'primeira versão: sem ambiente');
  assert.equal(redo(p), 'version');
  assert.equal(xOf(p), 2000);
  seek(p, 3);
  assert.deepEqual([xOf(p), xOf(p, 'window-1')], [undefined, 400], 'abrir a versão traz o ambiente dela');
});

void test('arrastos seguidos do mesmo obstáculo ficam numa versão e desfazem um a um', () => {
  const p = project();
  reviseRoom(p, withObstacles([door]), 'Ambiente com a porta');
  const at = (x: number) => withObstacles([{ ...door, xMm: x }]);
  const t0 = Date.now();
  reviseRoom(p, at(1500), 'Moveu a porta', t0);
  reviseRoom(p, at(1200), 'Moveu a porta', t0 + 1000);
  reviseRoom(p, at(900), 'Moveu a porta', t0 + 2000);
  assert.equal(p.revisions.length, 3, 'inicial, porta posta, uma versão de arrastos');
  assert.equal(p.revisions[2].placement?.obstacle, true);
  assert.equal(undoIsStep(p), true);
  assert.equal(undo(p), 'step');
  assert.equal(xOf(p), 1200);
  assert.equal(p.revisions[2].room?.obstacles?.[0].xMm, 1200, 'a versão guarda o passo');
  assert.equal(undo(p), 'step');
  assert.equal(xOf(p), 1500);
  assert.equal(undo(p), 'version');
  assert.equal(xOf(p), 2000);
  assert.equal(redo(p), 'version');
  assert.equal(redo(p), 'step');
  assert.equal(redo(p), 'step');
  assert.equal(xOf(p), 900);
  // Mudar de tamanho não é arrastar: versão nova.
  reviseRoom(p, withObstacles([{ ...door, xMm: 900, widthMm: 900 }]), 'Mudou a porta', t0 + 3000);
  assert.equal(p.revisions.length, 4);
});

void test('turno da IA que só mexe na parede vira versão; alternativa leva o ambiente da versão', () => {
  const p = project();
  p.room = withObstacles([door]);
  assert.equal(settleRoom(p), 0);
  assert.equal(p.revisions.length, 2);
  assert.equal(p.revisions[1].label, 'IA: ambiente com a porta');
  assert.equal(settleRoom(p), 0, 'sem mudança, nada');
  assert.equal(p.revisions.length, 2);
  // Mudança no móvel guarda o ambiente vigente junto.
  revise(p, p.revisions[1].params, 'Outra coisa');
  assert.equal(p.revisions[2].room?.obstacles?.length, 1);
  moveCursor(p, 0);
  assert.equal(p.room, undefined);
});

void test('alternativa a partir de uma versão leva o ambiente daquela versão', async () => {
  const { save } = await import('../lib/store');
  const p = project();
  reviseRoom(p, withObstacles([door]), 'Ambiente com a porta');
  reviseRoom(p, withObstacles([]), 'Tirou a porta');
  save(p, p.version);
  const alt = fork(p.id, 1, 'Com porta');
  assert.equal(alt.room?.obstacles?.[0].id, 'door-1');
});

void test('rótulo e arrasto: o que mudou no ambiente', () => {
  const a = withObstacles([door]);
  assert.equal(movedObstacle(a, withObstacles([{ ...door, xMm: 10 }])), 'door-1');
  assert.equal(movedObstacle(a, withObstacles([{ ...door, widthMm: 900 }])), null);
  assert.equal(movedObstacle(a, { ...withObstacles([{ ...door, xMm: 10 }]), widthMm: 4000 }), null);
  assert.equal(roomChangeLabel(a, withObstacles([{ ...door, xMm: 10 }])), 'Moveu a porta');
  assert.equal(roomChangeLabel(a, withObstacles([{ ...door, heightMm: 2000 }])), 'Mudou a porta');
  assert.equal(roomChangeLabel(a, { ...a, widthMm: 4000 }), 'Medidas da parede');
  assert.equal(roomChangeLabel(a, withObstacles([door, { ...door, id: 'x', kind: 'other', label: 'Quadro', xMm: 0 }])), 'Pôs "Quadro"');
});

void test('obstáculo novo vai para o primeiro lugar livre, longe do móvel quando dá', () => {
  const room = { ...withObstacles([door]), widthMm: 4500 };
  const win = presetObstacle('window', room, 'window-1');
  assert.deepEqual([win.widthMm, win.heightMm, win.yMm], [1000, 1000, 1100]);
  // Móvel de 0 a 1500 na parede: entre ele e a porta não cabe, vai depois da porta.
  assert.equal(freeSpot(win, room, (x0, x1) => x0 < 1500 && x1 > 0), 2880);
  // Sem lugar longe do móvel, aceita na frente dele (o veredito avisa).
  const tight = freeSpot(win, room, () => true);
  assert.equal(tight, 30);
  // Coluna vai do piso ao teto.
  assert.equal(presetObstacle('column', room, 'c').heightMm, 2700);
  // Parede sem espaço nenhum: null.
  assert.equal(freeSpot(presetObstacle('door', { widthMm: 700, heightMm: 2700 }, 'd'), { widthMm: 700, obstacles: [] }), null);
});
