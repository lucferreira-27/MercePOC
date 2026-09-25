import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEvents } from '../lib/sse';
import { defaults } from '../lib/furniture';
import {
  describeHighlights,
  executeRequest,
  migrateParams,
  normalize,
  type ShelfOp,
} from '../lib/studio';
import {
  PROFILE,
  applyModularOp,
  preset,
  type Composition,
  type ModularOp,
} from '../lib/composition';
import { create, get } from '../lib/store';
import { POST } from '../app/api/chat/route';
// Estes testes cobrem o caminho antigo (uma resposta JSON); o laço tem os seus.
process.env.MERCE_AGENT = '0';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-highlights-'));
process.env.AI_API_KEY = 'test-key';

const legacy = () => normalize(migrateParams(defaults));
const nicho = (): Composition => {
  const m = preset('niche', 'a');
  m.width = 800;
  m.height = 1800;
  m.depth = 350;
  return { schemaVersion: 3, profile: PROFILE, modules: [m], connections: [] };
};
const design = (c: Composition) => normalize(c);
/** Roda o lote e devolve os cartões derivados do resultado. */
function cards(before: ReturnType<typeof legacy>, ops: ShelfOp[]) {
  const preview = executeRequest(before, ops);
  if (!preview.ok) throw new Error(preview.error);
  return describeHighlights(before, preview.design, ops);
}

void test('nicho adicionado à direita vira um cartão com medidas e posição', () => {
  const before = legacy();
  const cartoes = cards(before, [
    { kind: 'module.add', id: 'nicho', preset: 'niche', name: 'Nicho' },
    { kind: 'module.edit', id: 'nicho', width: 800, height: 600, depth: 450 },
    {
      kind: 'connect',
      parent: 'module-1',
      child: 'nicho',
      side: 'right',
      shared: false,
      align: 'front',
      offset: 0,
    },
  ]);
  // A conexão do módulo que acabou de entrar é contada no cartão dele: um
  // cartão, não dois.
  assert.equal(cartoes.length, 1);
  const [cartao] = cartoes;
  assert.equal(cartao.title, 'Nicho adicionado');
  assert.match(cartao.summary, /800 × 600 × 450 mm/);
  assert.match(cartao.summary, /à direita de Estante/);
  assert.match(cartao.summary, /alinhado pela frente/);
  assert.deepEqual(cartao.measures, [
    { label: 'Largura', value: '800 mm' },
    { label: 'Altura', value: '600 mm' },
    { label: 'Profundidade', value: '450 mm' },
  ]);
  assert.deepEqual(cartao.size, [800, 600, 450]);
  const fato = (rotulo: string) => cartao.facts?.find((f) => f.label === rotulo)?.value;
  assert.equal(fato('Posição'), 'à direita de Estante');
  assert.equal(fato('Alinhamento'), 'alinhado pela frente');
  assert.equal(fato('Acabamento'), 'Carvalho natural');
});

void test('conexão com laterais compartilhadas aparece no cartão do módulo novo', () => {
  const before = legacy();
  const cartoes = cards(before, [
    { kind: 'module.add', id: 'nicho', preset: 'niche', name: 'Nicho' },
    {
      kind: 'connect',
      parent: 'module-1',
      child: 'nicho',
      side: 'right',
      shared: true,
      align: 'front',
      offset: 0,
    },
  ]);
  assert.equal(cartoes.length, 1);
  assert.equal(
    cartoes[0].facts?.find((f) => f.label === 'Laterais')?.value,
    'compartilhadas com o vizinho',
  );
});

void test('conectar dois módulos que já existiam vira cartão próprio', () => {
  const before = legacy();
  const cartoes = cards(before, [
    { kind: 'module.add', id: 'nicho', preset: 'niche', name: 'Nicho' },
    {
      kind: 'connect',
      parent: 'module-1',
      child: 'nicho',
      side: 'right',
      shared: false,
      align: 'back',
      offset: 20,
    },
  ]);
  // Com `align: back` e afastamento, o cartão do módulo já diz isso.
  assert.equal(cartoes.length, 1);
  assert.equal(
    cartoes[0].facts?.find((f) => f.label === 'Alinhamento')?.value,
    'alinhado pelos fundos',
  );
  assert.equal(cartoes[0].facts?.find((f) => f.label === 'Afastamento')?.value, '20 mm');
});

void test('frente e divisão viram cartões com o vão e a quantidade certos', () => {
  const before = design(nicho());
  const ops: ModularOp[] = [
    { kind: 'cell.split', id: 'a:root', axis: 'y', gapMm: 400 },
    { kind: 'front.set', id: 'a:root:low', type: 'drawers', count: 3 },
  ];
  let after = before;
  for (const op of ops) after = design(applyModularOp(after, op));
  const cartoes = describeHighlights(before, after, ops);
  assert.deepEqual(
    cartoes.map((c) => c.title),
    ['Vão dividido em duas alturas', '3 gavetas colocadas'],
  );
  // Um cartão por tipo de mudança, com o vão de cada alvo na linha.
  assert.match(cartoes[0].summary, /separou o vão em duas alturas/);
  assert.deepEqual(cartoes[0].rows?.[0].parts, [400, 1346]);
  assert.match(cartoes[1].summary, /cobre o vão de .*compartimento/);
});

