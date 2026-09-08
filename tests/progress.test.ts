import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEvents } from '../lib/sse';
import { describeChanges } from '../lib/design';
import { defaults } from '../lib/furniture';
import { migrateParams, resizeDesign } from '../lib/design';
import { create, get, view } from '../lib/store';
import { decisionSchema } from '../lib/gateway';
import { POST } from '../app/api/chat/route';
process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-progress-'));
const request = (id: string, version = 0, stream = true) =>
  new Request('http://127.0.0.1:4310/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(stream ? { Accept: 'text/event-stream' } : {}),
    },
    body: JSON.stringify({ id, version, message: 'Largura de 1 metro' }),
  });
process.env.MERGE_GATEWAY_API_KEY = 'test-key';
function response(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 3)
          c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    }),
  );
}
const decision = {
  action: 'update',
  approach: 'Proponho ampliar a largura e verificar as peças dependentes.',
  message: 'Largura atualizada.',
  ops: [{ kind: 'resize', width: 1000 }],
};
const wire = (name = 'submit_design_decision') =>
  `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'PRIVATE_INTERNAL_TEXT', tool_calls: [{ index: 0, function: { name, arguments: JSON.stringify(decision) } }] } }] })}\n\ndata: [DONE]\n\n`;
void test('SSE handles split UTF-8, CRLF, comments, multiline data and final frame', async () => {
  const events: { event: string; data: string }[] = [];
  await readEvents(
    response(
      ': keepalive\r\nevent: progress\r\ndata: ação\r\ndata: válida\r\n\r\nevent: done\ndata: fim',
    ),
    (e) => events.push(e),
  );
  assert.deepEqual(events, [
    { event: 'progress', data: 'ação\nválida' },
    { event: 'done', data: 'fim' },
  ]);
});
void test('change summaries are derived from committed parameters', () => {
  const before = migrateParams(defaults);
  assert.deepEqual(
    describeChanges(before, resizeDesign(resizeDesign(before, { width: 1000 }), { materialId: 'white' })),
    ['Largura: 800 mm → 1000 mm', 'Material: Carvalho natural → Branco fosco'],
  );
  assert.deepEqual(describeChanges(before, before), []);
});
void test('live progress precedes completion, holds lock, persists report, omits private tokens', async () => {
  const realFetch = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  globalThis.fetch = async () => {
    await gate;
    return response(wire());
  };
  try {
    const p = create();
    const before = view(get(p.id)).params;
    const res = await POST(request(p.id));
    assert.equal(
      res.headers.get('content-type'),
      'text/event-stream; charset=utf-8',
    );
    const events: { event: string; data: string }[] = [];
    const reading = readEvents(res, (e) => events.push(e));
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(events[0]?.event, 'progress');
    assert.equal(JSON.parse(events[0].data).stage, 'connecting');
    assert.equal((await POST(request(p.id))).status, 409);
    assert.equal(view(get(p.id)).params.width, before.width);
    release();
    await reading;
    assert.deepEqual(
      events
        .filter((e) => e.event === 'progress')
        .map((e) => JSON.parse(e.data).stage),
      ['connecting', 'interpreting', 'validating', 'saving'],
    );
    assert.equal(events.at(-1)?.event, 'done');
    assert.equal(
      JSON.stringify(events).includes('PRIVATE_INTERNAL_TEXT'),
      false,
    );
    const saved = view(get(p.id));
    assert.equal(saved.params.width, 1000);
    assert.deepEqual(
      saved.messages.at(-1)?.report?.changes,
      describeChanges(before, resizeDesign(before, { width: 1000 })),
    );
    const json = await POST(request(p.id, saved.version, false));
    assert.equal(json.status, 200);
    assert.ok(json.headers.get('content-type')?.includes('application/json'));
  } finally {
    release();
    globalThis.fetch = realFetch;
  }
});
void test('invalid tool call reports retries and failure without changing project or retaining lock', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => response(wire('wrong_tool'));
  try {
    const p = create(),
      events: { event: string; data: string }[] = [];
    await readEvents(await POST(request(p.id)), (e) => events.push(e));
    assert.equal(
      events.filter(
        (e) =>
          e.event === 'progress' && JSON.parse(e.data).stage === 'retrying',
      ).length,
      2,
    );
    assert.equal(events.at(-1)?.event, 'error');
    assert.equal(get(p.id).version, 0);
    globalThis.fetch = async () => response(wire());
    const retry = await POST(request(p.id, 0, false));
    assert.equal(retry.status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }
});

