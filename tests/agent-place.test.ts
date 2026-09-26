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

void test('prateleira de parede: tábua horizontal presa na parede, com limites próprios e sem compartimentos', async () => {
  const { executeRequest } = await import('../lib/studio');
  const base = normalize(scene('painel-tv').design);
  const ok = executeRequest(base, [
    { kind: 'module.add', id: 'pp', preset: 'ledge', name: 'Prateleira' },
    { kind: 'module.edit', id: 'pp', width: 900, height: 30, depth: 280, position: [0, 700, 12.5 + 140] },
  ]);
  assert.ok(ok.ok, !ok.ok ? ok.error : '');
  if (!ok.ok) return;
  const board = generateDesign(ok.design).parts.find((p) => p.id === 'pp:ledge')!;
  assert.equal(board.kind, 'shelf');
  assert.deepEqual([board.c, board.l, board.thickness], [900, 280, 30], 'corta como tábua: comprimento × fundo × espessura');
  const thick = executeRequest(ok.design, [{ kind: 'module.edit', id: 'pp', height: 80 }]);
  assert.ok(!thick.ok && /15 a 60 mm de espessura/.test(thick.error));
  const split = executeRequest(ok.design, [{ kind: 'cell.split', id: 'pp:root', axis: 'y' }]);
  assert.ok(!split.ok && /prateleira de parede: não tem compartimentos/.test(split.error));
  const box = executeRequest(base, [{ kind: 'module.add', id: 'b', preset: 'niche' }, { kind: 'module.edit', id: 'b', height: 60 }]);
  assert.ok(!box.ok && /Altura: 200 a 2400/.test(box.error), 'caixa continua com 200 mm de altura mínima');
});

void test('place: prateleira sobre a TV fica fora da folga da tela; na frente dela é conflito', () => {
  const s = scene('painel-tv');
  const d = normalize(s.design);
  const above = planPieces(d, s.room!, [{ ref: 'topo', nome: 'Prateleira', tipo: 'prateleira', onde: { de: 'tv', lado: 'acima', folga: 0 } }]);
  assert.ok('error' in above && /tapa TV|encosta na tela|passa|teto|painel/.test(above.error!), 'colada na TV: dentro da folga');
  const front = planPieces(d, s.room!, [{ ref: 'f', nome: 'Prateleira', tipo: 'prateleira', largura: 600, onde: { x: 1600, y: 1400 } }]);
  assert.ok('error' in front && /tapa TV/.test(front.error!));
  const side = planPieces(d, s.room!, [{ ref: 's', nome: 'Prateleira', tipo: 'prateleira', onde: { de: 'tv', lado: 'esquerda' } }]);
  assert.ok(!('error' in side && side.error), JSON.stringify(side));
});

void test('place: peça encostada num módulo fica ligada a ele (ao lado, em cima e em cadeia no mesmo lote)', async () => {
  const { executeRequest, migrateParams } = await import('../lib/studio');
  const { defaults } = await import('../lib/furniture');
  const d = migrateParams(defaults);
  const plan = planPieces(d, undefined, [
    { ref: 'n1', nome: 'Nicho 1', tipo: 'nicho', onde: { de: 'module-1', lado: 'direita' } },
    { ref: 'n2', nome: 'Nicho 2', tipo: 'nicho', onde: { de: 'n1', lado: 'direita' } },
    { ref: 'topo', nome: 'Nicho de cima', tipo: 'nicho', onde: { de: 'module-1', lado: 'acima' } },
  ]);
  assert.ok(!('error' in plan && plan.error), JSON.stringify(plan));
  if ('error' in plan) return;
  const r = executeRequest(d, plan.ops);
  assert.ok(r.ok, !r.ok ? r.error : '');
  if (!r.ok) return;
  assert.deepEqual(
    r.design.connections.map((c) => `${c.parent}>${c.child}:${c.side}`),
    ['module-1>n1:right', 'n1>n2:right', 'module-1>topo:top'],
  );
  // Com folga não encosta: fica solta.
  const loose = planPieces(d, undefined, [{ ref: 'n', nome: 'Nicho', tipo: 'nicho', onde: { de: 'module-1', lado: 'direita', folga: 100 } }]);
  assert.ok(!('error' in loose && loose.error));
  if ('error' in loose) return;
  assert.ok(!loose.ops.some((o) => o.kind === 'connect'));
});

