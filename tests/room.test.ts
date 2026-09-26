import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  emptyRoom,
  fitReport,
  fitSummary,
  roomSchema,
  type Obstacle,
  type Room,
} from '../lib/room';
import {
  PROFILE,
  preset,
  type Composition,
  type Module,
} from '../lib/composition';
import { create, fork, get } from '../lib/store';
import { GET, POST } from '../app/api/projects/route';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-room-'));

/** Módulo sem frentes nem prateleiras: a caixa dele é o envelope. */
function box(id: string, width: number, height: number, x = 0, y = 0): Module {
  return {
    ...preset('niche', id),
    width,
    height,
    depth: 400,
    position: [x, y, 0],
  };
}

function composition(modules: Module[]): Composition {
  return { schemaVersion: 3, profile: PROFILE, modules, connections: [] };
}

/** Quarto medido de partida dos testes: 3,00 m de parede e 2,87 m de teto. */
function room(patch: Partial<Room> = {}): Room {
  return { schemaVersion: 1, widthMm: 3000, heightMm: 2870, depthMm: 700, ...patch };
}

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('http://127.0.0.1:4310/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

/** Resposta do projeto: o que o teste lê da API, validado na fronteira. */
const stateSchema = z
  .object({
    room: roomSchema.optional(),
    revisions: z.array(z.unknown()),
    version: z.number(),
  })
  .loose();

const codes = (report: { issues: { code: string }[] }) =>
  report.issues.map((issue) => issue.code);

void test('o schema do ambiente aceita o medido e recusa o impossível', () => {
  const door: Obstacle = {
    id: 'ob-1',
    kind: 'door',
    xMm: 0,
    yMm: 0,
    widthMm: 800,
    heightMm: 2100,
    swingMm: 800,
  };
  assert.equal(roomSchema.safeParse(room({ obstacles: [door] })).success, true);
  assert.equal(roomSchema.safeParse(emptyRoom()).success, true);
  assert.equal(
    roomSchema.safeParse({ schemaVersion: 1, widthMm: 100, heightMm: 2700 }).success,
    false,
  );
  assert.equal(
    roomSchema.safeParse({ schemaVersion: 2, widthMm: 3000, heightMm: 2700 }).success,
    false,
  );
  assert.equal(
    roomSchema.safeParse({ schemaVersion: 1, widthMm: 3000, heightMm: 2700, teto: 1 })
      .success,
    false,
  );
  assert.equal(
    roomSchema.safeParse(room({ obstacles: [{ ...door, widthMm: 4 }] })).success,
    false,
  );
});

void test('cabe: o veredito conta a folga do lado mais apertado', () => {
  const design = composition([box('a', 1200, 2400, -600), box('b', 1200, 2400, 600)]);
  const report = fitReport(design, room());
  assert.equal(report.fits, true);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.notes, []);
  assert.equal(
    fitSummary(design, room(), report),
    'Cabe: 2,87 m de parede por 2,40 m de móvel, folga de 47 cm',
  );
  // Mesa estreita: aí quem aperta é a largura, e o resumo conta essa folga.
  const narrow = composition([box('a', 1200, 2400, -600), box('b', 1000, 2400, 500)]);
  assert.equal(
    fitSummary(narrow, room({ widthMm: 2300 })),
    'Cabe: 2,30 m de parede por 2,20 m de móvel, folga de 10 cm',
  );
});

void test('não cabe por altura: 3,70 m de móvel em pé-direito de 2,70 m', () => {
  const design = composition([box('a', 1200, 2400), box('b', 1200, 1300, 0, 2400)]);
  const tight = room({ heightMm: 2700 });
  const report = fitReport(design, tight);
  assert.equal(report.fits, false);
  assert.deepEqual(codes(report), ['too-tall']);
  assert.equal(report.issues[0].detail, 'Passa 100 cm do teto.');
  assert.equal(
    fitSummary(design, tight, report),
    'Não cabe: o móvel tem 3,70 m de altura e o pé-direito é 2,70 m',
  );
});

void test('não cabe por largura: 2,40 m de móvel em parede de 2,00 m', () => {
  const design = composition([box('a', 1200, 2400, -600), box('b', 1200, 2400, 600)]);
  const narrow = room({ widthMm: 2000 });
  const report = fitReport(design, narrow);
  assert.deepEqual(codes(report), ['too-wide']);
  assert.equal(report.issues[0].message, 'O móvel tem 2,40 m de largura e a parede tem 2,00 m');
  assert.equal(
    fitSummary(design, narrow, report),
    'Não cabe: o móvel tem 2,40 m de largura e a parede tem 2,00 m',
  );
});

void test('não cabe por profundidade quando o ambiente informa o avanço', () => {
  const design = composition([box('a', 1200, 2400)]);
  const shallow = room({ depthMm: 300 });
  const report = fitReport(design, shallow);
  assert.deepEqual(codes(report), ['too-deep']);
  assert.equal(report.issues[0].detail, 'Passa 10 cm do limite do ambiente.');
});

