import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeRequest, type ShelfOp } from '../lib/studio';
import { applyPlacement, applyRequest, create, get, redo, revise, undo, type Project } from '../lib/store';
import { PLACEMENT_MERGE_MS, canRedo, canUndo, placementRoot, undoIsStep } from '../lib/placement';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-placement-'));

/** Projeto com a estante e um rack solto à direita (versão 2). */
function project(): Project {
  const p = get(create().id);
  const r = executeRequest(p.revisions[0].params, [
    { kind: 'module.add', id: 'n', preset: 'niche', name: 'Rack' },
    { kind: 'module.edit', id: 'n', width: 1200, height: 550, depth: 350, position: [1100, 0, 0] },
  ] as unknown as ShelfOp[]);
  assert.ok(r.ok);
  revise(p, r.design, 'Rack solto');
  return p;
}
const move = (x: number): ShelfOp[] => [{ kind: 'module.edit', id: 'n', position: [x, 0, 0] } as unknown as ShelfOp];
const xOf = (p: Project) =>
  (p.revisions[p.cursor].params as unknown as { modules: { id: string; position: number[] }[] }).modules.find((m) => m.id === 'n')!.position[0];

void test('só posição e giro de um módulo contam como movimento', () => {
  assert.equal(placementRoot(move(10) as never), 'n');
  assert.equal(placementRoot([{ kind: 'module.edit', id: 'n', rotation: 90 }]), 'n');
  assert.equal(placementRoot([{ kind: 'module.edit', id: 'n', width: 900 }]), null);
  assert.equal(placementRoot([{ kind: 'module.edit', id: 'n', position: [0, 0, 0], width: 900 }]), null);
  assert.equal(placementRoot([...move(10), ...move(20)] as never), null);
});

void test('movimentos seguidos viram uma versão só e desfazem passo a passo', () => {
  const p = project();
  const t0 = Date.now();
  applyPlacement(p, move(1200), 'Moveu Rack', 'n', t0);
  applyPlacement(p, move(1300), 'Moveu Rack', 'n', t0 + 1000);
  applyPlacement(p, move(1400), 'Moveu Rack', 'n', t0 + 2000);
  assert.equal(p.revisions.length, 3, 'estante, rack, uma versão de movimentos');
  assert.equal(p.revisions[2].label, 'Moveu Rack');
  assert.equal(xOf(p), 1400);
  assert.equal(undoIsStep(p), true);

  assert.equal(undo(p), 'step');
  assert.equal(xOf(p), 1300);
  assert.equal(undo(p), 'step');
  assert.equal(xOf(p), 1200);
  // Sem passos: a versão anterior, com o rack onde estava antes da sequência.
  assert.equal(undo(p), 'version');
  assert.equal(p.cursor, 1);
  assert.equal(xOf(p), 1100);

  assert.equal(redo(p), 'version');
  assert.equal(xOf(p), 1200);
  assert.equal(redo(p), 'step');
  assert.equal(redo(p), 'step');
  assert.equal(xOf(p), 1400);
  assert.equal(canRedo(p), false);
  assert.equal(redo(p), null);
});

void test('mover depois de desfazer descarta os passos à frente, como um editor', () => {
  const p = project();
  const t0 = Date.now();
  applyPlacement(p, move(1200), 'Moveu Rack', 'n', t0);
  applyPlacement(p, move(1300), 'Moveu Rack', 'n', t0 + 1000);
  undo(p);
  applyPlacement(p, move(1500), 'Moveu Rack', 'n', t0 + 2000);
  assert.equal(p.revisions.length, 3);
  assert.equal(canRedo(p), false);
  assert.equal(undo(p), 'step');
  assert.equal(xOf(p), 1200);
});

void test('pausa longa, outro móvel ou outra edição abrem versão nova', () => {
  const p = project();
  const t0 = Date.now();
  applyPlacement(p, move(1200), 'Moveu Rack', 'n', t0);
  applyPlacement(p, move(1300), 'Moveu Rack', 'n', t0 + PLACEMENT_MERGE_MS + 1);
  assert.equal(p.revisions.length, 4, 'pausa longa');

  const first = (p.revisions[0].params as unknown as { modules: { id: string }[] }).modules[0].id;
  applyPlacement(p, [{ kind: 'module.edit', id: first, position: [-300, 0, 0] } as unknown as ShelfOp], 'Moveu Estante', first, t0 + PLACEMENT_MERGE_MS + 2);
  assert.equal(p.revisions.length, 5, 'outro móvel');

  applyRequest(p, [{ kind: 'module.edit', id: 'n', width: 1000 } as unknown as ShelfOp], 'Largura do rack');
  applyPlacement(p, move(1600), 'Moveu Rack', 'n', t0 + PLACEMENT_MERGE_MS + 3);
  assert.equal(p.revisions.length, 7, 'edição no meio');
});

void test('turno da IA na versão de movimentos fecha a sequência', () => {
  const p = project();
  const t0 = Date.now();
  applyPlacement(p, move(1200), 'Moveu Rack', 'n', t0);
  p.messages.push({ id: 'm', role: 'assistant', content: 'ok', revisionId: p.revisions[p.cursor].id });
  applyPlacement(p, move(1300), 'Moveu Rack', 'n', t0 + 1000);
  assert.equal(p.revisions.length, 4);
});

void test('passos só valem na ponta: versão com seguinte não desfaz por dentro', () => {
  const p = project();
  const t0 = Date.now();
  applyPlacement(p, move(1200), 'Moveu Rack', 'n', t0);
  applyPlacement(p, move(1300), 'Moveu Rack', 'n', t0 + 1000);
  applyRequest(p, [{ kind: 'module.edit', id: 'n', width: 1000 } as unknown as ShelfOp], 'Largura do rack');
  assert.equal(p.revisions[2].placement?.back.length, 0, 'passos congelados');
  assert.equal(undo(p), 'version');
  assert.equal(undo(p), 'version');
  assert.equal(p.cursor, 1);
  assert.equal(canUndo(p), true);
});