void test('place: peça de piso na frente de um painel que começa acima do chão fica em pé na frente dele', () => {
  const s = scene('painel-tv');
  const d = normalize(s.design);
  // O painel vai de 50 a 1850 mm do piso: um balcão no chão cobre só a parte de baixo dele.
  const plan = planPieces(d, s.room!, [{ ref: 'b', nome: 'Balcão', tipo: 'gaveteiro', largura: 800, altura: 500, profundidade: 400, onde: { x: 900, y: 0 } }]);
  assert.ok(!('error' in plan && plan.error), JSON.stringify(plan));
  if ('error' in plan) return;
  assert.equal(plan.placed[0].box.d0, 12.5 + 12.5, 'o fundo encosta na frente do painel');
});

void test('place: campos opcionais preenchidos com zero não mandam a peça para o canto do piso', async () => {
  const { pieceSchema } = await import('../lib/agent/place');
  const s = scene('painel-tv');
  const d = normalize(s.design);
  // Como a IA manda: tudo preenchido, x e y zerados, porta inteira escolhida à toa.
  const piece = pieceSchema.parse({
    ref: 'console',
    nome: 'Console\u0000 suspenso',
    tipo: 'gaveteiro',
    largura: 1200,
    altura: 300,
    profundidade: 350,
    pes: 0,
    material: 'walnut',
    interior: { linhas: [{ altura: 280, colunas: 1, frente: 'gavetas', gavetas: 3 }], vaos: 1, colunas: 1, frente: 'gavetas', gavetas: 3, porta_inteira: 'porta' },
    onde: { de: 'ob-tv', lado: 'abaixo', folga: 50, alinhar: 'centro', x: 0, y: 0 },
  });
  assert.equal(piece.nome, 'Console suspenso', 'caractere de controle sai do nome');
  const plan = planPieces(d, s.room!, [piece]);
  assert.ok(!('error' in plan && plan.error), JSON.stringify(plan));
  if ('error' in plan) return;
  const b = plan.placed[0].box;
  assert.equal(b.y1, 1110 - 50, 'embaixo da TV, com a folga');
  assert.equal((b.x0 + b.x1) / 2, (1285 + 2515) / 2, 'centrado na TV');
  assert.ok(plan.ops.some((o) => o.kind === 'front.set' && o.type === 'drawers'));
  assert.ok(!plan.ops.some((o) => o.kind === 'front.set' && o.type !== 'drawers'), 'porta inteira não cobre as gavetas');
  assert.match(plan.placed[0].notes.join(' '), /porta inteira ignorada/);
});

void test('modify mover: mexer num módulo da fileira leva o conjunto, como o arrasto; sozinho solta', async () => {
  const { planModify } = await import('../lib/agent/modify');
  const { executeRequest } = await import('../lib/studio');
  const d = normalize(scene('cozinha-baguncada').design);
  const plan = planModify(d, undefined, { mover: [{ id: 'c-a3', onde: { y: 1500 } }, { id: 'c-a5', onde: { y: 1500 } }] });
  assert.ok(!('error' in plan), JSON.stringify(plan));
  if ('error' in plan) return;
  const r = executeRequest(d, plan.ops);
  assert.ok(r.ok, !r.ok ? r.error : '');
  if (!r.ok) return;
  const uppers = r.design.modules.filter((m) => m.wall);
  assert.deepEqual([...new Set(uppers.map((m) => m.position[1]))], [1500], 'a fileira inteira de aéreos desceu junta');
  assert.equal(r.design.connections.length, d.connections.length, 'nenhuma conexão desfeita');
  assert.match(plan.lines.join(' '), /anda junto com o conjunto já movido/);
  const alone = planModify(d, undefined, { mover: [{ id: 'apoio-cozinha-a2', onde: { x: 6000, y: 0 }, sozinho: true }] });
  assert.ok(!('error' in alone) && alone.ops.some((o) => o.kind === 'disconnect'));
  const none = planModify(d, undefined, { remover: [], mover: [], medidas: [], interior: [] });
  assert.ok('error' in none, 'nada pedido continua sendo erro de uso');
});

