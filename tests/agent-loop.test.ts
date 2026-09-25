import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create, get, save, type Message } from '../lib/store';
import { DEFAULT_PRICES } from '../lib/quote';
import { runAgentTurn } from '../lib/agent/turn';
import { runLoop } from '../lib/agent/loop';
import { AgentContext } from '../lib/agent/context';
import type { ChatMessage, ModelReply, ToolCall } from '../lib/agent/model';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-agent-'));
// Testes sem rede: sem Jev, o roteador cai no laço e a conferência é só de código.
process.env.MERCE_JEV = '0';

let n = 0;
const call = (name: string, args: unknown): ToolCall => ({
  id: `c${++n}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
/** Modelo roteirizado: cada chamada devolve o próximo passo e guarda o que recebeu. */
function scripted(steps: ((seen: ChatMessage[]) => ModelReply)[]) {
  const seen: ChatMessage[][] = [];
  let i = 0;
  const fake = async (o: { messages: ChatMessage[] }) => {
    seen.push(structuredClone(o.messages));
    const step = steps[Math.min(i++, steps.length - 1)];
    return step(o.messages);
  };
  return { fake, seen };
}
const reply = (...calls: ToolCall[]): ModelReply => ({ content: '', calls, finish: 'tool_calls' });

/** Projeto com o pedido já gravado, como a rota deixa antes de chamar a IA. */
function start(request: string) {
  const p = get(create().id);
  const user: Message = {
    id: `u${++n}`,
    role: 'user',
    content: request,
    revisionId: p.revisions[p.cursor].id,
    revision: p.cursor + 1,
    context: { requestId: `r${n}`, baseRevisionId: p.revisions[p.cursor].id, selectedPartIds: [], referencedPartIds: [] },
  };
  p.messages.push(user);
  const version = save(p, p.version).version;
  return { p, user, version };
}
function turn(p: ReturnType<typeof start>, fake: ReturnType<typeof scripted>['fake'], request: string) {
  return runAgentTurn({
    project: p.p,
    version: p.version,
    user: p.user,
    request,
    selected: [],
    ui: null,
    prices: structuredClone(DEFAULT_PRICES),
    model: 'deepseek',
    requestId: p.user.context!.requestId,
    started: Date.now(),
    signal: new AbortController().signal,
    progress: () => {},
    emit: () => {},
    onUsage: () => {},
    usage: () => ({}),
    call: fake as never,
  });
}

void test('laço: monta em duas etapas usando o id que a primeira devolveu, e grava uma versão só', async () => {
  const s = start('Nicho de 60 cm à direita com duas portas');
  const moduleId = s.p.revisions[0].params.modules[0].id;
  const { fake, seen } = scripted([
    () =>
      reply(
        call('design_apply', {
          ops: [
            { kind: 'module.add', id: 'nicho', preset: 'niche', name: 'Nicho' },
            { kind: 'module.edit', id: 'nicho', width: 600 },
            { kind: 'connect', parent: moduleId, child: 'nicho', side: 'right', shared: false, align: 'front', offset: 0 },
          ],
        }),
      ),
    (msgs) => {
      // O resultado anterior trouxe o id do compartimento novo.
      const last = msgs.at(-1)!;
      assert.equal(last.role, 'tool');
      assert.match(String(last.content), /nicho:root/);
      return reply(call('design_apply', { ops: [{ kind: 'front.set', id: 'nicho:root', type: 'double' }] }));
    },
    () => reply(call('finish', { mensagem: 'Pus um nicho de 60 cm à direita com duas portas.', sugestoes: ['Troque as portas por gavetas'] })),
  ]);
  const before = s.p.revisions.length;
  const r = await turn(s, fake, 'Nicho de 60 cm à direita com duas portas');
  assert.equal(seen.length, 3);
  const p = get(r.projectId);
  assert.equal(p.revisions.length, before + 1, 'o pedido inteiro é uma versão');
  const nicho = p.revisions.at(-1)!.params.modules.find((m) => m.id === 'nicho');
  assert.equal(nicho?.width, 600);
  assert.equal(nicho?.root.front?.type, 'double');
  const answer = p.messages.at(-1)!;
  assert.equal(answer.result?.outcome, 'applied');
  assert.equal(answer.result?.appliedOperations.length, 4);
  assert.deepEqual(answer.report?.steps?.map((v) => v.tool), ['design_apply', 'design_apply', 'finish']);
  assert.ok(answer.report?.highlights?.length);
  assert.deepEqual(answer.suggestions, ['Troque as portas por gavetas']);
});

void test('laço: recusa da validação volta como resultado, o lote é pulado e a IA corrige', async () => {
  const s = start('Deixe com 90 cm de largura');
  const moduleId = s.p.revisions[0].params.modules[0].id;
  const { fake, seen } = scripted([
    () =>
      reply(
        call('design_apply', { ops: [{ kind: 'module.edit', id: 'nao-existe', width: 900 }] }),
        call('view_camera', { vista: 'front' }),
      ),
    () => reply(call('design_apply', { ops: [{ kind: 'module.edit', id: moduleId, width: 900 }] })),
    () => reply(call('finish', { mensagem: 'Largura de 90 cm.' })),
  ]);
  const r = await turn(s, fake, 'Deixe com 90 cm de largura');
  const second = seen[1];
  const results = second.filter((m) => m.role === 'tool').map((m) => String(m.content));
  assert.match(results[0], /Recusado pela validação/);
  assert.match(results[1], /Pulado/);
  assert.equal(r.state.effects.length, 0, 'a chamada pulada não trocou a vista');
  assert.equal(get(r.projectId).revisions.at(-1)!.params.modules[0].width, 900);
});

void test('laço: sem finish até o limite, responde o que fez sem inventar sucesso', async () => {
  const s = start('Faça algo');
  const { fake } = scripted([() => reply(call('state_read', {}))]);
  const r = await runAgentTurn({
    project: s.p,
    version: s.version,
    user: s.user,
    request: 'Faça algo',
    selected: [],
    ui: null,
    prices: structuredClone(DEFAULT_PRICES),
    model: 'deepseek',
    requestId: 'x',
    started: Date.now(),
    signal: new AbortController().signal,
    progress: () => {},
    emit: () => {},
    onUsage: () => {},
    usage: () => ({}),
    maxSteps: 3,
    call: fake as never,
  });
  const answer = get(r.projectId).messages.at(-1)!;
  assert.match(answer.content, /limite de etapas/);
  assert.equal(answer.result?.outcome, 'answered');
});

void test('laço: pergunta encerra o pedido sem versão nova', async () => {
  const s = start('Deixe com 2 metros');
  const { fake } = scripted([
    () =>
      reply(
        call('ask_user', {
          pergunta: '2 metros de quê?',
          opcoes: [{ rotulo: 'Largura' }, { rotulo: 'Altura' }, { rotulo: 'Profundidade' }],
        }),
      ),
  ]);
  const before = s.p.revisions.length;
  const r = await turn(s, fake, 'Deixe com 2 metros');
  const p = get(r.projectId);
  assert.equal(p.revisions.length, before);
  const answer = p.messages.at(-1)!;
  assert.equal(answer.result?.outcome, 'clarification');
  assert.equal(answer.clarification?.options.length, 3);
});

void test('laço: conferência devolve o problema de encaixe e só aceita com aviso depois de duas tentativas', async () => {
  const s = start('Parede de 50 cm');
  const moduleId = s.p.revisions[0].params.modules[0].id;
  const { fake, seen } = scripted([
    () => reply(call('room_set', { largura: 3000, altura: 2600 }), call('design_apply', { ops: [{ kind: 'module.edit', id: moduleId, width: 1200 }] })),
    () => reply(call('room_set', { largura: 900 })),
    () => reply(call('finish', { mensagem: 'Pronto.' })),
  ]);
  const r = await turn(s, fake, 'Parede de 50 cm');
  const tools = seen.slice(3).map((msgs) => JSON.stringify(msgs.at(-1)!.content));
  assert.ok(tools.some((t) => /Conferência antes de terminar/.test(t)), 'a IA recebeu o problema');
  const answer = get(r.projectId).messages.at(-1)!;
  assert.match(answer.content, /Atenção:/);
});

void test('laço: alternativa no meio do pedido continua no projeto novo e deixa aviso no original', async () => {
  const s = start('Faça uma alternativa em nogueira');
  const moduleId = s.p.revisions[0].params.modules[0].id;
  const { fake } = scripted([
    () => reply(call('project_fork', { nome: 'Estante nogueira' })),
    () => reply(call('design_apply', { ops: [{ kind: 'module.edit', id: moduleId, materialId: 'walnut' }] })),
    () => reply(call('finish', { mensagem: 'Criei a alternativa em nogueira.' })),
  ]);
  const r = await turn(s, fake, 'Faça uma alternativa em nogueira');
  assert.notEqual(r.projectId, s.p.id);
  const alt = get(r.projectId);
  assert.equal(alt.name, 'Estante nogueira');
  assert.equal(alt.revisions.at(-1)!.params.modules[0].materialId, 'walnut');
  assert.equal(alt.messages.at(-2)!.role, 'user');
  const original = get(s.p.id);
  assert.notEqual(original.revisions.at(-1)!.params.modules[0].materialId, 'walnut');
  assert.match(original.messages.at(-1)!.content, /Estante nogueira/);
});

void test('roteador: pedido só de tela sai direto, sem chamar o modelo', async () => {
  const s = start('mostra de frente e abre tudo');
  const { fake, seen } = scripted([() => reply(call('finish', { mensagem: 'não devia chamar' }))]);
  const r = await runAgentTurn({
    project: s.p,
    version: s.version,
    user: s.user,
    request: 'mostra de frente e abre tudo',
    selected: [],
    ui: null,
    prices: structuredClone(DEFAULT_PRICES),
    model: 'deepseek',
    requestId: 'd',
    started: Date.now(),
    signal: new AbortController().signal,
    progress: () => {},
    emit: () => {},
    onUsage: () => {},
    usage: () => ({}),
    call: fake as never,
    route: async () => ({ kind: 'direct', intent: 'view', actions: ['vista_frente', 'pdf'] }),
  });
  assert.equal(seen.length, 0);
  assert.deepEqual(r.state.effects.map((e) => e.type), ['camera', 'export']);
  const answer = get(r.projectId).messages.at(-1)!;
  assert.match(answer.content, /^Pronto: /);
  assert.equal(answer.report?.steps?.[0].tool, 'router');
});

void test('laço: queda passageira do provedor tenta a etapa de novo, sem perder o pedido', async () => {
  const s = start('Qual a largura?');
  let calls = 0;
  const fake = async () => {
    calls++;
    if (calls === 1) throw new Error('A conexão com a IA foi interrompida. Tente novamente.');
    return reply(call('finish', { mensagem: 'A estante tem 80 cm de largura.', sugestoes: [] }));
  };
  const r = await turn(s, fake as never, 'Qual a largura?');
  assert.equal(calls, 2);
  assert.equal(get(r.projectId).messages.at(-1)!.content, 'A estante tem 80 cm de largura.');
});

void test('opções: cada variante monta num rascunho à parte, o projeto não muda e a resposta leva o cartão', async () => {
  const s = start('Me dá duas opções');
  const moduleId = s.p.revisions[0].params.modules[0].id;
  const briefOf = (m: ChatMessage[]) => {
    const c = m[1].content;
    return typeof c === 'string' ? c : '';
  };
  let main = 0;
  const fake = async (o: { messages: ChatMessage[] }) => {
    const brief = briefOf(o.messages);
    // Sub-laço de uma opção: monta e termina na mesma resposta.
    if (brief.includes('Opção "Larga"'))
      return reply(call('design_apply', { ops: [{ kind: 'module.edit', id: moduleId, width: 1000 }] }), call('finish', { mensagem: 'Estante de 1 m.', sugestoes: [] }));
    if (brief.includes('Opção "Alta"'))
      return reply(call('design_apply', { ops: [{ kind: 'module.edit', id: moduleId, height: 2100 }] }), call('finish', { mensagem: 'Estante de 2,1 m de altura.', sugestoes: [] }));
    main++;
    return main === 1
      ? reply(call('options_make', { variantes: [{ nome: 'Larga', pedido: 'estante com 1 m de largura' }, { nome: 'Alta', pedido: 'estante com 2,1 m de altura' }] }))
      : reply(call('finish', { mensagem: 'Montei duas opções: a larga e a alta. Aplique pelo cartão.', sugestoes: [] }));
  };
  const r = await turn(s, fake as never, 'Me dá duas opções');
  const p = get(r.projectId);
  assert.equal(p.revisions.length, 1, 'opções não gravam versão');
  const cards = p.messages.at(-1)!.options!;
  assert.deepEqual(cards.map((c) => c.name), ['Larga', 'Alta']);
  assert.equal((cards[0].params as { modules: { width: number }[] }).modules[0].width, 1000);
  assert.ok(cards[0].total > 0 && cards[0].sheets > 0);
  assert.notEqual(cards[0].total, cards[1].total);
});

void test('laço: passou do tempo, a única chamada é o finish, que conta o que ficou', async () => {
  const s = start('Monte uma cozinha');
  const ctx = new AgentContext(s.p, s.version, structuredClone(DEFAULT_PRICES), 'Monte uma cozinha', [], null);
  const seen: string[][] = [];
  const fake = async (o: { tools: { function: { name: string } }[] }) => {
    seen.push(o.tools.map((t) => t.function.name));
    return reply(call('finish', { mensagem: 'Não deu tempo de montar a cozinha.', sugestoes: [] }));
  };
  const r = await runLoop(ctx, { model: 'deepseek', system: 's', user: { role: 'user', content: 'u' }, maxMs: 0, call: fake as never });
  assert.equal(r.exhausted, true);
  assert.deepEqual(seen, [['finish']]);
  assert.equal(ctx.finish?.message, 'Não deu tempo de montar a cozinha.');
});
