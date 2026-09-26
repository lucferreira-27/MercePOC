import test from 'node:test';
import assert from 'node:assert/strict';
import { cases, ASK_ACT, askActMiss, INFRA_ERROR, caseHash } from '../bench/cases.mjs';

const actionsOf = (c: (typeof cases)[number]) => {
  const a = (c.expect as { action?: string | string[] } | undefined)?.action;
  return a ? (Array.isArray(a) ? a : [a]) : [];
};

void test('todo caso do bench diz se o certo é agir, perguntar, responder ou livre', () => {
  for (const c of cases) assert.ok(ASK_ACT.includes(c.askAct), `${c.id} sem askAct válido (${c.askAct})`);
});

void test('a ação esperada combina com o rótulo de perguntar ou agir', () => {
  for (const c of cases) {
    const accepted = actionsOf(c);
    for (const action of accepted)
      assert.equal(askActMiss(c.askAct, action), null, `${c.id} (${c.askAct}) aceita ${action}`);
  }
});

void test('perguntar em caso de agir, ou agir em caso de perguntar, tem nome próprio', () => {
  assert.equal(askActMiss('agir', 'clarify'), 'perguntou em vez de fazer');
  assert.equal(askActMiss('responder', 'clarify'), 'perguntou em vez de responder');
  assert.equal(askActMiss('perguntar', 'update'), 'fez em vez de perguntar');
  assert.equal(askActMiss('perguntar', 'answer'), null);
  assert.equal(askActMiss('livre', 'clarify'), null);
  assert.equal(askActMiss('livre', 'update'), null);
});

void test('erro do provedor é infraestrutura; erro do móvel não é', () => {
  assert.ok(INFRA_ERROR.test('exceção: O provedor de IA retornou 503. {"error":{"message":"Endpoint is unavailable."}}'));
  assert.ok(INFRA_ERROR.test('exceção: A conexão com a IA foi interrompida. Tente novamente.'));
  // "prateleira" contém "rate": o painel antigo contava isso como provedor.
  assert.ok(!INFRA_ERROR.test('não moveu a prateleira selecionada'));
  assert.ok(!INFRA_ERROR.test('exceção: sem fixture gravada: uni-01#2.json (rode com --agent --record)'));
});

void test('a impressão do caso muda quando a expectativa muda', () => {
  const c = cases.find((v) => v.id === 'lim-02')!;
  assert.equal(caseHash(c), caseHash({ ...c }));
  assert.notEqual(caseHash(c), caseHash({ ...c, askAct: 'perguntar' }));
  assert.notEqual(caseHash(c), caseHash({ ...c, expect: { ...c.expect, action: ['clarify'] } }));
});