void test('place: substituir troca o móvel inteiro pelas peças, no lugar dele, e o que saiu não bloqueia', async () => {
  const { executeRequest, migrateParams } = await import('../lib/studio');
  const { defaults } = await import('../lib/furniture');
  const d = migrateParams(defaults);
  // Uma cômoda de duas colunas onde estava a estante de partida: sem a troca,
  // a primeira peça bateria na estante que ocupa o mesmo lugar.
  const plan = planPieces(
    d,
    undefined,
    [
      { ref: 'gav', nome: 'Gavetas', tipo: 'gaveteiro', largura: 770, altura: 880, profundidade: 450, pes: 50, interior: { linhas: [{ frente: 'gavetas', gavetas: 4 }, { altura: 150, frente: 'aberto' }] }, onde: { x: 0, y: 0 } },
      { ref: 'porta', nome: 'Porta', tipo: 'armario', largura: 330, interior: { linhas: [{ altura: 520, frente: 'porta' }, { frente: 'gavetas', gavetas: 2 }] }, onde: { de: 'gav', lado: 'direita' } },
    ],
    true,
  );
  assert.ok(!('error' in plan && plan.error), JSON.stringify(plan));
  if ('error' in plan) return;
  const r = executeRequest(d, plan.ops);
  assert.ok(r.ok, !r.ok ? r.error : '');
  if (!r.ok) return;
  assert.deepEqual(r.design.modules.map((m) => m.id).sort(), ['gav', 'porta']);
  // Dois corpos do mesmo móvel, mesma altura, pés e acabamento: um painel só entre eles.
  assert.deepEqual(r.design.connections.map((c) => [c.parent, c.child, c.shared]), [['gav', 'porta', true]]);
  const fronts = generateDesign(r.design).parts.filter((p) => p.kind === 'door' || (p.kind === 'drawer' && /Frente gaveta/.test(p.name)));
  assert.equal(fronts.filter((p) => p.kind === 'drawer').length, 6);
  assert.equal(fronts.filter((p) => p.kind === 'door').length, 1);
});

void test('place: painel de parede vai atrás da TV já marcada; prateleira na frente da tela continua recusada', () => {
  const s = scene('parede-tv');
  const d = normalize(s.design);
  const tv = s.room!.obstacles!.find((o) => o.kind === 'tv')!;
  const x = tv.xMm - 200;
  const panel = planPieces(d, s.room!, [{ ref: 'painel', nome: 'Painel', tipo: 'painel', largura: tv.widthMm + 400, altura: 1400, profundidade: 25, onde: { x, y: tv.yMm - 400 } }]);
  assert.ok(!('error' in panel && panel.error), JSON.stringify('error' in panel ? panel.error : ''));
  const shelf = planPieces(d, s.room!, [{ ref: 'p', nome: 'Prateleira', tipo: 'prateleira', largura: 600, onde: { x: tv.xMm + 100, y: tv.yMm + 100 } }]);
  assert.ok('error' in shelf && /tapa/.test(shelf.error ?? ''), 'a prateleira na frente da tela é recusada');
});

void test('place: pé abaixo do mínimo vira 50 mm com aviso, em vez de recusar a peça', async () => {
  const { migrateParams } = await import('../lib/studio');
  const { defaults } = await import('../lib/furniture');
  const d = migrateParams(defaults);
  const plan = planPieces(d, undefined, [{ ref: 'g', nome: 'Gaveteiro', tipo: 'gaveteiro', pes: 30, onde: { de: 'module-1', lado: 'direita' } }]);
  assert.ok(!('error' in plan && plan.error), JSON.stringify(plan));
  if ('error' in plan) return;
  assert.equal(plan.placed[0].feet, 50);
  assert.match(plan.placed[0].notes.join(' '), /30 mm viraram 50 mm/);
});

void test('modify: tirar todos os módulos devolve o caminho da troca (place com substituir), sem mudar nada', async () => {
  const s = start('troca tudo por um guarda-roupa', 'parede-tv');
  const ids = s.p.revisions[s.p.cursor].params.modules.map((m) => m.id);
  const { fake, seen } = scripted([() => reply(call('modify', { remover: ids })), () => reply(call('finish', { mensagem: 'Não troquei nada.' }))]);
  await turn(s, fake);
  const result = seen[1].filter((m) => m.role === 'tool').map((m) => String(m.content)).join(' ');
  assert.match(result, /substituir:true/);
  assert.equal(get(s.p.id).revisions.length, s.p.revisions.length, 'nada foi gravado');
});

void test('place: painel atrás só da borda da TV é recusado já no place, com o centro da tela', () => {
  const s = scene('parede-tv');
  const d = normalize(s.design);
  const tv = s.room!.obstacles!.find((o) => o.kind === 'tv')!;
  const plan = planPieces(d, s.room!, [{ ref: 'painel', nome: 'Painel', tipo: 'painel', largura: 500, altura: 1400, profundidade: 25, onde: { x: tv.xMm - 300, y: tv.yMm - 400 } }]);
  assert.ok('error' in plan && /centro da tela/.test(plan.error ?? ''), JSON.stringify(plan));
});

