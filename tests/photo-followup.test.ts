import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create, get, save, type Message } from '../lib/store';
import { DEFAULT_PRICES } from '../lib/quote';
import { saveImage } from '../lib/images';
import { runAgentTurn } from '../lib/agent/turn';
import { reviewAndCorrect } from '../lib/gateway';
import { executeRequest } from '../lib/studio';
import type { ChatMessage, ModelReply } from '../lib/agent/model';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-photo-'));
process.env.MERCE_JEV = '0';
process.env.MERCE_DEFAULT_MODEL ??= 'luna';
process.env.AI_API_KEY ??= 'teste';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const VERDICT = 'Tem cinco colunas e gavetas no centro; a referência tem quatro colunas de portas contínuas.';

let n = 0;
const msg = (role: Message['role'], content: string, extra: Partial<Message> = {}): Message => ({ id: `m${++n}`, role, content, ...extra });

/** Conversa como a do defeito: foto, resposta com conferência, e N trocas depois dela. */
async function conversation(between: number) {
  const p = get(create().id);
  const image = await saveImage(PNG, 'guarda-roupa.png');
  p.messages.push(msg('user', 'Use esta imagem como referência para a estante.', { image }));
  p.messages.push(
    msg('assistant', 'Montei o guarda-roupa.', {
      result: { outcome: 'applied', resultRevisionId: p.revisions[p.cursor].id, appliedOperations: [], changes: [] },
      report: { durationMs: 1, outcome: 'applied', changes: [], review: { fidelity: 'parcial', verdict: VERDICT, corrections: 0 } },
    }),
  );
  for (let i = 0; i < between; i++) p.messages.push(msg(i % 2 ? 'assistant' : 'user', `troca ${i}`));
  const rev = p.revisions[p.cursor];
  const user = msg('user', 'Esses aqui estão errados, não estão na imagem ref', {
    revisionId: rev.id,
    revision: rev.number,
    context: { requestId: `r${n}`, baseRevisionId: rev.id, selectedPartIds: [], referencedPartIds: [] },
  });
  p.messages.push(user);
  return { p, user, version: save(p, p.version).version };
}

/** Roda o pedido com um modelo que só termina e devolve a primeira mensagem que ele recebeu. */
async function firstPrompt(s: Awaited<ReturnType<typeof conversation>>) {
  const seen: ChatMessage[][] = [];
  const fake = async (o: { messages: ChatMessage[] }): Promise<ModelReply> => {
    seen.push(structuredClone(o.messages));
    return { content: '', calls: [{ id: `c${++n}`, type: 'function', function: { name: 'finish', arguments: JSON.stringify({ mensagem: 'Nada a mudar.' }) } }], finish: 'tool_calls' };
  };
  await runAgentTurn({
    project: s.p,
    version: s.version,
    user: s.user,
    request: s.user.content,
    selected: [],
    ui: null,
    prices: structuredClone(DEFAULT_PRICES),
    model: 'deepseek',
    requestId: s.user.context!.requestId,
    started: Date.now(),
    signal: new AbortController().signal,
    progress: () => {},
    emit: () => {},
    onUsage: () => {},
    usage: () => ({}),
    call: fake as never,
  });
  return seen[0].find((m) => m.role === 'user')!;
}

void test('foto: o pedido seguinte recebe a foto da conversa recente e a conferência dela', async () => {
  const user = await firstPrompt(await conversation(0));
  assert.ok(Array.isArray(user.content), 'a mensagem leva imagem');
  const parts = user.content as Exclude<ChatMessage['content'], string | null>;
  const images = parts.filter((v) => v.type === 'image_url');
  assert.equal(images.length, 1, 'só a foto: o desenho atual vem por render_look');
  assert.match((images[0] as { image_url: { url: string } }).image_url.url, /^data:image\/webp;base64,/);
  const text = (parts.find((v) => v.type === 'text') as { text: string }).text;
  assert.match(text, /foto de referência que a pessoa mandou num pedido anterior/);
  assert.match(text, /"foto_de_referencia":true/);
  assert.match(text, /quatro colunas de portas contínuas/, 'o veredito da conferência entra na conversa');
});

void test('foto: fora da conversa recente ela não volta', async () => {
  const user = await firstPrompt(await conversation(8));
  assert.equal(typeof user.content, 'string');
  assert.doesNotMatch(user.content as string, /foto de referência que a pessoa mandou/);
});

/** Provedor falso da conferência: cada chamada devolve o próximo JSON e guarda o corpo. */
function stubReview(replies: unknown[]) {
  const bodies: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    bodies.push(init.body);
    const content = JSON.stringify(replies[Math.min(bodies.length - 1, replies.length - 1)]);
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { bodies, restore: () => (globalThis.fetch = original) };
}
const reviewParams = (design: ReturnType<typeof get>['revisions'][number]['params']) => ({
  photo: 'data:image/webp;base64,AA',
  result: 'data:image/webp;base64,AA',
  design,
  applied: [],
  request: 'copie a foto',
  model: 'deepseek' as const,
});

void test('conferência: correção recusada volta com o erro e a segunda entra', async () => {
  const design = get(create().id).revisions[0].params;
  const id = design.modules[0].id;
  const stub = stubReview([
    { fidelity: 'parcial', verdict: VERDICT, ops: [{ kind: 'module.edit', id: 'nao-existe', width: 900 }] },
    { fidelity: 'parcial', verdict: 'outro', ops: [{ kind: 'module.edit', id, width: 900 }] },
  ]);
  try {
    const r = await reviewAndCorrect(reviewParams(design), executeRequest);
    assert.equal(stub.bodies.length, 2);
    assert.match(stub.bodies[1], /recusada pela validação/);
    assert.equal(r?.review.corrections, 1);
    assert.equal(r?.review.verdict, VERDICT, 'o veredito é o da primeira leitura');
    assert.equal(r?.review.rejected, undefined);
    assert.equal(r?.design.modules[0].width, 900);
  } finally {
    stub.restore();
  }
});

void test('conferência: recusada duas vezes, o motivo fica no relatório e nada muda', async () => {
  const design = get(create().id).revisions[0].params;
  const stub = stubReview([{ fidelity: 'diferente', verdict: VERDICT, ops: [{ kind: 'module.edit', id: 'nao-existe', width: 900 }] }]);
  try {
    const r = await reviewAndCorrect(reviewParams(design), executeRequest);
    assert.equal(stub.bodies.length, 2, 'uma tentativa a mais, não um laço');
    assert.equal(r?.review.corrections, 0);
    assert.ok(r?.review.rejected);
    assert.deepEqual(r?.ops, []);
    assert.deepEqual(r?.design, design);
  } finally {
    stub.restore();
  }
});
