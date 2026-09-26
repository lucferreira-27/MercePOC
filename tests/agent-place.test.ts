import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create, get, revise, save, type Message } from '../lib/store';
import { DEFAULT_PRICES } from '../lib/quote';
import { runAgentTurn } from '../lib/agent/turn';
import { generateDesign, normalize, type Design } from '../lib/studio';
import { fitReport, type Room } from '../lib/room';
import { planPieces } from '../lib/agent/place';
import { interiorOps } from '../lib/agent/interior';
import { sceneOf, sceneSummary } from '../lib/agent/scene';
import type { ChatMessage, ModelReply, ToolCall } from '../lib/agent/model';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-place-'));
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
const scene = (name: string) => JSON.parse(readFileSync(`bench/scenes/${name}.json`, 'utf8')) as { design: Design; room: Room | null };
function start(request: string, from: string) {
  const p = get(create().id);
  const s = scene(from);
  if (s.room) p.room = s.room;
  revise(p, normalize(s.design), 'cena');
  save(p, p.version);
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
  return { p: q, user, version: save(q, q.version).version };
}
const turn = (s: ReturnType<typeof start>, fake: unknown) =>
  runAgentTurn({
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
    signal: new AbortController().signal,
    progress: () => {},
    emit: () => {},
    onUsage: () => {},
    usage: () => ({}),
    call: fake as never,
  });
const text = (m: ChatMessage) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));

void test('place: peças em volta da TV ficam presas no painel, fora da tela, e a TV não anda', async () => {
  const s = start('Nichos em volta da TV', 'painel-tv');
  const { fake, seen } = scripted([
    () =>
      reply(
        call('place', {
          pecas: [
            { ref: 'torre', nome: 'Torre', tipo: 'estante', onde: { de: 'tv', lado: 'esquerda', alinhar: 'topo' } },
            { ref: 'nicho', nome: 'Nicho', tipo: 'nicho', onde: { de: 'tv', lado: 'direita' } },
          ],
        }),
      ),
    () => reply(call('finish', { mensagem: 'Pus uma torre de nichos à esquerda da TV e um nicho à direita.', sugestoes: [] })),
  ]);
  const r = await turn(s, fake);
  const p = get(r.projectId);
  const d = p.revisions[p.cursor].params;
  assert.deepEqual(fitReport(d, p.room!).issues, []);
  const panelFront = 12.5;
  for (const id of ['torre', 'nicho']) {
    const parts = generateDesign(d).parts.filter((v) => v.owners.includes(id));
    const back = Math.min(...parts.map((v) => v.position[2] - v.size[2] / 2));
    assert.equal(back, panelFront, `${id} encosta na frente do painel`);
  }
  assert.match(text(seen[1].at(-1)!), /preso no Painel/);
  assert.equal(p.messages.at(-1)!.report?.rejected, undefined);
});