void test('room_obstacles: no projeto de partida a estante que vai sair não empurra a porta da foto', async () => {
  const p = get(create().id);
  const user: Message = {
    id: `u${++n}`,
    role: 'user',
    content: 'monte essa parede da foto',
    revisionId: p.revisions[0].id,
    revision: 1,
    context: { requestId: `r${n}`, baseRevisionId: p.revisions[0].id, selectedPartIds: [], referencedPartIds: [] },
  };
  p.messages.push(user);
  const s = { p, user, version: save(p, p.version).version };
  const { fake, seen } = scripted([
    () =>
      reply(
        call('room_set', { largura: 3200, altura: 2600 }),
        call('room_obstacles', { add: [{ kind: 'door', xMm: 100, yMm: 0, widthMm: 800, heightMm: 2100 }] }),
      ),
    () => reply(call('finish', { mensagem: 'Marquei a parede.' })),
  ]);
  await turn(s, fake);
  const results = seen[1].filter((m) => m.role === 'tool').map((m) => String(m.content)).join(' ');
  assert.doesNotMatch(results, /Não coube|Não cabe|Ajustei para um lugar livre/, results);
  const door = get(p.id).room?.obstacles?.find((o) => o.kind === 'door');
  assert.equal(door?.xMm, 100, 'a porta fica onde a foto mostra');
});

void test('place: painel, rack e prateleira da TV no mesmo lote: o rack fica preso na frente do painel do lote', async () => {
  const s = scene('parede-tv');
  const room = { ...s.room!, obstacles: s.room!.obstacles!.filter((o) => o.kind === 'tv') };
  // Parede sem os módulos da cena: só a TV, como na foto da sala.
  const { migrateParams } = await import('../lib/studio');
  const { defaults } = await import('../lib/furniture');
  const d = migrateParams(defaults);
  const tv = room.obstacles.find((o) => o.kind === 'tv')!;
  const plan = planPieces(
    d,
    { ...room, offsetMm: 2800 },
    [
      { ref: 'painel', nome: 'Painel', tipo: 'painel', largura: 1700, altura: 1600, profundidade: 25, onde: { x: tv.xMm - 235, y: 300 } },
      { ref: 'rack', nome: 'Rack', tipo: 'gaveteiro', largura: 1600, altura: 300, profundidade: 400, interior: { colunas: 2, frente: 'gavetas', gavetas: 1 }, onde: { de: 'tv', lado: 'abaixo', y: 400 } },
    ],
  );
  assert.ok(!('error' in plan && plan.error), JSON.stringify('error' in plan ? plan.error : ''));
  if ('error' in plan) return;
  const rack = plan.placed.find((p) => p.ref === 'rack')!;
  assert.equal(rack.box.d0, 25, 'o rack encosta na frente do painel');
  assert.match(rack.surface, /Painel/);
});

void test('place: peça larga que vira dois módulos divide as colunas do conjunto (3 nichos, não 6)', async () => {
  const { executeRequest, migrateParams } = await import('../lib/studio');
  const { defaults } = await import('../lib/furniture');
  const d = migrateParams(defaults);
  const plan = planPieces(d, undefined, [{ ref: 'n', nome: 'Nichos', tipo: 'nicho', largura: 1400, altura: 220, profundidade: 250, interior: { colunas: 3 }, onde: { x: 0, y: 1500 } }], true);
  assert.ok(!('error' in plan && plan.error), JSON.stringify(plan));
  if ('error' in plan) return;
  const r = executeRequest(d, plan.ops);
  assert.ok(r.ok, !r.ok ? r.error : '');
  if (!r.ok) return;
  const open = generateDesign(r.design).cells.filter((c) => !c.node.split && !c.node.front);
  assert.equal(open.length, 3);
  const w = open.map((c) => Math.round(c.size[0]));
  assert.ok(Math.max(...w) - Math.min(...w) <= 12, `vãos iguais: ${w.join(", ")}`);
});

void test('place: o resultado conta as frentes montadas (porta_dupla em 4 colunas são 16 folhas)', async () => {
  const { migrateParams } = await import('../lib/studio');
  const { defaults } = await import('../lib/furniture');
  const d = migrateParams(defaults);
  const plan = planPieces(
    d,
    undefined,
    [{ ref: 'g', nome: 'Guarda-roupa', tipo: 'armario', largura: 1600, altura: 2200, profundidade: 550, interior: { linhas: [{ altura: 1300, colunas: 4, frente: 'porta_dupla' }, { colunas: 4, frente: 'porta_dupla' }] }, onde: { x: 0, y: 0 } }],
    true,
  );
  assert.ok(!('error' in plan && plan.error), JSON.stringify(plan));
  if ('error' in plan) return;
  assert.match(plan.placed[0].notes.join(' '), /frente: 16 folhas de porta, 0 gavetas, 0 vãos abertos/);
});