void test('divisões repetidas no mesmo lote viram um cartão com uma linha por vão', () => {
  const before = design(nicho());
  const ops: ModularOp[] = [
    { kind: 'cell.split', id: 'a:root', axis: 'y', gapMm: 450 },
    { kind: 'cell.split', id: 'a:root:high', axis: 'y', gapMm: 450 },
    { kind: 'cell.split', id: 'a:root:high:high', axis: 'y', gapMm: 450 },
  ];
  let after = before;
  for (const op of ops) after = design(applyModularOp(after, op));
  const cartoes = describeHighlights(before, after, ops);
  assert.equal(cartoes.length, 1, 'um cartão, não três');
  const [cartao] = cartoes;
  assert.equal(cartao.title, '3 vãos divididos em duas alturas');
  assert.equal(cartao.rows?.length, 3);
  // Cada linha traz a medida própria: é o que diferencia um vão do outro.
  const valores = (cartao.rows ?? []).map((r) => r.value);
  assert.equal(new Set(valores).size, 3, valores.join(' | '));
  for (const row of cartao.rows ?? []) {
    assert.equal(row.parts?.length, 2);
    assert.equal(row.parts?.[0], 450, 'o vão escolhido se repete');
    assert.ok((row.parts?.[1] ?? 0) > 0);
  }
  const sobras = (cartao.rows ?? []).map((r) => r.parts?.[1] ?? 0);
  assert.deepEqual(
    sobras,
    [...sobras].sort((a, b) => b - a),
    'a sobra diminui conforme o vão desce',
  );
});

void test('frentes iguais em vãos diferentes agrupam, frentes distintas não', () => {
  const before = design(nicho());
  const abertura: ModularOp[] = [
    { kind: 'cell.split', id: 'a:root', axis: 'y', gapMm: 600 },
    { kind: 'cell.split', id: 'a:root:high', axis: 'y', gapMm: 400 },
  ];
  let depois = before;
  for (const op of abertura) depois = design(applyModularOp(depois, op));
  const portas: ModularOp[] = [
    { kind: 'front.set', id: 'a:root:low', type: 'single', hinge: 'left' },
    { kind: 'front.set', id: 'a:root:high:low', type: 'single', hinge: 'left' },
  ];
  let comPortas = depois;
  for (const op of portas) comPortas = design(applyModularOp(comPortas, op));
  const iguais = describeHighlights(depois, comPortas, portas);
  assert.equal(iguais.length, 1, 'duas portas iguais viram um cartão');
  assert.equal(iguais[0].rows?.length, 2);
  assert.match(iguais[0].title, /Porta em 2 vãos/);

  const gavetas: ModularOp[] = [
    { kind: 'front.set', id: 'a:root:low', type: 'drawers', count: 3 },
    { kind: 'front.set', id: 'a:root:high:high', type: 'drawers', count: 2 },
  ];
  let comGavetas = depois;
  for (const op of gavetas) comGavetas = design(applyModularOp(comGavetas, op));
  const diferentes = describeHighlights(depois, comGavetas, gavetas);
  assert.equal(diferentes.length, 2, 'gaveteiros diferentes não se agrupam');
});

void test('remover módulo e ajustar medidas também rendem cartão', () => {
  const before = legacy();
  const comNicho = cards(before, [
    { kind: 'module.add', id: 'nicho', preset: 'niche', name: 'Nicho' },
  ]);
  assert.equal(comNicho[0].title, 'Nicho adicionado');
  const comDois = executeRequest(before, [
    { kind: 'module.add', id: 'nicho', preset: 'niche', name: 'Nicho' },
  ]);
  assert.ok(comDois.ok);
  const remocao = cards(comDois.design, [{ kind: 'module.remove', id: 'nicho' }]);
  assert.equal(remocao[0].title, 'Nicho removido');
  assert.match(remocao[0].summary, /1 no lugar/);
  const redimensionar = cards(before, [{ kind: 'resize', width: 1000 }]);
  assert.equal(redimensionar[0].title, 'Medidas do móvel ajustadas');
  assert.match(redimensionar[0].summary, /Largura de 800 mm para 1000 mm/);
});

void test('o turno aplicado guarda os cartões e o texto da IA separados', async () => {
  const original = globalThis.fetch;
  const payload = {
    action: 'update',
    approach: 'Adicionar o nicho à direita.',
    message: 'Criei um nicho aberto à direita da estante, com 80 × 60 × 45 cm.',
    suggestions: ['Coloque portas no nicho'],
    ops: [
      { kind: 'module.add', id: 'qa-nicho', preset: 'niche', name: 'Nicho' },
      { kind: 'module.edit', id: 'qa-nicho', width: 800, height: 600, depth: 450 },
      {
        kind: 'connect',
        parent: 'module-1',
        child: 'qa-nicho',
        side: 'right',
        shared: false,
        align: 'front',
        offset: 0,
      },
    ],
  };
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
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
          for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
          c.close();
        },
      }),
    );
  try {
    const p = create();
    await readEvents(
      await POST(
        new Request('http://127.0.0.1:4310/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({
            id: p.id,
            version: 0,
            message: 'Adicione um nicho de 800 × 600 × 450 mm à direita, alinhado pela frente.',
          }),
        }),
      ),
      () => {},
    );
    const last = get(p.id).messages.at(-1);
    assert.equal(last?.report?.highlights?.length, 1);
    assert.equal(last?.report?.highlights?.[0].title, 'Nicho adicionado');
    assert.equal(
      last?.report?.highlights?.[0].facts?.find((f) => f.label === 'Posição')?.value,
      'à direita de Estante',
    );
    assert.match(last?.report?.prose ?? '', /nicho aberto/);
    // O conteúdo continua sendo o registro factual do turno, para o histórico
    // e para o modelo, mesmo com os cartões na interface.
    assert.match(last?.content ?? '', /Módulo "Nicho" adicionado/);
    assert.equal(JSON.stringify(get(p.id)).includes('PRIVATE'), false);
  } finally {
    globalThis.fetch = original;
  }
});
