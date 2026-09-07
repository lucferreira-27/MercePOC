import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEvents } from '../lib/sse';
import { describeChanges } from '../lib/progress';
import { defaults } from '../lib/furniture';
import { create, get, view } from '../lib/store';
import { POST } from '../app/api/chat/route';
process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-progress-'));
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
  changes: { width: 1000 },
};
const wire = (name = 'submit_design_decision') =>
  `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'PRIVATE_INTERNAL_TEXT', tool_calls: [{ index: 0, function: { name, arguments: JSON.stringify(decision) } }] } }] })}\n\ndata: [DONE]\n\n`;
const request = (id: string, version = 0, stream = true) =>
  new Request('http://127.0.0.1:4310/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(stream ? { Accept: 'text/event-stream' } : {}),
    },
    body: JSON.stringify({ id, version, message: 'Largura de 1 metro' }),
  });
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
  assert.deepEqual(
    describeChanges(defaults, {
      ...defaults,
      width: 1000,
      materialId: 'white',
    }),
    ['Largura: 800 mm → 1000 mm', 'Material: Carvalho natural → Branco fosco'],
  );
  assert.deepEqual(describeChanges(defaults, defaults), []);
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
    assert.equal(view(get(p.id)).params.width, 800);
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
    assert.deepEqual(saved.messages.at(-1)?.report?.changes, [
      'Largura: 800 mm → 1000 mm',
    ]);
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
