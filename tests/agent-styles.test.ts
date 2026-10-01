import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create, get, revise, save, type Message } from '../lib/store';
import { DEFAULT_PRICES } from '../lib/quote';
import { runAgentTurn } from '../lib/agent/turn';
import { AGENT_SYSTEM } from '../lib/agent/prompt';
import { designSnapshot } from '../lib/agent/snapshot';
import { assetById, buildAsset } from '../lib/assets';
import { normalize, type Design } from '../lib/studio';
import { STYLES } from '../lib/styles';
import type { ChatMessage, ModelReply, ToolCall } from '../lib/agent/model';

/**
 * A IA e os estilos: o prompt conhece os estilos, as mesas e as frentes
 * novas; o estado mostra o estilo e o acabamento; peça nova num projeto com
 * estilo sai vestida nele sem a IA repetir o estilo.
 */
process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-styles-'));
process.env.MERCE_JEV = '0';

let n = 0;
const call = (name: string, args: unknown): ToolCall => ({ id: `c${++n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = (...calls: ToolCall[]): ModelReply => ({ content: '', calls, finish: 'tool_calls' });
function scripted(steps: (() => ModelReply)[]) {
  const seen: ChatMessage[][] = [];
  let i = 0;
  const fake = async (o: { messages: ChatMessage[] }) => {
    seen.push(structuredClone(o.messages));
    return steps[Math.min(i++, steps.length - 1)]();
  };
  return { fake, seen };
}
function start(request: string, design: Design) {
  const p = get(create().id);
  revise(p, design, 'cena');
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

void test('o prompt conhece os estilos, as mesas e as frentes novas, e não diz mais que não existem', () => {
  for (const s of Object.values(STYLES)) assert.ok(AGENT_SYSTEM.includes(`- ${s.id}: ${s.name}`), s.id);
  assert.match(AGENT_SYSTEM, /style\.apply/);
  assert.match(AGENT_SYSTEM, /preset "table"/);
  assert.match(AGENT_SYSTEM, /sliding \(porta de correr/);
  assert.doesNotMatch(AGENT_SYSTEM, /Não existe vidro/);
  assert.doesNotMatch(AGENT_SYSTEM, /portas de correr ou basculantes, tampo avulso, mesa/);
});

void test('o estado mostra o estilo do projeto e o acabamento de cada módulo', () => {
  const d = normalize(buildAsset(assetById('aparador')!, { style: 'midcentury' }));
  const snap = designSnapshot(d, undefined);
  assert.equal(snap.estilo, 'midcentury');
  assert.match(String(snap.modulos[0].acabamento), /pé inclinado/);
  const table = normalize(buildAsset(assetById('console')!));
  assert.equal(designSnapshot(table, undefined).modulos[0].niveis, 1);
});

void test('peça nova num projeto com estilo sai vestida nele, sem a IA repetir o estilo', async () => {
  const s = start('Põe um nicho ao lado', normalize(buildAsset(assetById('aparador')!, { style: 'industrial' })));
  const { fake } = scripted([
    () => reply(call('place', { pecas: [{ ref: 'n', nome: 'Nicho', tipo: 'nicho', onde: { de: 'a3', lado: 'direita' } }] })),
    () => reply(call('finish', { mensagem: 'Pus um nicho à direita.', sugestoes: [] })),
  ]);
  const r = await turn(s, fake);
  const p = get(r.projectId);
  const d = p.revisions[p.cursor].params;
  const added = d.modules.find((m) => m.id === 'n')!;
  assert.ok(added, 'nicho entrou');
  assert.equal(added.look?.frame, true);
  assert.equal(added.look?.legs, 'tube');
  assert.equal(d.style, 'industrial');
});
