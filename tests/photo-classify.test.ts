import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharpModule from 'sharp';
import { assets, CATEGORY_LABEL } from '../lib/assets';
import { getImage, readStoredMeta, saveImage } from '../lib/images';
import { STYLE_IDS } from '../lib/look';
import {
  ASSET_HINTS,
  classificationChips,
  classificationLine,
  imageClassification,
  MAX_TILES,
  parseAnswers,
  photoQuestions,
  SHEET_HINTS,
  SHEETS,
  STYLE_HINTS,
} from '../lib/photo-classify';
import { create, get, save, type Message } from '../lib/store';
import { DEFAULT_PRICES } from '../lib/quote';
import { runAgentTurn } from '../lib/agent/turn';
import type { ChatMessage, ModelReply } from '../lib/agent/model';

/**
 * Classificação rápida da foto (lib/photo-classify.ts), com a API de mentira:
 * as opções saem do catálogo, a resposta vira campos com confiança, fica
 * gravada com a imagem e chega à IA; sem chave ou com falha, nada muda.
 */
type SharpImage = { png(): SharpImage; metadata(): Promise<{ width?: number; height?: number; format?: string }>; toBuffer(): Promise<Buffer> };
const sharp = sharpModule as unknown as (input: Buffer | { create: { width: number; height: number; channels: 3; background: string } }) => SharpImage;

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-classify-'));
process.env.MERCE_JEV = '0';
process.env.MERCE_DEFAULT_MODEL ??= 'luna';
process.env.AI_API_KEY ??= 'teste';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

/** Resposta como a da API nas fotos do bench: guarda-roupa seguro, estilo incerto. */
const WARDROBE = {
  asset: { choice: 'guarda-roupa', confidence: 0.93, probabilities: { 'guarda-roupa': 0.93, comoda: 0.04 } },
  room: { choice: 'quarto', confidence: 0.98 },
  style: { choice: 'classic', confidence: 0.47 },
  body_material: { choice: 'wood', confidence: 0.9 },
  body_color: { choice: 'freijo', confidence: 0.74 },
  width_mm: { choice: '1800-2400', confidence: 0.61 },
  height_mm: { choice: '1800-2400', confidence: 0.7 },
  depth_mm: { choice: '500-650', confidence: 0.4 },
};

/** API de mentira: guarda cada corpo enviado e responde com `reply` (ou o status). */
function fakeApi(reply: unknown, status = 200) {
  const real = globalThis.fetch;
  const bodies: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (!String(url).includes('perplexity.ai')) return new Response('fora do teste', { status: 503 });
    bodies.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(init?.body as string) });
    return status === 200 ? Response.json(reply) : new Response('erro', { status });
  }) as typeof fetch;
  return { bodies, restore: () => (globalThis.fetch = real) };
}

async function withKey<T>(fn: () => Promise<T>) {
  const before = process.env.PERPLEXITY_API_KEY;
  process.env.PERPLEXITY_API_KEY = 'chave-de-teste';
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.PERPLEXITY_API_KEY;
    else process.env.PERPLEXITY_API_KEY = before;
  }
}

void test('classificação: as opções são os ids do catálogo, sem lista à parte', () => {
  const q = photoQuestions();
  assert.deepEqual(Object.keys(q.asset.criteria).sort(), [...assets.map((a) => a.id), 'other'].sort());
  assert.deepEqual(Object.keys(q.style.criteria).sort(), [...STYLE_IDS].sort());
  assert.deepEqual(Object.keys(q.body_color.criteria).sort(), SHEETS.map((m) => m.id).sort());
  assert.deepEqual(Object.keys(q.room.criteria).sort(), Object.keys(CATEGORY_LABEL).sort());
  // As descrições à mão só valem para o que existe no catálogo.
  for (const id of Object.keys(ASSET_HINTS)) assert.ok(assets.some((a) => a.id === id), `ativo ${id} saiu do catálogo`);
  for (const id of Object.keys(STYLE_HINTS)) assert.ok((STYLE_IDS as readonly string[]).includes(id), `estilo ${id}`);
  for (const id of Object.keys(SHEET_HINTS)) assert.ok(SHEETS.some((m) => m.id === id), `chapa ${id}`);
  for (const question of Object.values(q)) for (const text of Object.values(question.criteria)) assert.ok(text.length > 5);
  // Faixas "min-max" em mm, contínuas.
  for (const name of ['width_mm', 'height_mm', 'depth_mm']) {
    const bands = Object.keys(q[name].criteria).map((k) => k.split('-').map(Number));
    assert.equal(bands[0][0], 0);
    for (let i = 1; i < bands.length; i++) assert.equal(bands[i][0], bands[i - 1][1], `${name} contínua`);
  }
});

