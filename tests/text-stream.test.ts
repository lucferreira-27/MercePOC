import test from 'node:test';
import assert from 'node:assert/strict';
import { readStringField } from '../lib/partial-json';
import { interpretStream } from '../lib/gateway';
import { migrateParams } from '../lib/studio';
import type { TextPreview } from '../lib/progress';
void test('partial JSON extracts only requested public top-level strings', () => {
  assert.equal(
    readStringField('{"approach":"Vou verificar', 'approach'),
    'Vou verificar',
  );
  assert.equal(
    readStringField('{"approach":"ação\\ncom \\"', 'approach'),
    'ação\ncom "',
  );
  assert.equal(readStringField('{"message":"caf\\u00', 'message'), 'caf');
  assert.equal(readStringField('{"message":"caf\\u00e9', 'message'), 'café');
  assert.equal(readStringField('{"message":"ok\\', 'message'), 'ok');
  assert.equal(
    readStringField('{"changes":{"message":"private"}}', 'message'),
    undefined,
  );
  assert.equal(
    readStringField('{"reasoning_content":"private"}', 'approach'),
    undefined,
  );
  assert.equal(readStringField('{"message":"\\ud83d', 'message'), '');
  assert.equal(readStringField('{"message":"\\ud83d\\ude00', 'message'), '😀');
});
void test('text previews arrive before structured response completes and contain only public fields', async () => {
  const original = globalThis.fetch;
  process.env.MERCE_DEFAULT_MODEL ??= 'luna';
process.env.AI_API_KEY = 'test-key';
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const enc = new TextEncoder();
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          controller = c;
        },
      }),
    );
  const snapshots: TextPreview[] = [];
  let finished = false;
  const send = (args: string) =>
    controller.enqueue(
      enc.encode(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'PRIVATE_TOKEN', content: args } }] })}\n\n`,
      ),
    );
  try {
    const design = migrateParams({ width: 800, height: 1800, depth: 350, shelfCount: 4, materialId: 'oak', bottomOpening: null });
    const result = interpretStream(
      design,
      'rev-1',
      1,
      [{ id: 'm1', role: 'user', content: 'Largura 1 metro' }],
      [],
      { requestId: 'r1', baseRevisionId: 'rev-1', selectedPartIds: [], referencedPartIds: [] },
      () => {},
      0,
      undefined,
      (v) => snapshots.push(v),
    ).then((v) => {
      finished = true;
      return v;
    });
    await new Promise((r) => setTimeout(r, 0));
    send('{"action":"update","approach":"Vou ampliar');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(finished, false);
    assert.equal(snapshots.at(-1)?.approach, 'Vou ampliar');
    send(' a largura.","message":"Proponho 1000 mm');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(finished, false);
    assert.equal(snapshots.at(-1)?.answer, 'Proponho 1000 mm');
    send('.","ops":[{"kind":"resize","width":1000}]}');
    controller.close();
    const value = await result;
    assert.equal(value.ops[0]?.kind, 'resize');
    assert.ok(snapshots.length >= 4);
    // O raciocínio só existe no campo de depuração; approach e answer são
    // sempre texto público.
    assert.equal(
      JSON.stringify(snapshots.map((s) => ({ a: s.approach, b: s.answer }))).includes(
        'PRIVATE_TOKEN',
      ),
      false,
    );
    assert.ok(
      snapshots.some((s) => s.reasoningDelta?.includes('PRIVATE_TOKEN')),
      'raciocínio ausente no campo de depuração',
    );
  } finally {
    globalThis.fetch = original;
  }
});
void test('previews also report streamed bytes so the debug view is never silent', async () => {
  const original = globalThis.fetch;
  process.env.AI_API_KEY = 'test-key';
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const enc = new TextEncoder();
  globalThis.fetch = async () =>
    new Response(new ReadableStream({ start(c) { controller = c; } }));
  const snapshots: TextPreview[] = [];
  try {
    const design = migrateParams({ width: 800, height: 1800, depth: 350, shelfCount: 4, materialId: 'oak', bottomOpening: null });
    const result = interpretStream(
      design,
      'rev-1',
      1,
      [{ id: 'm1', role: 'user', content: 'Largura 1 metro' }],
      [],
      { requestId: 'r2', baseRevisionId: 'rev-1', selectedPartIds: [], referencedPartIds: [] },
      () => {},
      0,
      undefined,
      (v) => snapshots.push(v),
    );
    await new Promise((r) => setTimeout(r, 0));
    // Ainda sem campos públicos: o contador de bytes precisa aparecer assim
    // que o raciocínio privado enche o limiar.
    for (let i = 0; i < 12; i++)
      controller.enqueue(
        enc.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'PRIVATE_TOKEN_'.repeat(20) } }] })}\n\n`,
        ),
      );
    await new Promise((r) => setTimeout(r, 0));
    const mid = snapshots.at(-1)!;
    assert.ok((mid.bytes ?? 0) > 1024, `bytes=${mid.bytes}`);
    assert.equal(mid.answer, '');
    // O servidor manda o raciocínio só quando ele cresce (ou no primeiro
    // trecho); o cliente mantém o último recebido entre eventos.
    assert.ok(
      snapshots.some((s) => s.reasoningDelta?.includes('PRIVATE_TOKEN')),
      'raciocínio ausente',
    );
    assert.ok(
      snapshots.some((s) => (s.reasoningTotal ?? 0) > 0),
      'total de raciocínio ausente',
    );
    controller.enqueue(
      enc.encode(
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'submit_design_decision', arguments: JSON.stringify({ action: 'update', approach: 'a', message: 'Largura atualizada.', ops: [{ kind: 'resize', width: 1000 }] }) } }] } }] })}\n\ndata: [DONE]\n\n`,
      ),
    );
    controller.close();
    const value = await result;
    assert.equal(value.ops[0]?.kind, 'resize');
    assert.equal(snapshots.at(-1)?.answer, 'Largura atualizada.');
  } finally {
    globalThis.fetch = original;
  }
});