void test('place: medida dita que não cabe volta o conflito e o espaço livre, sem montar nada', async () => {
  const s = start('Nicho de 80 cm à esquerda da TV', 'painel-tv');
  const { fake, seen } = scripted([
    () => reply(call('place', { pecas: [{ ref: 'n', nome: 'Nicho largo', tipo: 'nicho', largura: 800, onde: { de: 'tv', lado: 'esquerda' } }] })),
    () => reply(call('finish', { mensagem: 'Não coube.', sugestoes: [] })),
  ]);
  await turn(s, fake);
  const result = text(seen[1].at(-1)!);
  assert.match(result, /Nada foi montado/);
  assert.match(result, /Largura livre à esquerda de TV 55" \(dentro de Painel\): 435 mm/);
});

void test('place: vão da máquina fica protegido e o aéreo vai em cima dele', () => {
  const s = scene('lavanderia-3');
  const plan = planPieces(normalize(s.design), s.room!, [
    { ref: 'maq', nome: 'Máquina de lavar', tipo: 'vao', largura: 600, altura: 850, onde: { de: 'l1', lado: 'esquerda' } },
    { ref: 'aereo', nome: 'Aéreo', tipo: 'armario', altura: 600, profundidade: 350, onde: { de: 'maq', lado: 'acima', folga: 700 } },
    { ref: 'balcao', nome: 'Balcão', tipo: 'gaveteiro', largura: 400, onde: { de: 'maq', lado: 'esquerda' } },
  ]);
  assert.ok(!('error' in plan && plan.error), JSON.stringify(plan));
  if ('error' in plan) return;
  const [maq, aereo, balcao] = plan.placed;
  assert.equal(maq.box.x1 - maq.box.x0, 600);
  assert.ok(aereo.box.y0 >= 850 + 700 && aereo.box.x0 === maq.box.x0);
  assert.ok(balcao.box.x1 <= maq.box.x0, 'o balcão fica fora do vão');
  assert.equal(plan.reserved.length, 1);
});

void test('place: peça que invade a porta volta com a largura livre de cada lado', () => {
  const s = scene('guarda-roupa-porta');
  const plan = planPieces(normalize(s.design), s.room!, [{ ref: 'sap', nome: 'Sapateira', tipo: 'armario', largura: 600, onde: { de: 'g3', lado: 'direita' } }]);
  assert.ok('error' in plan && plan.error);
  assert.match(plan.error!, /cobre porta/);
  assert.match(plan.error!, /Largura livre à direita de Coluna de portas: 30 mm/);
});

void test('modify: tirar módulos ligados e mudar a altura da bancada numa fileira compartilhada, sem contabilidade da IA', async () => {
  const s = start('Remove o rack', 'painel-rack');
  const { fake } = scripted([
    () => reply(call('modify', { remover: ['r1', 'r2', 'r3'] })),
    () => reply(call('finish', { mensagem: 'Tirei o rack; ficaram o painel e a TV.', sugestoes: [] })),
  ]);
  const r = await turn(s, fake);
  const p = get(r.projectId);
  assert.deepEqual(p.revisions[p.cursor].params.modules.map((m) => m.id), ['p']);
  assert.equal(p.messages.at(-1)!.report?.rejected, undefined, 'nenhuma recusa');

  const k = start('Bancada com 90 cm', 'cozinha-apoio');
  const { fake: f2 } = scripted([
    () => reply(call('modify', { medidas: [{ id: 'c-b3', altura_total: 900 }] })),
    () => reply(call('finish', { mensagem: 'A bancada ficou com 90 cm.', sugestoes: [] })),
  ]);
  const r2 = await turn(k, f2);
  const d = get(r2.projectId).revisions.at(-1)!.params;
  assert.deepEqual(
    d.modules.filter((m) => !m.wall).map((m) => m.height + (m.feet ?? 0)),
    [900, 900, 900, 900, 900],
  );
});

void test('interior: linhas com gavetas embaixo, prateleiras atrás de uma porta e conta que não fecha', () => {
  const ok = interiorOps('a', { width: 600, height: 2000 }, { linhas: [{ altura: 500, frente: 'gavetas', gavetas: 3 }, {}, {}] });
  assert.ok(!('error' in ok));
  const door = interiorOps('a', { width: 600, height: 2000 }, { vaos: 4, porta_inteira: 'porta' });
  assert.ok(!('error' in door) && door.ops.at(-1)!.kind === 'front.set');
  const bad = interiorOps('a', { width: 600, height: 400 }, { vaos: 5 });
  assert.ok('error' in bad && /cabem até 3 linhas/.test(bad.error), JSON.stringify(bad));
});

void test('parede: resumo com o que está fixo, o que ocupa e onde cabe no painel', () => {
  const s = scene('painel-tv');
  const sum = sceneSummary(sceneOf(normalize(s.design), s.room!));
  assert.equal(sum.fixos[0].id, 'ob-tv');
  assert.deepEqual(sum.fixos[0].x, [1285, 2515]);
  assert.deepEqual((sum.livre_nos_paineis as Record<string, Record<string, string[]>>).p['meio (900–1500)'], ['800–1255', '2545–3000']);
});