void test('classificação: respostas viram campos; escolha fora das opções some', () => {
  const c = parseAnswers({ ...WARDROBE, style: { choice: 'gótico', confidence: 0.9 }, room: { choice: 'quarto', confidence: 7 } });
  assert.deepEqual(c.asset, { value: 'guarda-roupa', confidence: 0.93 });
  assert.equal(c.style, undefined, 'estilo que não existe');
  assert.equal(c.room?.confidence, 1, 'confiança fica entre 0 e 1');
  assert.deepEqual(c.width?.value, { min: 1800, max: 2400 });
  assert.deepEqual(c.depth, { value: { min: 500, max: 650 }, confidence: 0.4 });
  assert.deepEqual(parseAnswers({}), {});
});

void test('classificação: o bloco da IA e os chips marcam o incerto', () => {
  const c = parseAnswers(WARDROBE);
  const line = classificationLine(c);
  assert.match(line, /ativo guarda-roupa \(93%\)/);
  assert.match(line, /estilo classic \(47%, incerto\)/);
  assert.match(line, /cor do corpo freijo \(74%\)/);
  assert.doesNotMatch(line, /corpo madeira/, 'madeira ou liso só confere a cor');
  assert.match(line, /largura 1800–2400 mm \(61%\)/);
  assert.match(line, /profundidade 500–650 mm \(40%, incerto\)/);
  assert.equal(classificationLine(null), '');
  const chips = classificationChips(c);
  assert.deepEqual(
    chips.map((v) => [v.label, v.sure]),
    [
      ['Guarda-roupa', true],
      ['Quarto', true],
      ['Clássico', false],
      ['Freijó', true],
      ['180–240 × 180–240 × 50–65 cm', false],
    ],
  );
  assert.match(chips[0].title, /93% de confiança/);
  // Cor que contradiz o acabamento seguro (madeira com cor lisa) não vale como certa.
  const odd = parseAnswers({ ...WARDROBE, body_color: { choice: 'white', confidence: 0.8 } });
  assert.match(classificationLine(odd), /cor do corpo white \(80%, incerto\)/);
  // "Nenhum" não vira chip de móvel.
  const other = classificationChips(parseAnswers({ asset: { choice: 'other', confidence: 0.9 } }));
  assert.deepEqual(other, []);
  assert.deepEqual(classificationChips(parseAnswers({ width_mm: { choice: '0-600', confidence: 0.9 }, height_mm: { choice: '500-900', confidence: 0.9 }, depth_mm: { choice: '0-250', confidence: 0.9 } })).map((v) => v.label), ['até 60 × 50–90 × até 25 cm']);
});

void test('classificação: uma chamada por foto, no formato da API, gravada com a imagem', async () => {
  const api = fakeApi({ answers: WARDROBE });
  try {
    await withKey(async () => {
      const image = await saveImage(PNG, 'guarda-roupa.png');
      const [a, b] = await Promise.all([imageClassification(image.id), imageClassification(image.id)]);
      assert.equal(a?.asset?.value, 'guarda-roupa');
      assert.deepEqual(a, b);
      assert.equal(api.bodies.length, 1, 'os dois pedidos esperam a mesma chamada');
      const sent = api.bodies[0];
      assert.equal(sent.url, 'https://api.perplexity.ai/v1/decisions');
      assert.equal(sent.auth, 'Bearer chave-de-teste');
      assert.equal(sent.body.model, 'pplx-decider-v1-27b');
      const state = sent.body.state as { type: string; text?: string; image_url?: { url: string } }[];
      assert.equal(state[0].type, 'text');
      assert.match(state[0].text!, /main furniture piece/);
      assert.match(state[1].image_url!.url, /^data:image\/jpeg;base64,/);
      assert.deepEqual(Object.keys(sent.body.questions as object), ['asset', 'room', 'style', 'body_material', 'body_color', 'width_mm', 'height_mm', 'depth_mm']);
      // Gravada: a próxima vem da metadata, sem chamar a API.
      assert.equal((JSON.parse(await readStoredMeta(image.id)) as { classification: unknown }).classification !== undefined, true);
      await imageClassification(image.id);
      assert.equal(api.bodies.length, 1);
      // A referência que vai para a conversa fica só com id, nome e url.
      assert.deepEqual(Object.keys(await getImage(image.id)).sort(), ['id', 'name', 'url']);
    });
  } finally {
    api.restore();
  }
});

void test('classificação: foto grande é reduzida para caber nos ladrilhos da API', async () => {
  const api = fakeApi({ answers: WARDROBE });
  try {
    await withKey(async () => {
      const big = await sharp({ create: { width: 1600, height: 1600, channels: 3, background: '#a9773f' } }).png().toBuffer();
      const image = await saveImage(big, 'quadrada.png');
      await imageClassification(image.id);
      const url = (api.bodies[0].body.state as { image_url?: { url: string } }[])[1].image_url!.url;
      const meta = await sharp(Buffer.from(url.split(',')[1], 'base64')).metadata();
      const tiles = Math.ceil(meta.width! / 32) * Math.ceil(meta.height! / 32);
      assert.ok(tiles <= 2048, `${meta.width}×${meta.height} = ${tiles} ladrilhos`);
      assert.ok(tiles >= MAX_TILES * 0.9, 'sem reduzir à toa');
      assert.equal(meta.format, 'jpeg');
    });
  } finally {
    api.restore();
  }
});

