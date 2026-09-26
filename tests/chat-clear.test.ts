import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { clearChat, create, get, restoreChat, save } from '../lib/store';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-chat-clear-'));

void test('limpar a conversa guarda as mensagens e deixa uma nota com a versão', () => {
  const p = get(create().id);
  p.messages.push({ id: 'u1', role: 'user', content: 'Mais largo' }, { id: 'a1', role: 'assistant', content: 'Feito' });
  const before = p.messages.map((m) => m.id);
  assert.equal(clearChat(p).noop, false);
  assert.equal(p.messages.length, 1);
  assert.match(p.messages[0].content, /Conversa limpa\. O projeto continua na versão 1/);
  const shown = save(p, p.version);
  // O cliente não recebe a conversa guardada, só quantas mensagens ela tem.
  assert.equal('clearedChat' in shown, false);
  assert.equal(shown.chatCleared?.count, before.length);
  // Limpar de novo só com a nota não apaga o que dá para desfazer.
  const again = get(p.id);
  assert.equal(clearChat(again).noop, true);
  assert.deepEqual(again.clearedChat?.messages.map((m) => m.id), before);
});

void test('restaurar devolve a conversa antes do que foi dito depois e tira a nota', () => {
  const p = get(create().id);
  p.messages.push({ id: 'u1', role: 'user', content: 'Mais largo' });
  const before = p.messages.map((m) => m.id);
  clearChat(p);
  p.messages.push({ id: 'u2', role: 'user', content: 'Agora mais alto' });
  restoreChat(p);
  assert.deepEqual(p.messages.map((m) => m.id), [...before, 'u2']);
  assert.equal(p.clearedChat, undefined);
  assert.throws(() => restoreChat(p), /Não há conversa/);
});