void test('módulo flutuando: floor-gap com a altura livre embaixo', () => {
  const design = composition([box('a', 1200, 2400, 0, 350)]);
  const report = fitReport(design, room({ heightMm: 3000, depthMm: undefined }));
  assert.deepEqual(codes(report), ['floor-gap']);
  assert.equal(
    report.issues[0].message,
    'Nenhuma peça apoia no chão: o móvel começa a 35 cm do piso',
  );
  assert.ok(
    report.notes.some((note) => note.includes('Profundidade do ambiente não informada')),
  );
});

void test('obstáculo que cruza o módulo: obstacle-overlap nomeia os dois', () => {
  const design = composition([box('a', 1200, 2400, -600)]);
  const name = design.modules[0].name;
  // A janela divide a parede com o módulo; a coluna encosta na lateral direita
  // (cruzar é passar da face, não tocar nela).
  const window_: Obstacle = {
    id: 'ob-1',
    kind: 'window',
    xMm: 200,
    yMm: 800,
    widthMm: 800,
    heightMm: 1200,
  };
  const column: Obstacle = {
    id: 'ob-2',
    kind: 'column',
    xMm: 1200,
    yMm: 0,
    widthMm: 200,
    heightMm: 2400,
  };
  const crossed = fitReport(design, room({ obstacles: [window_, column] }));
  assert.deepEqual(codes(crossed), ['obstacle-overlap']);
  assert.match(crossed.issues[0].message, /^A janela \(x de 200 mm a 1000 mm/);
  assert.ok(crossed.issues[0].message.includes(`cruza o módulo ${name}`));
  assert.ok(!crossed.notes.some((note) => note.includes('nenhum cruza')));

  const free = fitReport(design, room({ obstacles: [column] }));
  assert.deepEqual(free.issues, []);
  assert.ok(free.notes.some((note) => note.includes('nenhum cruza o móvel')));
});

void test('tomada atrás do móvel é nota, não problema de encaixe', () => {
  const design = composition([box('a', 1200, 2400, -600)]);
  const outlet: Obstacle = { id: 'ob-1', kind: 'outlet', label: 'Tomada da máquina', xMm: 300, yMm: 1000, widthMm: 80, heightMm: 80 };
  const report = fitReport(design, room({ obstacles: [outlet] }));
  assert.equal(report.fits, true, JSON.stringify(report.issues));
  assert.deepEqual(report.crossed, []);
  assert.ok(report.notes.some((note) => /^Tomada da máquina fica atrás do módulo .*: recorte no fundo/.test(note)));
});

void test('giro da porta vira nota só quando alcança o móvel', () => {
  const design = composition([box('a', 1200, 2400, -600)]);
  const door: Obstacle = {
    id: 'ob-1',
    kind: 'door',
    xMm: 1400,
    yMm: 0,
    widthMm: 800,
    heightMm: 2100,
    swingMm: 100,
  };
  const away = fitReport(design, room({ widthMm: 4000, obstacles: [door] }));
  assert.deepEqual(away.issues, []);
  assert.ok(!away.notes.some((note) => note.includes('giro')));
  const reaching = fitReport(
    design,
    room({ widthMm: 4000, obstacles: [{ ...door, swingMm: 800 }] }),
  );
  assert.deepEqual(reaching.issues, []);
  assert.ok(reaching.notes.some((note) => note.includes('giro de 800 mm')));
});

void test('a ação room grava o ambiente numa versão nova e trava a versão', async () => {
  const created = create();
  const measured = room({
    obstacles: [
      { id: 'ob-1', kind: 'door', xMm: 0, yMm: 0, widthMm: 800, heightMm: 2100, swingMm: 800 },
    ],
  });
  const first = await post({
    id: created.id,
    version: created.version,
    action: 'room',
    room: measured,
  });
  assert.equal(first.status, 200);
  const state = stateSchema.parse(await first.json());
  assert.deepEqual(state.room, measured);
  // Obstáculo posto entra no histórico: Ctrl+Z desfaz.
  assert.equal(state.revisions.length, 2);
  assert.equal(state.version, 1);
  assert.deepEqual(get(created.id).room, measured);
  const read = await GET(
    new Request(`http://127.0.0.1:4310/api/projects?id=${created.id}`),
  );
  assert.deepEqual(stateSchema.parse(await read.json()).room, measured);

  // Versão velha (outra janela mudou o projeto) não sobrescreve nada.
  const stale = await post({
    id: created.id,
    version: created.version,
    action: 'room',
    room: room(),
  });
  assert.equal(stale.status, 400);
  assert.deepEqual(get(created.id).room, measured);

  // Medida fora do limite é recusada pelo schema do servidor.
  const invalid = await post({
    id: created.id,
    version: 1,
    action: 'room',
    room: { ...room(), heightMm: 10 },
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(get(created.id).room, measured);

  // Alternativa nasce com o ambiente da versão de onde saiu.
  const alternative = fork(created.id, 1, 'Alternativa medida');
  assert.deepEqual(alternative.room, measured);
});
