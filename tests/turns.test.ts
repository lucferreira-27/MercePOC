import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEvents } from '../lib/sse';
import { defaults } from '../lib/furniture';
import { migrateParams, gapsOf } from '../lib/studio';
import { create, get, save, view } from '../lib/store';
import { POST } from '../app/api/chat/route';
// Estes testes cobrem o caminho antigo (uma resposta JSON); o laço tem os seus.
process.env.MERCE_AGENT = '0';
/**
 * O pedido em JSON vem depois do estado do turno na mensagem do usuário (o
 * bloco fixo de regras fica sozinho no início, para o cache do provedor).
 */
function requestOf(content: string) {
  const marker = 'Pedido deste turno (JSON): ';
  return content.slice(content.indexOf(marker) + marker.length);
}

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-turns-'));
process.env.MERCE_DEFAULT_MODEL ??= 'luna';
process.env.AI_API_KEY = 'test-key';

function response(payload: unknown) {
  const body =
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'PRIVATE', tool_calls: [{ index: 0, function: { name: 'submit_design_decision', arguments: JSON.stringify(payload) } }] } }] })}\n\ndata: [DONE]\n\n`;
  const bytes = new TextEncoder().encode(body);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 5) c.enqueue(bytes.slice(i, i + 5));
        c.close();
      },
    }),
  );
}
const request = (
  id: string,
  body: Record<string, unknown>,
  version = 0,
  stream = true,
) =>
  new Request('http://127.0.0.1:4310/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(stream ? { Accept: 'text/event-stream' } : {}),
    },
    body: JSON.stringify({ id, version, ...body }),
  });

const base = migrateParams(defaults);

void test('duas operações válidas viram uma revisão e um desfazer reverte tudo', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    response({
      action: 'update',
      approach: 'Ampliar a largura e subir a Prateleira 2.',
      message: 'Complemento.',
      ops: [
        { kind: 'resize', width: 1000 },
        { kind: 'move', ids: ['sh-2'], deltaMm: 50 },
      ],
      select: ['sh-2'],
    });
  try {
    const p = create();
    const start = get(p.id).revisions.length;
    const events: { event: string; data: string }[] = [];
    await readEvents(await POST(request(p.id, { message: 'Aumente a largura e suba esta prateleira' })), (e) => events.push(e));
    assert.equal(events.at(-1)?.event, 'done');
    const saved = get(p.id);
    assert.equal(saved.revisions.length, start + 1, 'uma única revisão');
    const design = saved.revisions[saved.cursor].params;
    assert.equal(design.width, 1000);
    const infos = design.shelves.map((s) => s.elevation).sort((a, b) => a - b);
    assert.equal(infos[1], base.shelves.map((s) => s.elevation).sort((a, b) => a - b)[1] + 50);
    // Um desfazer reverte ambas.
    saved.cursor--;
    save(saved, saved.version);
    const reverted = view(get(p.id)).params;
    assert.equal(reverted.width, base.width);
    assert.deepEqual(gapsOf(reverted), gapsOf(base));
  } finally {
    globalThis.fetch = original;
  }
});

void test('primeira válida e segunda inválida não mudam nada', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    response({
      action: 'update',
      approach: 'Ampliar e mover além do limite.',
      message: 'Complemento.',
      ops: [
        { kind: 'resize', width: 1000 },
        { kind: 'move', ids: ['sh-4'], deltaMm: 2000 },
      ],
    });
  try {
    const p = create();
    const start = get(p.id).revisions.length;
    const events: { event: string; data: string }[] = [];
    await readEvents(await POST(request(p.id, { message: 'Aumente e suba demais' })), (e) => events.push(e));
    assert.equal(events.at(-1)?.event, 'done');
    const saved = get(p.id);
    assert.equal(saved.revisions.length, start, 'nenhuma revisão');
    assert.equal(view(get(p.id)).params.width, base.width, 'largura intacta');
    const last = saved.messages.at(-1);
    assert.equal(last?.result?.outcome, 'rejected');
    assert.match(last?.content ?? '', /Não apliquei/);
  } finally {
    globalThis.fetch = original;
  }
});

void test('resposta aplicada não pede confirmação posterior', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    response({
      action: 'update',
      approach: 'Subir a Prateleira 2.',
      message: 'Subindo.',
      ops: [{ kind: 'move', ids: ['sh-2'], deltaMm: 30 }],
      select: ['sh-2'],
    });
  try {
    const p = create();
    const events: { event: string; data: string }[] = [];
    await readEvents(await POST(request(p.id, { message: 'Suba esta 3 cm' })), (e) => events.push(e));
    assert.equal(events.at(-1)?.event, 'done');
    const saved = get(p.id);
    const last = saved.messages.at(-1)!;
    assert.equal(last.result?.outcome, 'applied');
    assert.ok(!last.clarification, 'sem pendência');
    assert.ok(/subiu/i.test(last.result.changes.join(' ')));
    assert.ok(!/Aguardando/i.test(last.content));
  } finally {
    globalThis.fetch = original;
  }
});

void test('pergunta informativa não cria revisão nem pendência', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    response({
      action: 'answer',
      approach: 'Responder com o vão atual.',
      message: 'O vão livre abaixo da Prateleira 2 é de 338 mm.',
      ops: [],
    });
  try {
    const p = create();
    const start = get(p.id).revisions.length;
    const events: { event: string; data: string }[] = [];
    await readEvents(await POST(request(p.id, { message: 'Qual o vão abaixo da Prateleira 2?' })), (e) => events.push(e));
    assert.equal(events.at(-1)?.event, 'done');
    const saved = get(p.id);
    assert.equal(saved.revisions.length, start, 'sem revisão');
    const last = saved.messages.at(-1)!;
    assert.equal(last.result?.outcome, 'answered');
    assert.ok(!last.clarification);
  } finally {
    globalThis.fetch = original;
  }
});

void test('pedido relativo “mais 5 cm” usa a versão atual e cria revisão', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    response({
      action: 'update',
      approach: 'Subir mais 50 mm a partir do estado atual.',
      message: 'Subindo mais.',
      ops: [{ kind: 'move', ids: ['sh-2'], deltaMm: 50 }],
    });
  try {
    const p = create();
    await readEvents(await POST(request(p.id, { message: 'Suba esta 3 cm' })), () => {});
    const after1 = view(get(p.id)).params;
    await readEvents(await POST(request(p.id, { message: 'mais 5 cm', version: get(p.id).version })), () => {});
    const after2 = view(get(p.id)).params;
    const e2 = after2.shelves.find((s) => s.id === 'sh-2')!.elevation;
    const e1 = after1.shelves.find((s) => s.id === 'sh-2')!.elevation;
    assert.ok(Math.abs(e2 - e1 - 50) < 0.01, 'sobe 50 mm a partir da revisão atual');
  } finally {
    globalThis.fetch = original;
  }
});

void test('seleção muda sem criar revisão e vai para o contexto', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    response({ action: 'update', approach: 'a', message: 'm', ops: [], select: ['sh-1'] });
  try {
    const p = create();
    const start = get(p.id).revisions.length;
    const events: { event: string; data: string }[] = [];
    await readEvents(await POST(request(p.id, { message: 'mostre a primeira', selected: ['sh-1'] })), (e) => events.push(e));
    const saved = get(p.id);
    assert.equal(saved.revisions.length, start, 'sem revisão');
    const last = saved.messages.at(-1)!;
    assert.equal(last.result?.outcome, 'highlighted');
    assert.deepEqual(last.result?.appliedOperations, []);
    assert.deepEqual(last.context?.selectedPartIds, ['sh-1']);
  } finally {
    globalThis.fetch = original;
  }
});

void test('esclarecimento caído reaparece no pedido seguinte com o estado atual', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    response({ action: 'update', approach: 'a', message: 'm', ops: [{ kind: 'resize', width: 1000 }] });
  try {
    const p = create();
    await readEvents(await POST(request(p.id, { message: 'Largura de 1 metro' })), () => {});
    await readEvents(await POST(request(p.id, { message: 'mais um pouco' })), () => {});
    assert.equal(view(get(p.id)).params.width, 1000);
  } finally {
    globalThis.fetch = original;
  }
});
void test('esclarecimento pendente é informado ao próximo turno e some quando respondido', async () => {
  const original = globalThis.fetch;
  const bodies: string[] = [];
  let pId = '';
  let call = 0;
  globalThis.fetch = async (_url: unknown, init?: RequestInit) => {
    bodies.push(typeof init?.body === 'string' ? init.body : '');
    call++;
    if (call === 1)
      return response({
        action: 'clarify',
        approach: 'Perguntar qual medida.',
        message: 'Qual medida você quer mudar?',
        ops: [],
        clarification: {
          question: 'Qual medida você quer mudar?',
          options: [
            { id: 'largura', label: 'Largura', partIds: [get(pId).revisions[0].params.modules[0].id] },
            { id: 'altura', label: 'Altura', partIds: [get(pId).revisions[0].params.modules[0].id] },
          ],
        },
      });
    if (call === 2)
      return response({
        action: 'answer',
        approach: 'a',
        message: 'Qual medida você quer mudar?',
        ops: [],
      });
    return response({
      action: 'update',
      approach: 'a',
      message: 'm',
      ops: [{ kind: 'resize', width: 1000 }],
    });
  };
  try {
    const p = create();
    pId = p.id;
    await readEvents(await POST(request(p.id, { message: 'deixe com 2 metros' })), () => {});
    const ask = get(p.id).messages.at(-1)!;
    assert.equal(ask.result?.outcome, 'clarification');
    assert.equal(ask.clarification?.options.length, 2);
    // O turno anterior precisa ver a pergunta pendente; sem isso a IA repetia
    // a mesma pergunta como se nada tivesse acontecido.
    await readEvents(
      await POST(request(p.id, { message: 'pode ser 2 metros' }, get(p.id).version)),
      () => {},
    );
    const sent = JSON.parse(bodies[1] ?? '{}') as { messages: { role: string; content: string }[] };
    const userTurn = sent.messages.filter((m) => m.role === 'user').at(-1)!;
    const payload = JSON.parse(requestOf(userTurn.content)) as {
      pending_clarification: string | null;
    };
    assert.equal(payload.pending_clarification, 'Qual medida você quer mudar?');
    // Responder pela opção aplica a escolha e encerra a pendência.
    const clar = get(p.id).messages.findLast((m) => m.clarification)!.clarification!;
    const answerEvents: { event: string; data: string }[] = [];
    await readEvents(
      await POST(
        request(
          p.id,
          { message: 'Largura', clarificationId: clar.id, optionId: clar.options[0].id },
          get(p.id).version,
        ),
      ),
      (e) => answerEvents.push(e),
    );
    assert.equal(answerEvents.at(-1)?.event, 'done', answerEvents.at(-1)?.data);
    assert.equal(view(get(p.id)).params.width, 1000);
    assert.ok(
      get(p.id).messages.some((m) => m.clarificationId === clar.id),
      'a mensagem liga a resposta à pergunta',
    );
    const answered = JSON.parse(bodies[2] ?? '{}') as {
      messages: { role: string; content: string }[];
    };
    const answeredTurn = answered.messages.filter((m) => m.role === 'user').at(-1)!;
    const after = JSON.parse(requestOf(answeredTurn.content)) as {
      pending_clarification: string | null;
    };
    assert.equal(after.pending_clarification, null);
  } finally {
    globalThis.fetch = original;
  }
});
void test('proposta sobreposta volta para a IA corrigir e o pedido termina aplicado', async () => {
  const original = globalThis.fetch;
  const p = create();
  const rootId = get(p.id).revisions[0].params.modules[0].id;
  const overlapping = [
    { kind: 'module.add', id: 'test-a', preset: 'niche', name: 'Nicho A' },
    { kind: 'module.add', id: 'test-b', preset: 'niche', name: 'Nicho B' },
    { kind: 'connect', parent: rootId, child: 'test-a', side: 'right', shared: false, align: 'front', offset: 0 },
    { kind: 'connect', parent: rootId, child: 'test-b', side: 'right', shared: false, align: 'front', offset: 0 },
  ];
  const corrected = [
    { kind: 'module.add', id: 'test-a', preset: 'niche', name: 'Nicho A' },
    { kind: 'module.add', id: 'test-b', preset: 'niche', name: 'Nicho B' },
    { kind: 'connect', parent: rootId, child: 'test-a', side: 'right', shared: false, align: 'front', offset: 0 },
    { kind: 'connect', parent: 'test-a', child: 'test-b', side: 'right', shared: false, align: 'front', offset: 0 },
  ];
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return response({
      action: 'update',
      approach: `tentativa ${calls}`,
      message: 'm',
      ops: calls === 1 ? overlapping : corrected,
    });
  };
  try {
    const start = get(p.id).revisions.length;
    const events: { event: string; data: string }[] = [];
    await readEvents(
      await POST(request(p.id, { message: 'Crie mais móveis e deixe mais complexo' })),
      (e) => events.push(e),
    );
    assert.equal(events.at(-1)?.event, 'done');
    assert.equal(calls, 2, 'a IA foi chamada de novo com o erro de geometria');
    const saved = get(p.id);
    assert.equal(saved.revisions.length, start + 1, 'uma única revisão');
    const last = saved.messages.at(-1)!;
    assert.equal(last.result?.outcome, 'applied');
    const modules = saved.revisions[saved.cursor].params.modules;
    assert.equal(modules.length, 3);
    const a = modules.find((m) => m.id === 'test-a')!;
    const b = modules.find((m) => m.id === 'test-b')!;
    // Em cadeia: a cópia fica à direita do primeiro, não sobre ele.
    assert.ok(
      b.position[0] - a.position[0] >= a.width / 2,
      `esperava ${b.position[0]} depois de ${a.position[0]}`,
    );
  } finally {
    globalThis.fetch = original;
  }
});
