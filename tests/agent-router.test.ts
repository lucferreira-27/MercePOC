import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRoute, DIRECT, routerQuestions } from '../lib/agent/router';
import type { JevAnswer } from '../lib/agent/jev';
import { CLAIMS, claimGaps, WANTS, wantGaps } from '../lib/agent/tools';
import { defaults } from '../lib/furniture';
import { migrateParams } from '../lib/studio';

/** Respostas no formato do Jev, só com o que o caso precisa. */
function answers(intent: string, conf: number, flags: Record<string, number>): Record<string, JevAnswer> {
  const out: Record<string, JevAnswer> = {
    intent: { type: 'choice', choice: intent, confidence: conf, probabilities: {} },
  };
  // `other` resume as quatro portas de saída (muda o móvel, config, pergunta, alvo).
  const { other = 0, ...rest } = flags;
  for (const g of ['g_movel', 'g_criar', 'g_config', 'g_pergunta', 'g_alvo']) out[g] = { type: 'noul', noul: g === 'g_movel' ? other : 0 };
  for (const [k, v] of Object.entries(rest)) out[k] = { type: 'noul', noul: v };
  return out;
}

void test('roteador: uma pergunta por ação direta, todas no mesmo estado', () => {
  const q = routerQuestions();
  for (const id of Object.keys(DIRECT)) assert.ok(q[`d_${id}`], id);
  assert.ok(q.intent && q.vague && q.multi && q.g_movel && q.g_criar && q.g_config && q.g_pergunta && q.g_alvo);
});

void test('roteador: tela com certeza vira ação direta; conflito ou algo a mais vai para o laço', () => {
  assert.deepEqual(decideRoute('mostra de frente e abre as gavetas', answers('view', 0.99, { other: 0.05, d_vista_frente: 0.97, d_abrir_frentes: 0.92 })), {
    kind: 'direct',
    intent: 'view',
    actions: ['vista_frente', 'abrir_frentes'],
  });
  assert.equal(decideRoute('abre e fecha', answers('view', 0.99, { other: 0.05, d_abrir_frentes: 0.9, d_fechar_frentes: 0.9 })).kind, 'agent');
  assert.equal(decideRoute('mostra de frente e põe gavetas', answers('view', 0.95, { other: 0.8, d_vista_frente: 0.97 })).kind, 'agent');
  assert.equal(decideRoute('mostra de frente e manda o pdf', answers('view', 0.6, { other: 0.05, multi: 0.9, d_vista_frente: 0.97, d_pdf: 0.7 })).kind, 'agent', 'pedido de duas ações com uma escolhida');
});

void test('roteador: medida sem eixo pergunta; com eixo, porcentagem ou sem número, não', () => {
  assert.equal(decideRoute('aumenta 10 cm', answers('edit', 1, { vague: 0.93, other: 0.9 })).kind, 'ask_axis');
  assert.equal(decideRoute('aumenta 10 cm na altura', answers('edit', 1, { vague: 0.93, other: 0.9 })).kind, 'agent');
  assert.equal(decideRoute('deixa mais largo', answers('edit', 1, { vague: 0.93, other: 0.9 })).kind, 'agent');
});

void test('roteador: sem Jev, sempre o laço com o orçamento padrão', () => {
  assert.deepEqual(decideRoute('qualquer coisa', null), { kind: 'agent', intent: null, budget: 12 });
  assert.equal((decideRoute('faz uma cozinha', answers('build', 1, { other: 1 })) as { budget: number }).budget, 16);
});

void test('roteador: pedido de montar abre a porta de saída mesmo com vista e PDF certos', () => {
  const a = answers('build', 0.98, { d_vista_frente: 0.97, d_pdf: 0.9, multi: 0.94, g_criar: 0.98 });
  const route = decideRoute('Cozinha para uma parede de 3,2 m com janela. Mostre de frente e me mande o PDF', a);
  assert.equal(route.kind, 'agent');
  // Criar abaixo do limiar próprio (vistas chegam a ~0,45) não atrapalha o atalho.
  assert.equal(decideRoute('mostra de frente', answers('view', 1, { d_vista_frente: 0.97, g_criar: 0.43 })).kind, 'direct');
});

void test('conferência da resposta: só barra ação afirmada sem ferramenta que prove', () => {
  const said = (flags: Record<string, number>) =>
    Object.fromEntries(Object.keys(CLAIMS).map((k) => [k, { type: 'noul' as const, noul: flags[k] ?? 0.05 }]));
  const kitchen = { tools: new Set(['row_build', 'view_camera', 'export_file']), changes: ['Módulo "Balcão 1" adicionado'], view: null };
  // Resposta cheia de detalhes (medidas, gavetas) do que foi feito: passa.
  assert.deepEqual(claimGaps(said({ arquivo: 0.88, vista: 0.76, movel: 0.63 }), kitchen), []);
  // PDF afirmado sem exportar.
  assert.equal(claimGaps(said({ arquivo: 0.91 }), { ...kitchen, tools: new Set(['row_build']) }).length, 1);
  // Material afirmado com só um módulo novo: nenhum material mudou.
  assert.match(claimGaps(said({ movel: 0.94, material: 0.65 }), kitchen).join(), /material/);
  // Já estava de frente: descrever a vista não precisa de ferramenta.
  assert.deepEqual(claimGaps(said({ vista: 0.8 }), { tools: new Set(), changes: [], view: 'front' }), []);
  assert.equal(claimGaps(said({ vista: 0.8 }), { tools: new Set(), changes: [], view: 'perspective' }).length, 1);
});

void test('pedido cumprido: aéreos e PDF pedidos precisam existir no fim', () => {
  const asked = (flags: Record<string, number>) =>
    Object.fromEntries(Object.keys(WANTS).map((k) => [k, { type: 'noul' as const, noul: flags[k] ?? 0.05 }]));
  const design = migrateParams(defaults);
  const floorOnly = { tools: new Set(['row_build']), changes: ['Módulo "Balcão 1" adicionado'], view: null, designs: [design] };
  const gaps = wantGaps(asked({ aereos: 0.97, arquivo: 0.97 }), floorOnly);
  assert.equal(gaps.length, 2);
  assert.match(gaps.join(), /aéreos/);
  const hung = { ...design, modules: design.modules.map((m) => ({ ...m, wall: true })) };
  assert.deepEqual(wantGaps(asked({ aereos: 0.97, arquivo: 0.97 }), { ...floorOnly, tools: new Set(['row_build', 'export_file']), designs: [hung] }), []);
  // "Tira os aéreos" não pede aéreos: nada a cobrar.
  assert.deepEqual(wantGaps(asked({ aereos: 0.06 }), floorOnly), []);
});
