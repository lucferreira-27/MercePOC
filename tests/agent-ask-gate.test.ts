import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create, get, save, type Message } from '../lib/store';
import { DEFAULT_PRICES } from '../lib/quote';
import { runAgentTurn } from '../lib/agent/turn';
import { askVerdict, blockText, kindVerdict, missingShelf, type AskKind } from '../lib/agent/ask-gate';
import type { JevAnswer } from '../lib/agent/jev';
import type { ChatMessage, ModelReply, ToolCall } from '../lib/agent/model';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-askgate-'));
process.env.TYPESAFE_API_KEY = 'teste';
delete process.env.MERCE_JEV;
delete process.env.MERCE_ASK_GATE;

const kind = (choice: AskKind): Record<string, JevAnswer> => ({ especie: { type: 'choice', choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } });
const req = (vague: number, alvo = 0): Record<string, JevAnswer> => ({ vague: { type: 'noul', noul: vague }, alvo_vago: { type: 'noul', noul: alvo } });
const facts = (pedido: string, selected = false, shelves = 4) => ({ pedido, selected, shelves });

void test('portão: limite, valor, preferência e ambiente têm padrão; a pergunta volta para a IA fazer', () => {
  for (const k of ['limite', 'valor', 'preferencia', 'ambiente'] as const) {
    const v = kindVerdict(kind(k), req(0), facts('Quero uma estante de 10 mm de altura.'));
    assert.equal(v.legit, false, k);
    assert.match(blockText(v), /^Não pergunte: /);
  }
  assert.match(blockText(kindVerdict(kind('limite'), req(0), facts('x'))), /faça no limite/);
});

void test('portão: eixo só vale com medida sem eixo no pedido', () => {
  assert.equal(kindVerdict(kind('eixo'), req(0.9), facts('aumente 10 cm')).legit, true);
  assert.equal(kindVerdict(kind('eixo'), req(0.9), facts('Aumente a largura para 2,40 m.')).legit, false, 'o pedido diz o eixo');
  assert.equal(kindVerdict(kind('eixo'), req(0.4), facts('aumente 10 cm')).legit, false, 'o Jev não viu medida sem eixo');
});

void test('portão: peça só vale sem seleção e com alvo vago, ou quando a peça citada sumiu', () => {
  assert.equal(kindVerdict(kind('peca'), req(0, 0.9), facts('mova a outra prateleira 5 cm para cima')).legit, true);
  assert.equal(kindVerdict(kind('peca'), req(0, 0.9), facts('divida em duas colunas', true)).legit, false, 'a seleção diz a peça');
  assert.equal(kindVerdict(kind('peca'), req(0, 0.1), facts('Coloque um nicho em cima deste módulo.')).legit, false);
  // Prateleira 4 num projeto com três: vale qualquer pergunta, até de preferência.
  assert.ok(missingShelf('Suba a prateleira 4 mais 5 cm.', 3));
  assert.ok(!missingShelf('Suba a prateleira 3 mais 5 cm.', 3));
  assert.equal(kindVerdict(kind('preferencia'), req(0), facts('Suba a prateleira 4 mais 5 cm.', false, 3)).legit, true);
});

void test('portão: espécie incerta e Jev fora deixam a pergunta seguir', async () => {
  assert.equal(kindVerdict(kind('outro'), req(0), facts('x')).legit, true);
  assert.equal(await askVerdict('Qual altura?', facts('x'), async () => null), null);
});

// ---------------------------------------------------------------- no laço
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
/** Jev de mentira: só responde ao portão (espécie da pergunta e o pedido); o resto fica sem Jev. */
function fakeJev(k: AskKind, vague = 0) {
  const real = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (!String(url).includes('typesafe.ai')) return real(url as string, init);
    const q = Object.keys(JSON.parse((init?.body as string | undefined) ?? '{}').questions ?? {});
    if (q.includes('especie')) {
      asked++;
      return Response.json({ answers: kind(k) });
    }
    if (q.includes('alvo_vago')) return Response.json({ answers: req(vague) });
    return new Response('fora do teste', { status: 503 });
  }) as typeof fetch;
  return { restore: () => (globalThis.fetch = real), asked: () => asked };
}
function turn(request: string, fake: ReturnType<typeof scripted>['fake']) {
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
  return runAgentTurn({
    project: p,
    version,
    user,
    request,
    selected: [],
    ui: null,
    prices: structuredClone(DEFAULT_PRICES),
    model: 'deepseek',
    requestId: `r${n}`,
    started: Date.now(),
    signal: new AbortController().signal,
    progress: () => {},
    emit: () => {},
    onUsage: () => {},
    usage: () => ({}),
    call: fake as never,
  });
}
const ask = (pergunta: string) => call('ask_user', { pergunta, opcoes: [{ rotulo: 'Sim' }, { rotulo: 'Não' }] });

void test('laço: pergunta com padrão volta para a IA, que faz e responde', async () => {
  const jev = fakeJev('valor');
  try {
    const { fake, seen } = scripted([
      () => reply(ask('Qual altura devo usar para o nicho?')),
      () => reply(call('finish', { mensagem: 'Pus o nicho com a altura do módulo atual.' })),
    ]);
    const r = await turn('Coloque um nicho em cima deste módulo.', fake);
    const back = seen[1].at(-1)!.content as string;
    assert.match(back, /Não pergunte: use a medida do módulo atual/);
    const answer = get(r.projectId).messages.at(-1)!;
    assert.notEqual(answer.result?.outcome, 'clarification');
    assert.deepEqual(answer.report?.steps?.map((s) => [s.tool, s.ok]), [['ask_user', false], ['finish', true]]);
  } finally {
    jev.restore();
  }
});

void test('laço: se a IA insiste, a segunda pergunta segue sem passar pelo Jev', async () => {
  const jev = fakeJev('preferencia');
  try {
    const { fake } = scripted([() => reply(ask('Prefere portas ou gavetas?')), () => reply(ask('Prefere portas ou gavetas? Preciso saber.'))]);
    const r = await turn('Coloque frentes neste nicho.', fake);
    assert.equal(get(r.projectId).messages.at(-1)!.result?.outcome, 'clarification');
    assert.equal(jev.asked(), 1, 'o portão confere uma vez por pedido');
  } finally {
    jev.restore();
  }
});

void test('laço: pergunta de eixo em pedido sem eixo segue direto', async () => {
  const jev = fakeJev('eixo', 0.9);
  try {
    const { fake } = scripted([() => reply(ask('Aumentar 10 cm em qual medida?'))]);
    const r = await turn('aumente 10 cm', fake);
    assert.equal(get(r.projectId).messages.at(-1)!.result?.outcome, 'clarification');
  } finally {
    jev.restore();
  }
});

void test('laço: MERCE_ASK_GATE=0 desliga o portão', async () => {
  const jev = fakeJev('valor');
  process.env.MERCE_ASK_GATE = '0';
  try {
    const { fake } = scripted([() => reply(ask('Qual altura devo usar para o nicho?'))]);
    const r = await turn('Coloque um nicho em cima deste módulo.', fake);
    assert.equal(get(r.projectId).messages.at(-1)!.result?.outcome, 'clarification');
    assert.equal(jev.asked(), 0);
  } finally {
    delete process.env.MERCE_ASK_GATE;
    jev.restore();
  }
});
