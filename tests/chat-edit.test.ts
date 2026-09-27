import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create, get, revise, rewindChat } from '../lib/store';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-chat-edit-'));

/** Dois pedidos: o primeiro feito na versão 1, o segundo na 2. */
function twoTurns() {
  const p = get(create().id);
  const v1 = p.revisions[0].id;
  p.messages.push({ id: 'u1', role: 'user', content: 'Mais largo', revisionId: v1, context: { requestId: 'r1', baseRevisionId: v1, selectedPartIds: [], referencedPartIds: [] } });
  revise(p, p.revisions[p.cursor].params, 'Mais largo');
  const v2 = p.revisions[1].id;
  p.messages.push({ id: 'a1', role: 'assistant', content: 'Feito', revisionId: v2 });
  p.messages.push({ id: 'u2', role: 'user', content: 'Mais alto', revisionId: v2, context: { requestId: 'r2', baseRevisionId: v2, selectedPartIds: [], referencedPartIds: [] } });
  revise(p, p.revisions[p.cursor].params, 'Mais alto');
  p.messages.push({ id: 'a2', role: 'assistant', content: 'Feito', revisionId: p.revisions[2].id });
  return p;
}

void test('editar um pedido volta a conversa e o projeto para antes dele', () => {
  const p = twoTurns();
  const welcome = p.messages[0].id;
  rewindChat(p, 'u1');
  // Fica só a boas-vindas do projeto novo.
  assert.deepEqual(p.messages.map((m) => m.id), [welcome]);
  assert.equal(p.cursor, 0);
  // As versões seguintes só saem quando o pedido editado criar uma nova.
  assert.equal(p.revisions.length, 3);
});

void test('editar o último pedido mantém o que veio antes dele', () => {
  const p = twoTurns();
  rewindChat(p, 'u2');
  assert.deepEqual(p.messages.slice(1).map((m) => m.id), ['u1', 'a1']);
  assert.equal(p.cursor, 1);
});

void test('editar recusa resposta da IA, mensagem sumida e versão descartada', () => {
  const p = twoTurns();
  assert.throws(() => rewindChat(p, 'a1'), /Não encontrei a mensagem/);
  assert.throws(() => rewindChat(p, 'nada'), /Não encontrei a mensagem/);
  const u2 = p.messages.find((m) => m.id === 'u2')!;
  u2.context!.baseRevisionId = 'sumiu';
  u2.revisionId = 'sumiu';
  assert.throws(() => rewindChat(p, 'u2'), /foi descartada/);
  assert.equal(p.messages.length, 5);
});