void test('hidden preview mode sends progress and final answer without text updates', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => response(wire());
  try {
    const p = create(),
      req = request(p.id);
    req.headers.set('X-Chat-Preview', 'hidden');
    const events: { event: string; data: string }[] = [];
    await readEvents(await POST(req), (e) => events.push(e));
    assert.ok(events.some((e) => e.event === 'progress'));
    assert.equal(
      events.some((e) => e.event === 'text'),
      false,
    );
    assert.equal(events.at(-1)?.event, 'done');
    assert.equal(view(get(p.id)).params.width, 1000);
  } finally {
    globalThis.fetch = original;
  }
});
void test('assistant highlight list defaults to empty and passes through', () => {
  assert.deepEqual(decisionSchema.parse(decision).select, []);
  assert.deepEqual(
    decisionSchema.parse({ ...decision, select: ['sh-1'] }).select,
    ['sh-1'],
  );
});
void test('assistant highlight returns only existing part ids', async () => {
  const original = globalThis.fetch;
  const payload = { ...decision, select: ['sh-2', 'ghost'] };
  const body =
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'submit_design_decision', arguments: JSON.stringify(payload) } }] } }] })}\n\ndata: [DONE]\n\n`;
  globalThis.fetch = async () => response(body);
  try {
    const p = create();
    const events: { event: string; data: string }[] = [];
    await readEvents(await POST(request(p.id)), (e) => events.push(e));
    assert.equal(events.at(-1)?.event, 'done');
    assert.deepEqual(JSON.parse(events.at(-1)!.data).selected, ['sh-2']);
  } finally {
    globalThis.fetch = original;
  }
});
void test('legacy shelf ids resolve to stable ids', async () => {
  const original = globalThis.fetch;
  const payload = { ...decision, ops: [], select: ['shelf-2'] };
  const body =
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'submit_design_decision', arguments: JSON.stringify(payload) } }] } }] })}\n\ndata: [DONE]\n\n`;
  globalThis.fetch = async () => response(body);
  try {
    const p = create();
    const events: { event: string; data: string }[] = [];
    await readEvents(await POST(request(p.id)), (e) => events.push(e));
    assert.equal(events.at(-1)?.event, 'done');
    assert.deepEqual(JSON.parse(events.at(-1)!.data).selected, ['sh-2']);
  } finally {
    globalThis.fetch = original;
  }
});
void test('highlight-only answers keep the model message without new revisions', async () => {
  const original = globalThis.fetch;
  const payload = {
    action: 'update',
    approach: 'Destacar o tampo.',
    message: 'Tampo destacado no modelo.',
    ops: [],
    select: ['top'],
  };
  const body =
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'submit_design_decision', arguments: JSON.stringify(payload) } }] } }] })}\n\ndata: [DONE]\n\n`;
  globalThis.fetch = async () => response(body);
  try {
    const p = create();
    const startRevisions = get(p.id).revisions.length;
    const events: { event: string; data: string }[] = [];
    await readEvents(await POST(request(p.id)), (e) => events.push(e));
    assert.equal(events.at(-1)?.event, 'done');
    assert.deepEqual(JSON.parse(events.at(-1)!.data).selected, ['top']);
    assert.equal(get(p.id).revisions.length, startRevisions);
    const saved = view(get(p.id));
    assert.equal(saved.messages.at(-1)?.content, 'Tampo destacado no modelo.');
    assert.deepEqual(saved.messages.at(-1)?.report?.selected, [
      {
        id: 'top',
        name: 'Tampo',
        dims: '764 × 344 × 18 mm',
        material: 'Carvalho natural 18',
        size: [764, 18, 344],
        color: '#bd925c',
      },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});
