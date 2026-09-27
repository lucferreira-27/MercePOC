import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create, get, revise, save, undo, type Message } from '../lib/store';
import { DEFAULT_PRICES } from '../lib/quote';
import { runAgentTurn, type TurnDiagnostics } from '../lib/agent/turn';
import { normalize, type Design } from '../lib/studio';
import { fitReport, tvPlacements, type Room } from '../lib/room';
import { designFacts, factClaims } from '../lib/agent/facts';
import type { ChatMessage, ModelReply, ToolCall } from '../lib/agent/model';
import { openTrace, type Trace } from '../lib/trace';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-lifecycle-'));
process.env.MERCE_JEV = '0';

let n = 0;
const call = (name: string, args: unknown): ToolCall => ({ id: `c${++n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = (...calls: ToolCall[]): ModelReply => ({ content: '', calls, finish: 'tool_calls' });
function scripted(steps: ((seen: ChatMessage[]) => ModelReply)[]) {
  const seen: ChatMessage[][] = [];
  let i = 0;
  const fake = async (o: { messages: ChatMessage[] }) => {
    seen.push(structuredClone(o.messages));
    return steps[Math.min(i++, steps.length - 1)](o.messages);
  };
  return { fake, seen };
}
const scene = (name: string) => JSON.parse(readFileSync(`bench/scenes/${name}.json`, 'utf8')) as { design: Design; room: Room };

/** Projeto com a cena (ou o padrão) e o pedido já gravado, como a rota deixa. */
function start(request: string, from?: string) {
  const p = get(create().id);
  if (from) {
    const s = scene(from);
    p.room = s.room;
    revise(p, normalize(s.design), 'cena');
    save(p, p.version);
  }
  const q = get(p.id);
  const user: Message = {
    id: `u${++n}`,
    role: 'user',
    content: request,
    revisionId: q.revisions[q.cursor].id,
    revision: q.cursor + 1,
    context: { requestId: `r${n}`, baseRevisionId: q.revisions[q.cursor].id, selectedPartIds: [], referencedPartIds: [] },
  };
  q.messages.push(user);
  const version = save(q, q.version).version;
  return { p: q, user, version };
}
function turn(s: ReturnType<typeof start>, fake: unknown, extra: { maxSteps?: number; signal?: AbortSignal; trace?: Trace } = {}) {
  return runAgentTurn({
    project: s.p,
    version: s.version,
    user: s.user,
    request: s.user.content,
    selected: [],
    ui: null,
    prices: structuredClone(DEFAULT_PRICES),
    model: 'luna',
    requestId: s.user.context!.requestId,
    started: Date.now(),
    signal: extra.signal ?? new AbortController().signal,
    progress: () => {},
    emit: () => {},
    onUsage: () => {},
    usage: () => ({}),
    maxSteps: extra.maxSteps,
    call: fake as never,
    trace: extra.trace,
  });
}
/** Linhas do registro do pedido, já lidas como objetos. */
const events = (trace: Trace) => readFileSync(trace.file!, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown> & { event: string });

void test('tempo acabou com o rascunho válido: fica como parcial e a resposta conta o que ficou gravado', async () => {
  const s = start('Adicione mais móveis', 'lavanderia-2');
  const { fake } = scripted([
    () => reply(call('design_apply', { ops: [{ kind: 'module.add', id: 'bal', preset: 'drawers', name: 'Balcão' }, { kind: 'module.edit', id: 'bal', position: [-700, 0, -25] }] })),
    () => reply(call('state_read', {})),
    // A última chamada (só finish) volta sem nada: a resposta sai do estado.
    () => ({ content: '', calls: [], finish: 'stop' }),
  ]);
  const r = await turn(s, fake, { maxSteps: 2 });
  const p = get(r.projectId);
  const answer = p.messages.at(-1)!;
  assert.equal(p.revisions.length, 3, 'o rascunho válido virou versão');
  assert.equal(answer.report?.completion, 'partial');
  assert.doesNotMatch(answer.content, /não mudou/, 'antes a resposta dizia "O móvel não mudou" depois de gravar');
  assert.match(answer.content, /Ficou gravado: .*Balcão/);
});

void test('tempo acabou com o rascunho que não cabe: volta ao começo, a resposta diz, nada vira versão', async () => {
  const s = start('Adicione mais móveis', 'lavanderia-2');
  const { fake, seen } = scripted([
    // Um balcão que passa da parede de 3,2 m.
    () => reply(call('design_apply', { ops: [{ kind: 'module.add', id: 'bal', preset: 'drawers', name: 'Balcão' }, { kind: 'module.edit', id: 'bal', width: 1200, position: [2400, 0, -25] }] })),
    () => reply(call('state_read', {})),
    () => ({ content: '', calls: [], finish: 'stop' }),
  ]);
  const r = await turn(s, fake, { maxSteps: 2 });
  const p = get(r.projectId);
  const answer = p.messages.at(-1)!;
  assert.equal(p.revisions.length, 2, 'rascunho inválido não é gravado como sucesso');
  assert.equal(answer.report?.completion, 'rolled-back');
  assert.match(answer.content, /descartei/);
  assert.equal(answer.result?.appliedOperations.length, 0);
  // A última chamada soube do descarte antes de responder.
  assert.match(JSON.stringify(seen.at(-1)!.at(-1)!.content), /descartou/);
});

void test('rascunho descartado no meio não entra no registro das operações gravadas', async () => {
  const s = start('Adicione um apoio', 'cozinha-apoio');
  const { fake } = scripted([
    () => reply(call('design_apply', { ops: [{ kind: 'module.add', id: 'apoio-a', preset: 'niche', name: 'Apoio A' }, { kind: 'module.edit', id: 'apoio-a', position: [4000, 0, -75] }] })),
    () => reply(call('history_undo', {})),
    () => reply(call('design_apply', { ops: [{ kind: 'module.add', id: 'apoio-b', preset: 'drawers', name: 'Apoio B' }, { kind: 'module.edit', id: 'apoio-b', position: [3700, 0, -75] }] })),
    () => reply(call('finish', { mensagem: 'Pus um apoio com gavetas à direita.', sugestoes: [] })),
  ]);
  const r = await turn(s, fake);
  const p = get(r.projectId);
  const answer = p.messages.at(-1)!;
  const ids = answer.result!.appliedOperations.map((o) => ('id' in o ? o.id : ''));
  assert.ok(!ids.includes('apoio-a'), 'o apoio descartado ficou no registro');
  assert.ok(ids.includes('apoio-b'));
  assert.equal(answer.report?.reverted, 2);
  assert.ok(!p.revisions.at(-1)!.params.modules.some((m) => m.id === 'apoio-a'));
  // Um Ctrl+Z volta à cozinha de partida.
  const before = p.revisions.at(-2)!.params;
  undo(p);
  assert.deepEqual(p.revisions[p.cursor].params.modules.map((m) => m.id), before.modules.map((m) => m.id));
});

void test('pedido interrompido: nada gravado, o projeto em memória volta e o erro leva o diagnóstico', async () => {
  const s = start('Adicione mais móveis', 'lavanderia-2');
  const stop = new AbortController();
  const fake = async (o: { messages: ChatMessage[] }) => {
    if (o.messages.length > 2) {
      stop.abort();
      throw new Error('This operation was aborted');
    }
    return reply(call('design_apply', { ops: [{ kind: 'module.add', id: 'bal', preset: 'drawers', name: 'Balcão' }, { kind: 'module.edit', id: 'bal', position: [-1000, 0, -25] }] }));
  };
  const revisions = s.p.revisions.length;
  await assert.rejects(turn(s, fake, { signal: stop.signal }), (e: Error & { diagnostics?: TurnDiagnostics }) => {
    const d = e.diagnostics!;
    assert.equal(d.cause, 'cancelled');
    assert.equal(d.committed, 'none');
    assert.equal(d.requestId, s.user.context!.requestId);
    assert.equal(d.draftChanged, true);
    assert.deepEqual(d.steps.map((v) => v.tool), ['design_apply']);
    return true;
  });
  assert.equal(s.p.revisions.length, revisions, 'nada gravado');
});

void test('resposta só em texto não pula a conferência: o problema novo vai na resposta', async () => {
  const s = start('Balcão à direita', 'lavanderia-2');
  const { fake } = scripted([
    () => reply(call('design_apply', { ops: [{ kind: 'module.add', id: 'bal', preset: 'drawers', name: 'Balcão' }, { kind: 'module.edit', id: 'bal', width: 1200, position: [2400, 0, -25] }] })),
    () => ({ content: 'Pronto, pus o balcão.', calls: [], finish: 'stop' }),
  ]);
  const r = await turn(s, fake);
  const answer = get(r.projectId).messages.at(-1)!;
  assert.match(answer.content, /^Pronto, pus o balcão\.\n\nAtenção: Ambiente: /);
  assert.ok(answer.report?.checks?.issues.length);
});

void test('números da resposta contra o estado final: espessura que não sobrou volta para corrigir', async () => {
  const s = start('Reduza as chapas', 'painel-criativo');
  const ids = ['p', 'nicho-destaque', 'prateleira-destaque', 'nicho-complementar'];
  const { fake, seen } = scripted([
    () =>
      reply(
        call('design_apply', {
          ops: [
            ...ids.map((id) => ({ kind: 'module.edit', id, materialId: 'walnut' })),
            { kind: 'module.edit', id: 'p', depth: 18 },
            { kind: 'module.edit', id: 'prateleira-destaque', depth: 18 },
          ],
        }),
      ),
    () => reply(call('finish', { mensagem: 'Unifiquei em nogueira; o plano ainda usa chapas de 25 mm e 18 mm.', sugestoes: [] })),
    () => reply(call('finish', { mensagem: 'Tudo em nogueira 18 mm: agora são 2 chapas.', sugestoes: [] })),
  ]);
  const r = await turn(s, fake);
  const repair = JSON.stringify(seen[2].at(-1)!.content);
  assert.match(repair, /chapa de 25 mm, mas o plano final só tem 18 mm/);
  assert.match(repair, /2 chapas \(Nogueira 18 mm: 2\)/);
  const answer = get(r.projectId).messages.at(-1)!;
  assert.equal(answer.content, 'Tudo em nogueira 18 mm: agora são 2 chapas.');
  assert.deepEqual(answer.report?.facts?.find((f) => f.label === 'Chapas'), { label: 'Chapas', before: '3', after: '2' });
  // O resultado da mudança já mostrava o plano novo.
  assert.match(JSON.stringify(seen[1].at(-1)!.content), /Plano de corte agora: 2 chapas/);
});

void test('fatos: afirmações que batem passam; contagem e total errados não', () => {
  const s = scene('painel-criativo');
  const d = normalize(s.design);
  const f = designFacts(d, DEFAULT_PRICES);
  assert.deepEqual(factClaims('Continua com 3 chapas.', f, f), []);
  assert.equal(factClaims('Agora são 5 chapas.', f, f).length, 1);
  assert.equal(factClaims('Total de R$ 1,00.', f, f).length, 1);
  assert.deepEqual(factClaims('Troquei as chapas de 30 mm por 18 mm.', f, f), [], 'número de antes, em frase de troca');
});

void test('TV: painel atrás é permitido; nicho na frente da tela ou encostado nela é problema, por módulo', () => {
  const tv = scene('painel-tv');
  const base = normalize(tv.design);
  assert.deepEqual(fitReport(base, tv.room).issues, [], 'o painel que segura a TV não tapa');
  const [placed] = tvPlacements(base, tv.room);
  assert.equal(placed.mountZ, 12.5, 'a TV encosta na frente do painel');
  const saved = normalize(scene('painel-criativo').design);
  const issues = fitReport(saved, tv.room).issues;
  assert.deepEqual(issues.map((i) => i.key), ['tv-blocked:ob-tv:nicho-destaque'], 'o resultado gravado tapava a TV');
  assert.match(issues[0].message, /na frente da TV/);
});

void test('parede presa: nicho novo à esquerda do painel não leva a TV junto', async () => {
  const s = start('Nicho à esquerda do painel', 'painel-tv');
  const before = tvPlacements(s.p.revisions[s.p.cursor].params, s.p.room!)[0].rect;
  const { fake } = scripted([
    () => reply(call('design_apply', { ops: [{ kind: 'module.add', id: 'n', preset: 'niche', name: 'Nicho' }, { kind: 'module.edit', id: 'n', width: 400, depth: 300, wall: true, position: [-1400, 900, 137.5] }] })),
    () => reply(call('finish', { mensagem: 'Pus um nicho à esquerda do painel.', sugestoes: [] })),
  ]);
  const r = await turn(s, fake);
  const p = get(r.projectId);
  const after = tvPlacements(p.revisions[p.cursor].params, p.room!)[0].rect;
  assert.deepEqual(after, before, 'a TV ficou no mesmo lugar do mundo');
  assert.ok(p.room!.anchor, 'a parede ficou presa');
  undo(p);
  assert.equal(p.room!.anchor, undefined, 'Ctrl+Z volta o ambiente também');
});

void test('rota: pedido interrompido no meio grava a falha com pedido, etapas, causa e nada gravado', async () => {
  process.env.AI_API_KEY ||= 'test-key';
  const { POST } = await import('../app/api/chat/route');
  const p = get(create().id);
  const moduleId = p.revisions[0].params.modules[0].id;
  const stop = new AbortController();
  const sse = (payload: unknown) =>
    new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1)
      return sse({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: 'c1', function: { name: 'design_apply', arguments: JSON.stringify({ ops: [{ kind: 'module.edit', id: moduleId, width: 900 }] }) } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });
    // A pessoa apertou Parar no meio da segunda chamada.
    stop.abort();
    throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  }) as typeof fetch;
  try {
    const res = await POST(
      new Request('http://127.0.0.1:4310/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, version: p.version, message: 'Deixe com 90 cm e ponha portas', agent: true, requestId: 'pedido-interrompido' }),
        signal: stop.signal,
      }),
    );
    assert.equal(res.status, 400);
  } finally {
    globalThis.fetch = original;
  }
  const after = get(p.id);
  assert.equal(after.revisions.length, 1, 'nada gravado');
  const failed = after.messages.at(-1)!;
  assert.ok(failed.error);
  assert.equal(failed.context?.requestId, 'pedido-interrompido');
  assert.equal(failed.report?.failure?.cause, 'cancelled');
  assert.equal(failed.report?.failure?.committed, 'none');
  assert.equal(failed.report?.failure?.draftOperations, 1);
  assert.deepEqual(failed.report?.steps?.map((v) => v.tool), ['design_apply']);
});

void test('evidência velha: "conferi o desenho" depois de mudar o móvel volta para corrigir; desenho não é mostrado à pessoa', async () => {
  const s = start('Nicho à direita', 'painel-tv');
  const { fake, seen } = scripted([
    () => reply(call('render_look', {})),
    () => reply(call('place', { pecas: [{ ref: 'n', nome: 'Nicho', tipo: 'nicho', onde: { de: 'tv', lado: 'direita' } }] })),
    () => reply(call('finish', { mensagem: 'Pus um nicho à direita da TV e conferi o desenho; o desenho foi exibido para você.', sugestoes: [] })),
    () => reply(call('finish', { mensagem: 'Pus um nicho à direita da TV.', sugestoes: [] })),
  ]);
  const r = await turn(s, fake);
  const repair = JSON.stringify(seen[3].at(-1)!.content);
  assert.match(repair, /mudou depois do último render_look/);
  assert.match(repair, /vai só para você/);
  const answer = get(r.projectId).messages.at(-1)!;
  assert.equal(answer.content, 'Pus um nicho à direita da TV.');
  assert.deepEqual(answer.report?.evidence, { look: 'stale' });
});

void test('mudança afirmada: "mudei a vista" não é mudar o móvel; "coloquei um nicho" sem nicho é', async () => {
  const s = start('Mostra de frente', 'painel-tv');
  const { fake, seen } = scripted([
    () => reply(call('view_camera', { vista: 'front' }), call('finish', { mensagem: 'Mudei a vista para a frente.', sugestoes: [] })),
  ]);
  await turn(s, fake);
  assert.equal(seen.length, 1, 'sem reparo para frase de vista');
  const t = start('Nicho à direita', 'painel-tv');
  const { fake: f2, seen: s2 } = scripted([
    () => reply(call('finish', { mensagem: 'Coloquei um nicho à direita da TV.', sugestoes: [] })),
    () => reply(call('finish', { mensagem: 'Não coloquei o nicho: nada foi montado.', sugestoes: [] })),
  ]);
  await turn(t, f2);
  assert.match(JSON.stringify(s2[1].at(-1)!.content), /nada mudou neste pedido/);
});

void test('desfazer no meio do pedido volta só a última mudança; tudo: true descarta o pedido inteiro', async () => {
  const s = start('Adicione um apoio', 'cozinha-apoio');
  const { fake } = scripted([
    () => reply(call('design_apply', { ops: [{ kind: 'module.add', id: 'apoio-a', preset: 'niche', name: 'Apoio A' }, { kind: 'module.edit', id: 'apoio-a', position: [4000, 0, -75] }] })),
    () => reply(call('design_apply', { ops: [{ kind: 'module.edit', id: 'apoio-a', name: 'Apoio largo' }] })),
    () => reply(call('history_undo', {})),
    () => reply(call('finish', { mensagem: 'Pus o Apoio A à direita.', sugestoes: [] })),
  ]);
  const r = await turn(s, fake);
  const kept = get(r.projectId).revisions.at(-1)!.params.modules.find((m) => m.id === 'apoio-a');
  assert.equal(kept?.name, 'Apoio A', 'o desfazer levou junto a mudança anterior, que era boa');
  assert.equal(get(r.projectId).messages.at(-1)!.report?.reverted, 1);

  const all = start('Adicione um apoio', 'cozinha-apoio');
  const { fake: fake2 } = scripted([
    () => reply(call('design_apply', { ops: [{ kind: 'module.add', id: 'apoio-a', preset: 'niche', name: 'Apoio A' }, { kind: 'module.edit', id: 'apoio-a', position: [4000, 0, -75] }] })),
    () => reply(call('design_apply', { ops: [{ kind: 'module.edit', id: 'apoio-a', name: 'Apoio largo' }] })),
    () => reply(call('history_undo', { tudo: true })),
    () => reply(call('finish', { mensagem: 'Deixei como estava.', sugestoes: [] })),
  ]);
  const r2 = await turn(all, fake2);
  assert.ok(!get(r2.projectId).revisions.at(-1)!.params.modules.some((m) => m.id === 'apoio-a'));
});

void test('registro do pedido guarda raciocínio, argumentos, resultado inteiro, rascunho e o fim', async () => {
  const s = start('Adicione um apoio', 'cozinha-apoio');
  const trace = openTrace(s.user.context!.requestId);
  const { fake } = scripted([
    () => ({ ...reply(call('design_apply', { ops: [{ kind: 'module.add', id: 'apoio-a', preset: 'niche', name: 'Apoio A' }, { kind: 'module.edit', id: 'apoio-a', position: [4000, 0, -75] }] })), reasoning: 'Vou pôr o apoio à direita da bancada.' }),
    () => reply(call('finish', { mensagem: 'Pus um apoio à direita.', sugestoes: [] })),
  ]);
  await turn(s, fake, { trace });
  const log = events(trace);
  const kinds = log.map((e) => e.event);
  for (const k of ['trace.open', 'turn.state', 'turn.route', 'loop.start', 'model.call', 'model.reply', 'tool.result', 'draft', 'turn.done'])
    assert.ok(kinds.includes(k), `faltou ${k} no registro`);
  const first = log.find((e) => e.event === 'model.reply')!;
  assert.equal(first.reasoning, 'Vou pôr o apoio à direita da bancada.');
  assert.match(String((first.calls as { arguments: string }[])[0].arguments), /apoio-a/);
  const applied = log.find((e) => e.event === 'tool.result' && e.tool === 'design_apply')!;
  assert.equal(applied.ok, true);
  assert.ok(String(applied.result).length > 0);
  // A segunda chamada leva só as mensagens novas: a resposta e o resultado da ferramenta.
  const second = log.filter((e) => e.event === 'model.call')[1];
  assert.deepEqual((second.added as ChatMessage[]).map((m) => m.role), ['assistant', 'tool']);
  const done = log.find((e) => e.event === 'turn.done')!;
  assert.equal(done.outcome, 'applied');
});

void test('registro do pedido interrompido diz a causa e guarda o rascunho de quando parou', async () => {
  const s = start('Adicione mais móveis', 'lavanderia-2');
  const trace = openTrace(s.user.context!.requestId);
  const stop = new AbortController();
  const fake = async (o: { messages: ChatMessage[] }) => {
    if (o.messages.length > 2) {
      stop.abort();
      throw new Error('This operation was aborted');
    }
    return reply(call('state_read', {}));
  };
  await assert.rejects(turn(s, fake, { signal: stop.signal, trace }));
  const failed = events(trace).find((e) => e.event === 'turn.failed')!;
  assert.equal((failed.diagnostics as TurnDiagnostics).cause, 'cancelled');
  assert.ok((failed.draft as { design: Design }).design.modules.length > 0);
  const error = events(trace).find((e) => e.event === 'model.error')!;
  assert.equal(error.requestAborted, true);
});
