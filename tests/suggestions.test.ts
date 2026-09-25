import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEvents } from '../lib/sse';
import { decisionSchema, normalizeSuggestions } from '../lib/gateway';
import { create, get, view } from '../lib/store';
import { entityIds } from '../lib/studio';
import { POST } from '../app/api/chat/route';
// Estes testes cobrem o caminho antigo (uma resposta JSON); o laço tem os seus.
process.env.MERCE_AGENT = '0';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-suggestions-'));
process.env.AI_API_KEY = 'test-key';

function response(payload: unknown) {
  const body = `data: ${JSON.stringify({
    choices: [
      {
        delta: {
          reasoning_content: 'PRIVATE',
          tool_calls: [
            {
              index: 0,
              function: {
                name: 'submit_design_decision',
                arguments: JSON.stringify(payload),
              },
            },
          ],
        },
      },
    ],
  })}\n\ndata: [DONE]\n\n`;
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

void test('sugestão com id interno, repetida ou longa demais não vira chip', () => {
  assert.deepEqual(
    normalizeSuggestions([
      '  Coloque duas portas neste vão  ',
      'Coloque DUAS portas neste vão',
      'Ajuste o module-1 para a direita',
      'Mova a PRATELEIRA 2',
      'Vá',
      'x'.repeat(90),
      'Suba a prateleira do meio',
      'Troque a cor das portas',
      'Pinte a lateral',
    ]),
    ['Coloque duas portas neste vão', 'Suba a prateleira do meio', 'Troque a cor das portas', 'Pinte a lateral'],
  );
});

void test('o contrato aceita sugestões e as normaliza, com padrão vazio', () => {
  const base = {
    action: 'answer' as const,
    approach: 'Resposta direta.',
    message: 'São 800 mm.',
  };
  assert.deepEqual(decisionSchema.parse(base).suggestions, []);
  assert.deepEqual(
    decisionSchema.parse({
      ...base,
      suggestions: ['mova o sh-3', 'Deixe 400 mm livres'],
    }).suggestions,
    ['Deixe 400 mm livres'],
  );
});

void test('turno aplicado guarda as sugestões da IA e o diff do relatório', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    response({
      action: 'update',
      approach: 'Ampliar a largura e conferir as peças.',
      message: 'Largura atualizada.',
      suggestions: [
        'Coloque duas portas neste vão',
        'Ajuste o module-1',
        'Suba a prateleira do meio',
      ],
      ops: [{ kind: 'resize', width: 1000 }],
    });
  try {
    const p = create();
    await readEvents(
      await POST(request(p.id, { message: 'Aumente a largura para 1 metro' })),
      () => {},
    );
    const saved = get(p.id);
    const last = saved.messages.at(-1);
    assert.deepEqual(last?.suggestions, [
      'Coloque duas portas neste vão',
      'Suba a prateleira do meio',
    ]);
    // O relatório não guarda roteiro técnico: a resposta é o diff e o texto
    // da IA.
    assert.equal(Object.keys(last?.report ?? {}).includes('steps'), false);
    // A resposta é o cartão com o que mudou, não um log de execução.
    assert.equal(last?.report?.highlights?.[0].title, 'Medidas do móvel ajustadas');
    assert.match(last?.report?.changes?.[0] ?? '', /Largura: 800 mm → 1000 mm/);
    // Nada carrega o texto privado do provedor.
    assert.equal(JSON.stringify(saved).includes('PRIVATE'), false);
  } finally {
    globalThis.fetch = original;
  }
});

void test('turno com pergunta não sugere chips', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    response({
      action: 'clarify',
      approach: 'Preciso saber qual prateleira.',
      message: 'Qual prateleira você quer mover?',
      suggestions: [],
      ops: [{ kind: 'move', ids: [], deltaMm: 50 }],
      clarification: {
        question: 'Qual prateleira você quer mover?',
        options: [],
      },
    });
  try {
    const p = create();
    const ids = entityIds(view(get(p.id)).params);
    const shelves = ids.filter((id) => id.startsWith('sh-'));
    globalThis.fetch = async () =>
      response({
        action: 'clarify',
        approach: 'Preciso saber qual prateleira.',
        message: 'Qual prateleira você quer mover?',
        ops: [{ kind: 'move', ids: [shelves[0]], deltaMm: 50 }],
        clarification: {
          question: 'Qual prateleira você quer mover?',
          options: [
            { id: 'o1', label: 'A de baixo', partIds: [shelves[0]] },
            { id: 'o2', label: 'A de cima', partIds: [shelves[shelves.length - 1]] },
          ],
        },
      });
    await readEvents(
      await POST(request(p.id, { message: 'Suba 5 cm a outra prateleira' })),
      () => {},
    );
    const last = get(p.id).messages.at(-1);
    assert.equal(last?.suggestions, undefined, 'pergunta não sugere próximo passo');
    assert.equal(last?.report?.outcome, 'clarification');
    assert.ok((last?.clarification?.options?.length ?? 0) >= 2, 'pergunta com opções reais');
    assert.match(last?.clarification?.question ?? '', /qual prateleira/i);
  } finally {
    globalThis.fetch = original;
  }
});

void test('resposta digitada resolve a pergunta e ela não volta no turno seguinte', async () => {
  const original = globalThis.fetch;
  const bodies: string[] = [];
  let payload: unknown = null;
  globalThis.fetch = async (_url: unknown, init?: RequestInit) => {
    bodies.push(typeof init?.body === 'string' ? init.body : '');
    return response(payload);
  };
  try {
    const p = create();
    const ids = entityIds(view(get(p.id)).params);
    const shelves = ids.filter((id) => id.startsWith('sh-'));
    payload = {
      action: 'clarify',
      approach: 'Preciso saber qual prateleira.',
      message: 'Qual prateleira você quer mover?',
      ops: [{ kind: 'move', ids: [shelves[0]], deltaMm: 50 }],
      clarification: {
        question: 'Qual prateleira você quer mover?',
        options: [
          { id: 'o1', label: 'A de baixo', partIds: [shelves[0]] },
          { id: 'o2', label: 'A de cima', partIds: [shelves[shelves.length - 1]] },
        ],
      },
    };
    await readEvents(
      await POST(request(p.id, { message: 'Suba 5 cm a outra prateleira' })),
      () => {},
    );
    const clar = get(p.id).messages.at(-1)?.clarification;
    assert.ok(clar, 'pergunta registrada');
    payload = {
      action: 'update',
      approach: 'Subir a prateleira de baixo.',
      message: 'Prateleira de baixo ajustada.',
      ops: [{ kind: 'move', ids: [shelves[0]], deltaMm: 50 }],
    };
    // Resposta digitada: vai a pergunta atual no campo, sem escolher opção.
    await readEvents(
      await POST(
        request(
          p.id,
          { message: 'A de baixo', clarificationId: clar.id },
          get(p.id).version,
        ),
      ),
      () => {},
    );
    const saved = get(p.id);
    assert.equal(
      saved.messages.findLast((m) => m.role === 'user')?.clarificationId,
      clar.id,
      'a pergunta fica marcada como respondida',
    );
    await readEvents(
      await POST(
        request(p.id, { message: 'Deixe 400 mm livres abaixo' }, saved.version),
      ),
      () => {},
    );
    const sent = JSON.parse(bodies.at(-1) ?? '{}') as {
      messages: { role: string; content: string }[];
    };
    const content = sent.messages.findLast((m) => m.role === 'user')?.content ?? '';
    assert.match(content, /"pending_clarification":null/);
  } finally {
    globalThis.fetch = original;
  }
});