void test('classificação: sem chave, com erro ou com resposta vazia, devolve null', async () => {
  const image = await saveImage(PNG, 'sem-chave.png');
  const api = fakeApi({ answers: WARDROBE });
  try {
    delete process.env.PERPLEXITY_API_KEY;
    assert.equal(await imageClassification(image.id), null);
    assert.equal(api.bodies.length, 0, 'sem chave, nenhuma chamada');
  } finally {
    api.restore();
  }
  const down = fakeApi({}, 500);
  try {
    await withKey(async () => {
      const failed = await saveImage(PNG, 'erro.png');
      assert.equal(await imageClassification(failed.id), null);
      assert.equal(await imageClassification(failed.id), null);
      assert.equal(down.bodies.length, 1, 'foto que falhou não tenta de novo');
    });
  } finally {
    down.restore();
  }
  const empty = fakeApi({ answers: { asset: { choice: 'sofá', confidence: 0.9 } } });
  try {
    await withKey(async () => assert.equal(await imageClassification((await saveImage(PNG, 'vazia.png')).id), null));
  } finally {
    empty.restore();
  }
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }) as typeof fetch;
  try {
    await withKey(async () => assert.equal(await imageClassification((await saveImage(PNG, 'demora.png')).id), null));
  } finally {
    globalThis.fetch = real;
  }
});

let n = 0;
/** Pedido com foto num projeto novo; devolve a primeira mensagem que a IA recebe. */
async function photoTurnPrompt() {
  const p = get(create().id);
  const image = await saveImage(PNG, 'foto.png');
  const rev = p.revisions[p.cursor];
  const user: Message = {
    id: `u${++n}`,
    role: 'user',
    content: 'Quero um guarda-roupa igual a esse.',
    image,
    revisionId: rev.id,
    revision: rev.number,
    context: { requestId: `r${n}`, baseRevisionId: rev.id, selectedPartIds: [], referencedPartIds: [] },
  };
  p.messages.push(user);
  const version = save(p, p.version).version;
  const seen: ChatMessage[][] = [];
  const fake = async (o: { messages: ChatMessage[] }): Promise<ModelReply> => {
    seen.push(structuredClone(o.messages));
    return { content: '', calls: [{ id: `c${++n}`, type: 'function', function: { name: 'finish', arguments: JSON.stringify({ mensagem: 'Pronto.' }) } }], finish: 'tool_calls' };
  };
  const traced: { kind: string; data: unknown }[] = [];
  await runAgentTurn({
    project: p,
    version,
    user,
    request: user.content,
    selected: [],
    ui: null,
    prices: structuredClone(DEFAULT_PRICES),
    image,
    model: 'deepseek',
    requestId: user.context!.requestId,
    started: Date.now(),
    signal: new AbortController().signal,
    progress: () => {},
    emit: () => {},
    onUsage: () => {},
    usage: () => ({}),
    call: fake as never,
    trace: { file: null, write: (kind, data) => void traced.push({ kind, data }) },
  });
  const parts = seen[0].find((m) => m.role === 'user')!.content as Exclude<ChatMessage['content'], string | null>;
  return { text: (parts.find((v) => v.type === 'text') as { text: string }).text, traced };
}

void test('turno com foto: a IA recebe a classificação e como usá-la', async () => {
  const api = fakeApi({ answers: WARDROBE });
  try {
    const { text, traced } = await withKey(photoTurnPrompt);
    assert.match(text, /Foto de referência \(Imagem 1\)/);
    assert.match(text, /Classificação rápida da foto .*ativo guarda-roupa \(93%\).*estilo classic \(47%, incerto\)/);
    assert.match(text, /Ativo seguro: é o tipo do móvel/);
    assert.match(text, /Pedido da parede ou do ambiente \(passo 3\).*monte com place/, 'parede não começa por ativo');
    const event = traced.find((v) => v.kind === 'photo.classification');
    assert.ok(event, 'o registro do pedido guarda a classificação');
  } finally {
    api.restore();
  }
});

void test('turno com foto: sem classificação a mensagem é a de antes', async () => {
  const api = fakeApi({}, 503);
  try {
    const { text } = await withKey(photoTurnPrompt);
    assert.match(text, /Foto de referência \(Imagem 1\)/);
    assert.doesNotMatch(text, /Classificação rápida/);
    assert.doesNotMatch(text, /Ativo seguro/);
  } finally {
    api.restore();
  }
});
