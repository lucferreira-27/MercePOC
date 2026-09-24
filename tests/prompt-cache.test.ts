import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretStream } from '../lib/gateway';
import { buildTemplate, templates } from '../lib/templates';
import { normalize } from '../lib/studio';
import type { Message } from '../lib/store';

type Body = { model: string; messages: { role: string; content: unknown }[] };

/** Chama a IA com um fetch falso e devolve o corpo que teria ido ao provedor. */
async function capture(run: () => Promise<unknown>) {
  const original = globalThis.fetch;
  const bodies: Body[] = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init?.body as string) as Body);
    const decision = JSON.stringify({ action: 'answer', approach: 'ok', message: 'ok', ops: [], select: [], refs: [], suggestions: [] });
    const chunk = JSON.stringify({ choices: [{ delta: { content: decision } }] });
    return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return bodies;
}

const user = (content: string): Message => ({ id: content, role: 'user', content });
const ctx = { requestId: 'r', baseRevisionId: 'b', selectedPartIds: [], referencedPartIds: [] };

void test('regras fixas vêm primeiro e são idênticas entre turnos: o provedor reaproveita o cache', async () => {
  process.env.AI_API_KEY ??= 'teste';
  const wardrobe = normalize(buildTemplate(templates.find((t) => t.id === 'guarda-roupa')!));
  const rack = normalize(buildTemplate(templates.find((t) => t.id === 'rack')!));
  const room = templates.find((t) => t.id === 'guarda-roupa')!.room;
  const [a, b, c] = await capture(async () => {
    await interpretStream(wardrobe, 'r1', 1, [user('Troque para nogueira')], [], ctx, () => {}, 0, undefined, () => {}, 'luna', room);
    await interpretStream(rack, 'r2', 7, [user('Abra as portas')], ['r2:root'], { ...ctx, quoteNote: 'Orçamento: R$ 1.000' }, () => {}, 0, undefined, () => {}, 'luna');
    await interpretStream(rack, 'r3', 8, [user('Quanto custa?')], [], ctx, () => {}, 0, undefined, () => {}, 'deepseek');
  });
  // Mesma regra para projetos, seleções, ambientes e orçamentos diferentes.
  assert.equal(a.messages[0].content, b.messages[0].content);
  assert.equal(a.messages[0].content, c.messages[0].content);
  const fixed = String(a.messages[0].content);
  assert.ok(fixed.length > 6000, 'o bloco fixo é grande o bastante para valer o cache');
  for (const dynamic of ['Composição atual', 'selected_ids (seleção', 'r2:root', 'Ambiente informado', 'Orçamento: R$'])
    assert.equal(fixed.includes(dynamic), false, `"${dynamic}" não pode estar no bloco fixo`);
  // O que muda a cada turno vai na mensagem do usuário, logo depois do bloco
  // fixo (numa segunda mensagem de sistema o gateway quebrava o prefixo).
  assert.equal(a.messages[1].role, 'user');
  assert.match(String(a.messages[1].content), /Composição atual/);
  assert.match(String(a.messages[1].content), /Ambiente informado/);
  assert.match(String(b.messages[1].content), /r2:root/);
  assert.match(String(b.messages[1].content), /Orçamento: R\$ 1\.000/);
  assert.notEqual(a.messages[1].content, b.messages[1].content);
  // O pedido vem depois do estado do turno, na mesma mensagem.
  const turn = String(a.messages[1].content);
  assert.ok(turn.indexOf('Composição atual') < turn.indexOf('Pedido deste turno'));
  assert.match(turn, /Troque para nogueira/);
});
