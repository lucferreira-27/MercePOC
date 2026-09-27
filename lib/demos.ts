import { randomUUID } from 'node:crypto';
import { layout } from './composition';
import type { MaterialId } from './furniture';
import { designFacts, factChanges } from './agent/facts';
import { DEFAULT_PRICES, money } from './quote';
import { roomChangeLabel, type Obstacle, type Room } from './room';
import {
  applyRequest,
  reviseRoom,
  type Message,
  type Project,
  type Revision,
} from './store';
import {
  describeDesignChanges,
  describeHighlights,
  executeRequest,
  normalize,
  type Design,
  type ShelfOp,
} from './studio';
import { buildTemplate, templateById } from './templates';

/**
 * Projetos de demonstração: cinco móveis que parecem trabalho de algumas
 * sessões, para mostrar o app a alguém. Não são clientes: o nome de cada um
 * começa com "Demo ·" e o projeto leva a marca `demo`.
 *
 * Nada aqui é desenhado à mão. Cada projeto nasce de um modelo da biblioteca,
 * como em "Novo", e cada versão seguinte sai do mesmo caminho do app: um
 * pedido na conversa aplica operações do contrato com `executeRequest` e grava
 * com `revise` (rótulo = o pedido, como o assistente faz), uma mudança no
 * Ambiente passa por `reviseRoom` com o rótulo de `roomChangeLabel`. As linhas
 * de "Edição", o antes e depois de chapas e orçamento e as medidas citadas nas
 * respostas são calculados do desenho gravado, então toda mensagem corresponde
 * a uma versão real. Não há uso de modelo (tokens, custo) inventado.
 *
 * Gravação: `npm run demos` (scripts/seed-demos.ts). Os ids são fixos, então
 * gravar de novo devolve cada demo ao estado original sem duplicar.
 */

/** Quando: dias antes da gravação e a hora local ("HH:MM"). */
type At = [days: number, time: string];
type Ctx = { before: Design; after: Design; room?: Room };
type Step =
  | {
      /** Pedido na conversa que muda o móvel (e, se preciso, o ambiente). */
      kind: 'chat';
      at: At;
      user: string;
      ops: (d: Design) => ShelfOp[];
      room?: (r: Room, d: Design) => Room;
      reply: (c: Ctx) => string;
      suggestions?: string[];
    }
  | {
      /** Pergunta respondida sem mudar o projeto: fica na versão vigente. */
      kind: 'ask';
      at: At;
      user: string;
      reply: (c: Ctx) => string;
      suggestions?: string[];
    }
  | { kind: 'room'; at: At; room: (r: Room, d: Design) => Room };

export type DemoRecipe = {
  key: string;
  /** Id fixo (UUID: a API de projetos só aceita UUID). */
  id: string;
  name: string;
  template: string;
  /** Primeira versão, a do modelo. */
  at: At;
  steps: Step[];
};

/** Centímetros com uma casa no máximo: "27,5 cm". */
const cm = (mm: number) => `${String(Number((mm / 10).toFixed(1))).replace('.', ',')} cm`;
const m2 = (mm: number) => `${(mm / 1000).toFixed(2).replace('.', ',')} m`;
const moduleOf = (d: Design, id: string) => {
  const m = d.modules.find((v) => v.id === id);
  if (!m) throw new Error(`Demo: módulo ${id} não existe.`);
  return m;
};
/** Largura total da composição, de ponta a ponta. */
const spanOf = (d: Design) => d.width;

/**
 * Troca o acabamento das frentes que passam no filtro, mantendo tipo,
 * dobradiça e número de gavetas: é o lote que o assistente monta para
 * "troque as frentes para …".
 */
function refinish(d: Design, materialId: MaterialId, keep: (moduleId: string) => boolean = () => true): ShelfOp[] {
  return layout(d)
    .cells.filter((c) => c.node.front && keep(c.moduleId))
    .map((c) => {
      const f = c.node.front!;
      return {
        kind: 'front.set' as const,
        id: c.id,
        type: f.type,
        hinge: f.hinge,
        ...(f.type === 'drawers' ? { count: f.heights.length } : {}),
        materialId,
      };
    });
}
const tv = (inches: 55 | 65, x: number, y: number): Obstacle =>
  inches === 55
    ? { id: 'ob-tv', kind: 'tv', xMm: x, yMm: y, widthMm: 1230, heightMm: 710 }
    : { id: 'ob-tv', kind: 'tv', xMm: x, yMm: y, widthMm: 1450, heightMm: 830 };

export const DEMOS: DemoRecipe[] = [
  {
    key: 'sala-tv',
    id: '0d3e5a61-7c2b-4f8e-9a14-5b6c7d8e9f01',
    name: 'Demo · Painel de TV com rack suspenso',
    template: 'rack-suspenso',
    at: [11, '20:05'],
    steps: [
      {
        kind: 'room',
        at: [11, '20:14'],
        // Parede de 3,40 m com um pilar na ponta direita: sobram 3,15 m livres,
        // e o painel fica no meio desse trecho. Pé-direito de 2,60 m.
        room: () => ({
          schemaVersion: 1,
          widthMm: 3400,
          heightMm: 2600,
          depthMm: 4100,
          baseboardMm: 0,
          offsetMm: 475,
          obstacles: [
            tv(55, 475 + 1100 - 615, 1110),
            { id: 'ob-tomada', kind: 'outlet', xMm: 2950, yMm: 300, widthMm: 80, heightMm: 80 },
            { id: 'ob-coluna', kind: 'column', label: 'Pilar', xMm: 3150, yMm: 0, widthMm: 250, heightMm: 2600 },
          ],
        }),
      },
      {
        kind: 'room',
        at: [8, '19:40'],
        room: (r) => ({
          ...r,
          obstacles: r.obstacles!.map((o) => (o.id === 'ob-tv' ? tv(65, 475 + 1100 - 725, 1060) : o)),
        }),
      },
      {
        kind: 'chat',
        at: [8, '19:52'],
        user: 'TV nova de 65": painel de 2,60 m e rack de 2,30 m, centralizados entre o canto e o pilar.',
        ops: (d) => {
          const w = [778, 778, 780];
          const rack = w.reduce((a, b) => a + b, 0) - 2 * 18;
          return [
            { kind: 'module.edit', id: 'p', width: 2600 },
            { kind: 'module.edit', id: 'r1', width: w[0], position: [-rack / 2 + w[0] / 2, 450, moduleOf(d, 'r1').position[2]] },
            { kind: 'module.edit', id: 'r2', width: w[1] },
            { kind: 'module.edit', id: 'r3', width: w[2] },
          ];
        },
        // O painel cresce 20 cm para cada lado: a distância do canto diminui junto.
        room: (r) => ({ ...r, offsetMm: 275 }),
        reply: ({ before, after }) =>
          `Painel de ${m2(moduleOf(before, 'p').width)} para ${m2(moduleOf(after, 'p').width)} e rack de ${m2(1899)} para ${m2(2300)}, com os três módulos alargados por igual. O conjunto continua centralizado, a ${cm(275)} do canto e ${cm(3150 - 275 - 2600)} do pilar, e a TV de 65" fica com ${cm((2600 - 1450) / 2)} de painel de cada lado.`,
      },
      {
        kind: 'chat',
        at: [8, '20:03'],
        user: 'As frentes das gavetas podem ser em freijó? Quero um contraste com a nogueira.',
        ops: () => [
          { kind: 'front.set', id: 'r1:root', type: 'drawers', count: 1, materialId: 'freijo' },
          { kind: 'front.set', id: 'r3:root', type: 'drawers', count: 1, materialId: 'freijo' },
        ],
        reply: ({ before, after }) => {
          const a = designFacts(before, DEFAULT_PRICES),
            b = designFacts(after, DEFAULT_PRICES);
          return `Pronto: as duas gavetas do rack agora são em freijó, e painel, caixas e nicho continuam em nogueira. O freijó mais claro marca as pontas do rack sem brigar com a madeira escura. Só que ele é outra chapa: o plano passa de ${a.sheets} para ${b.sheets} chapas e o orçamento sobe ${money(b.total - a.total)}, quase tudo por duas frentes pequenas. Se pesar, dá para voltar à nogueira.`;
        },
      },
      {
        kind: 'chat',
        at: [1, '21:10'],
        user: 'Divide o nicho do meio em dois, lado a lado: um para o receiver e outro para o videogame.',
        ops: () => [{ kind: 'cell.split', id: 'r2:root', axis: 'x', gapMm: 362 }],
        reply: ({ after }) => {
          const cells = layout(after).cells.filter((c) => c.id.startsWith('r2:root:'));
          const low = cells.find((c) => c.id === 'r2:root:low')!.size;
          const high = cells.find((c) => c.id === 'r2:root:high')!.size;
          const widths = low[0] === high[0] ? `dois vãos iguais de ${cm(low[0])}` : `dois vãos de ${cm(low[0])} e ${cm(high[0])}`;
          return `Pus uma divisória no meio do nicho: ficaram ${widths} de largura, com ${cm(low[1])} de altura e ${cm(low[2])} de fundo, o receiver de um lado e o videogame do outro. Para os cabos, peça à marcenaria um furo no fundo do rack e no painel, e deixe uns 5 cm livres em cima dos aparelhos para ventilar.`;
        },
      },
      {
        kind: 'chat',
        at: [1, '21:18'],
        user: 'Quero duas prateleiras de parede à direita da TV, em nogueira, para uns enfeites.',
        ops: (d) => {
          const z = moduleOf(d, 'p').position[2] + moduleOf(d, 'p').depth / 2 + 100;
          return [
            { kind: 'module.add', id: 'pr1', preset: 'ledge', name: 'Prateleira de cima' },
            { kind: 'module.edit', id: 'pr1', width: 450, height: 18, depth: 200, materialId: 'walnut', position: [1030, 1620, z] },
            { kind: 'module.add', id: 'pr2', preset: 'ledge', name: 'Prateleira de baixo' },
            { kind: 'module.edit', id: 'pr2', width: 450, height: 18, depth: 200, materialId: 'walnut', position: [1030, 1320, z] },
          ];
        },
        reply: () =>
          `Pus duas prateleiras de ${cm(450)} × ${cm(200)} em nogueira de 18 mm, presas no painel à direita da TV, a ${m2(1320)} e ${m2(1620)} do piso. Elas ficam a ${cm(1030 - 225 - 725)} da borda da tela e a ${cm(1300 - 1030 - 225)} da ponta do painel, então a TV continua livre. Não precisa de chapa nova: saem da sobra da nogueira de 18 mm do rack, e o orçamento sobe pela montagem e pelo kit de fixação das duas peças.`,
        suggestions: ['Quanto custa e quantas chapas usa?', 'Abra as gavetas do rack', 'Troque o painel por freijó e compare o orçamento'],
      },
    ],
  },
  {
    key: 'quarto-guarda-roupa',
    id: '1f4b6c72-8d3a-4e9f-8b25-6c7d8e9fa012',
    name: 'Demo · Guarda-roupa do quarto de casal',
    template: 'guarda-roupa',
    at: [15, '10:20'],
    steps: [
      {
        kind: 'room',
        at: [15, '10:31'],
        room: () => ({
          schemaVersion: 1,
          widthMm: 3050,
          heightMm: 2600,
          depthMm: 3400,
          baseboardMm: 0,
          offsetMm: 0,
          obstacles: [{ id: 'ob-porta', kind: 'door', label: 'Porta do quarto', xMm: 2240, yMm: 0, widthMm: 760, heightMm: 2100 }],
        }),
      },
      {
        kind: 'chat',
        at: [15, '10:40'],
        user: 'Ficou batendo no batente da porta. Diminui o guarda-roupa para caber até ela.',
        ops: () => [
          { kind: 'module.edit', id: 'g1', width: 808 },
          { kind: 'module.edit', id: 'g2', width: 808 },
        ],
        reply: ({ before, after }) =>
          `Guarda-roupa de ${m2(spanOf(before))} para ${m2(spanOf(after))}: cabideiro e gaveteiro passaram de ${cm(moduleOf(before, 'g1').width)} para ${cm(moduleOf(after, 'g1').width)} cada, e a coluna de portas continua com ${cm(600)}. Sobra ${cm(2240 - 50 - spanOf(after))} até o batente, que começa a ${m2(2190)} do canto. O veredito do ambiente voltou para "Cabe".`,
      },
      {
        kind: 'chat',
        at: [9, '19:15'],
        user: 'No cabideiro, põe uma prateleira no meio para ter dois níveis de cabide.',
        ops: () => [{ kind: 'cell.split', id: 'g1:root:low', axis: 'y', gapMm: 930 }],
        reply: ({ after }) => {
          const c = layout(after).cells;
          const low = c.find((v) => v.id === 'g1:root:low:low')!.size[1];
          const high = c.find((v) => v.id === 'g1:root:low:high')!.size[1];
          return `Prateleira no meio do cabideiro: ${cm(low)} livres embaixo e ${cm(high)} em cima, dois níveis bons para camisas e calças dobradas no cabide. As duas portas continuam inteiras, cobrindo os dois vãos. Os varões não aparecem no desenho; a marcenaria fixa um embaixo de cada prateleira.`;
        },
      },
      {
        kind: 'chat',
        at: [9, '19:24'],
        user: 'E o gaveteiro com 4 gavetas em vez de 3, um pouco mais alto.',
        ops: () => [
          { kind: 'cell.move', id: 'g2:root:low', gapMm: 800 },
          { kind: 'front.set', id: 'g2:root:low:low', type: 'drawers', count: 4, materialId: 'freijo' },
        ],
        reply: () =>
          `O bloco de gavetas subiu de ${cm(640)} para ${cm(800)} de altura e agora tem 4 gavetas iguais. O vão de cima, atrás das portas do meio, ficou ${cm(160)} mais baixo, ainda com espaço para prateleiras de roupa dobrada.`,
      },
      {
        kind: 'room',
        at: [2, '09:50'],
        // A parede do corredor fecha o canto esquerdo, por fora.
        room: (r) => ({
          ...r,
          walls: [{ id: 'wall-1', xMm: -150, zMm: 0, widthMm: 3400, heightMm: 2600, thicknessMm: 150, rotation: 90 }],
        }),
      },
      {
        kind: 'chat',
        at: [2, '10:02'],
        user: 'Troca as frentes para verde sálvia. O freijó ficou escuro com o piso de madeira.',
        ops: (d) => refinish(d, 'sage'),
        reply: ({ after }) =>
          `Troquei as ${layout(after).cells.filter((c) => c.node.front).length} frentes (portas, maleiro e gavetas) para verde sálvia, e o corpo continua branco fosco. Com o piso de madeira, o sálvia deixa o quarto mais leve que o freijó.`,
        suggestions: ['Abra as portas para ver o interior', 'Quanto custa e quantas chapas usa?', 'Coloque um criado-mudo à direita da porta'],
      },
    ],
  },
  {
    key: 'cozinha-compacta',
    id: '2a5c7d83-9e4b-4fa0-9c36-7d8e9fab1023',
    name: 'Demo · Cozinha compacta com janela',
    template: 'cozinha',
    at: [19, '14:00'],
    steps: [
      {
        kind: 'room',
        at: [19, '14:12'],
        room: () => ({
          schemaVersion: 1,
          widthMm: 2700,
          heightMm: 2500,
          depthMm: 2600,
          baseboardMm: 0,
          offsetMm: 0,
          obstacles: [
            { id: 'ob-janela', kind: 'window', xMm: 700, yMm: 1150, widthMm: 800, heightMm: 1000 },
            { id: 'ob-geladeira', kind: 'other', label: 'Geladeira', xMm: 1980, yMm: 0, widthMm: 720, heightMm: 1850 },
          ],
        }),
      },
      {
        kind: 'chat',
        at: [19, '14:25'],
        user: 'Encurta a cozinha para a geladeira caber no canto e tira os aéreos da frente da janela.',
        ops: (d) => {
          const a3 = moduleOf(d, 'a3');
          // Parede começa no lado esquerdo do gaveteiro (600 de largura, centro em 0).
          const wallX = -300;
          return [
            { kind: 'module.remove', id: 'a2' },
            { kind: 'module.edit', id: 'b1', width: 600 },
            { kind: 'module.edit', id: 'b2', width: 800 },
            { kind: 'module.edit', id: 'b3', width: 596 },
            { kind: 'module.edit', id: 'a1', width: 600 },
            { kind: 'module.edit', id: 'a3', width: 420, position: [wallX + 1540 + 210, a3.position[1], a3.position[2]] },
            { kind: 'front.set', id: 'a3:root', type: 'single', hinge: 'right', materialId: 'sage' },
          ];
        },
        reply: ({ after }) =>
          `Balcão de ${m2(2400)} para ${m2(spanOf(after))}: gaveteiro de ${cm(600)}, gabinete da pia de ${cm(800)} embaixo da janela e armário de ${cm(596)} de portas. Sobram ${cm(2700 - 1960)} no canto para a geladeira de ${cm(720)}. Em cima, tirei o aéreo que ficava na frente da janela; o da esquerda acompanha o gaveteiro e o da direita ficou com ${cm(420)} e porta simples, encostado no batente da janela.`,
      },
      {
        kind: 'chat',
        at: [10, '20:30'],
        user: 'Aproveita o espaço em cima da geladeira com um aéreo até perto do teto.',
        ops: (d) => {
          const wallX = -300;
          const back = Math.min(...d.modules.map((m) => m.position[2] - m.depth / 2));
          return [
            { kind: 'module.add', id: 'a4', preset: 'niche', name: 'Aéreo da geladeira' },
            { kind: 'module.edit', id: 'a4', width: 700, height: 500, depth: 450, materialId: 'white', wall: true, position: [wallX + 1980 + 350, 1950, back + 225] },
            { kind: 'front.set', id: 'a4:root', type: 'double', materialId: 'sage' },
          ];
        },
        reply: () =>
          `Aéreo de ${cm(700)} × ${cm(500)} com ${cm(450)} de fundo sobre a geladeira, preso na parede a ${m2(1950)} do piso: ficam ${cm(1950 - 1850)} livres acima da geladeira para ventilar e ${cm(2500 - 2450)} até o teto. É mais fundo que os outros aéreos para a porta ficar ao alcance da mão, na frente da geladeira.`,
      },
      {
        kind: 'chat',
        at: [10, '20:41'],
        user: 'Frentes de baixo em grafite e os aéreos em branco, para a cozinha não ficar pesada.',
        ops: (d) => [...refinish(d, 'graphite', (id) => id.startsWith('b')), ...refinish(d, 'white', (id) => id.startsWith('a'))],
        reply: () =>
          'Balcão com frentes grafite e aéreos todos brancos, iguais ao corpo. A parte escura fica embaixo, onde suja mais, e a parede de cima continua clara em volta da janela.',
      },
      {
        kind: 'ask',
        at: [3, '12:05'],
        user: 'Quanto fica e quantas chapas usa?',
        reply: ({ after }) => {
          const f = designFacts(after, DEFAULT_PRICES);
          const groups = f.groups.map((g) => `${g.sheets} de ${g.material} ${g.thickness} mm`).join(', ');
          return `Pela tabela de preços padrão, ${money(f.total)}, com ${f.sheets} chapas: ${groups}. O valor inclui fita de borda, dobradiças, corrediças, puxadores e mão de obra; o tampo de pedra e a instalação da pia ficam de fora. O detalhe está nas abas Orçamento e Corte.`;
        },
        suggestions: ['Mostre o plano de corte', 'Troque as frentes grafite por verde sálvia e compare', 'Exporte o PDF para a marcenaria'],
      },
    ],
  },
  {
    key: 'home-office',
    id: '3b6d8e94-af5c-4fb1-8d47-8e9fabc12034',
    name: 'Demo · Home office com prateleiras',
    template: 'armario-escritorio',
    at: [13, '09:00'],
    steps: [
      {
        kind: 'room',
        at: [13, '09:08'],
        room: () => ({
          schemaVersion: 1,
          widthMm: 3400,
          heightMm: 2700,
          depthMm: 2800,
          baseboardMm: 0,
          offsetMm: 0,
          obstacles: [
            { id: 'ob-janela', kind: 'window', xMm: 2650, yMm: 1000, widthMm: 700, heightMm: 1200 },
            { id: 'ob-tomada', kind: 'outlet', xMm: 2100, yMm: 800, widthMm: 80, heightMm: 80 },
          ],
        }),
      },
      {
        kind: 'chat',
        at: [13, '09:20'],
        user: 'A mesa vai à direita do armário. Põe duas prateleiras de parede sobre a mesa, de 90 cm.',
        ops: (d) => {
          const left = Math.min(...d.modules.map((m) => m.position[0] - m.width / 2));
          const back = Math.min(...d.modules.map((m) => m.position[2] - m.depth / 2));
          const x = left + 2120;
          return [
            { kind: 'module.add', id: 'pa', preset: 'ledge', name: 'Prateleira alta' },
            { kind: 'module.edit', id: 'pa', width: 900, height: 25, depth: 250, materialId: 'oak', position: [x, 1700, back + 125] },
            { kind: 'module.add', id: 'pb', preset: 'ledge', name: 'Prateleira baixa' },
            { kind: 'module.edit', id: 'pb', width: 900, height: 25, depth: 250, materialId: 'oak', position: [x, 1350, back + 125] },
          ];
        },
        reply: () =>
          `Duas prateleiras de carvalho de ${cm(900)} × ${cm(250)}, com 25 mm de espessura, a ${m2(1350)} e ${m2(1700)} do piso, sobre o lugar da mesa. Ficam a ${cm(1670 - 1600)} do armário e a ${cm(2620 - 2570)} do batente da janela, e a tomada a ${cm(800)} continua livre embaixo delas.`,
      },
      {
        kind: 'chat',
        at: [4, '19:05'],
        user: 'Na coluna da esquerda, troca a porta de baixo por duas gavetas de pasta suspensa.',
        ops: () => [{ kind: 'front.set', id: 'o1:root:low', type: 'drawers', count: 2, materialId: 'petrol' }],
        reply: ({ after }) => {
          const c = layout(after).cells.find((v) => v.id === 'o1:root:low')!;
          return `A porta virou duas gavetas azul petróleo de ${cm(c.size[1] / 2)} de altura cada, com ${cm(c.size[2])} de fundo: cabem pastas suspensas no sentido da largura. A coluna da direita continua com porta dupla.`;
        },
      },
      {
        kind: 'chat',
        at: [4, '19:15'],
        user: 'Quero um gaveteiro embaixo da mesa, de 45 cm, com 3 gavetas, na cor das portas.',
        ops: (d) => {
          const left = Math.min(...d.modules.filter((m) => !m.kind).map((m) => m.position[0] - m.width / 2));
          const back = Math.min(...d.modules.filter((m) => !m.kind).map((m) => m.position[2] - m.depth / 2));
          return [
            { kind: 'module.add', id: 'gm', preset: 'niche', name: 'Gaveteiro da mesa' },
            { kind: 'module.edit', id: 'gm', width: 450, height: 600, depth: 450, materialId: 'petrol', position: [left + 2100 + 225, 0, back + 225] },
            { kind: 'front.set', id: 'gm:root', type: 'drawers', count: 3, materialId: 'petrol' },
          ];
        },
        reply: () =>
          `Gaveteiro de ${cm(450)} × ${cm(600)} × ${cm(450)} em azul petróleo, com três gavetas, no lado direito da mesa: sobra espaço para as pernas entre ele e o armário. Rodízios não entram no desenho, então ele aparece apoiado no piso; com rodízios de 5 cm, peça para baixar a caixa para 55 cm e a mesa continua passando por cima.`,
      },
      {
        kind: 'chat',
        at: [4, '19:31'],
        user: 'Ficou caro. Dá para usar menos chapas sem mudar o visual?',
        // As prateleiras de 25 mm abriam uma chapa de carvalho só para elas, e a
        // caixa azul do gaveteiro, chapas azuis de 15 e 6 mm para as gavetas.
        ops: () => [
          { kind: 'module.edit', id: 'pa', height: 18 },
          { kind: 'module.edit', id: 'pb', height: 18 },
          { kind: 'module.edit', id: 'gm', materialId: 'oak' },
        ],
        reply: ({ before, after }) => {
          const a = designFacts(before, DEFAULT_PRICES),
            b = designFacts(after, DEFAULT_PRICES);
          return `Dá: de ${a.sheets} para ${b.sheets} chapas e ${money(a.total - b.total)} a menos. As duas prateleiras de 25 mm usavam uma chapa de carvalho só para elas; com 18 mm entram nas sobras da chapa do armário. E a caixa do gaveteiro passou para carvalho, como o armário: as gavetas por dentro saem das mesmas chapas das gavetas de pasta. Por fora, só as laterais do gaveteiro mudam de cor; as frentes continuam azul petróleo, como as portas.`;
        },
        suggestions: ['Mostre o plano de corte', 'Mostre a vista de frente com as cotas', 'Coloque portas nos nichos de cima da coluna 2'],
      },
    ],
  },
  {
    key: 'lavanderia',
    id: '4c7e9fa5-b06d-4fc2-9e58-9fabcd123045',
    name: 'Demo · Lavanderia com máquina e tanque',
    template: 'armario-lavanderia',
    at: [12, '11:30'],
    steps: [
      {
        kind: 'room',
        at: [12, '11:37'],
        room: () => ({
          schemaVersion: 1,
          widthMm: 2400,
          heightMm: 2500,
          depthMm: 1700,
          baseboardMm: 0,
          offsetMm: 0,
          obstacles: [
            { id: 'ob-maquina', kind: 'other', label: 'Máquina de lavar', xMm: 1230, yMm: 0, widthMm: 620, heightMm: 900 },
            { id: 'ob-tanque', kind: 'other', label: 'Tanque', xMm: 1880, yMm: 0, widthMm: 500, heightMm: 900 },
            { id: 'ob-tomada', kind: 'outlet', xMm: 1500, yMm: 1100, widthMm: 80, heightMm: 80 },
          ],
        }),
      },
      {
        kind: 'chat',
        at: [12, '11:48'],
        user: 'Põe um armário aéreo em cima da máquina e do tanque, com porta basculante.',
        ops: (d) => {
          const left = Math.min(...d.modules.map((m) => m.position[0] - m.width / 2));
          const back = Math.min(...d.modules.map((m) => m.position[2] - m.depth / 2));
          return [
            { kind: 'module.add', id: 'am', preset: 'niche', name: 'Aéreo da máquina' },
            { kind: 'module.edit', id: 'am', width: 1150, height: 550, depth: 350, materialId: 'white', wall: true, position: [left + 1230 + 575, 1650, back + 175] },
            { kind: 'front.set', id: 'am:root', type: 'double', materialId: 'white' },
          ];
        },
        reply: () =>
          `Aéreo de ${cm(1150)} × ${cm(550)} × ${cm(350)} sobre a máquina e o tanque, preso a ${m2(1650)} do piso e alinhado pelo topo com o armário. Porta basculante o editor ainda não tem, então usei duas portas de abrir; na marcenaria dá para trocar a ferragem sem mudar o corpo. A tomada da máquina, a ${m2(1100)}, fica livre embaixo dele.`,
      },
      {
        kind: 'chat',
        at: [5, '18:20'],
        user: 'No vassoureiro, põe uma prateleira no alto para os produtos de limpeza.',
        ops: () => [{ kind: 'cell.split', id: 'l1:root', axis: 'y', gapMm: 1700 }],
        reply: ({ after }) => {
          const c = layout(after).cells;
          const high = c.find((v) => v.id === 'l1:root:high')!.size[1];
          return `Prateleira no alto do vassoureiro: embaixo ficam ${m2(1700)} livres para vassoura, rodo e tábua de passar, e em cima ${cm(high)} para os produtos, longe do alcance das crianças. A porta inteira continua cobrindo os dois vãos.`;
        },
      },
      {
        kind: 'chat',
        at: [5, '18:31'],
        user: 'Troca as frentes para areia. O branco puro destoou do piso.',
        ops: (d) => refinish(d, 'sand'),
        reply: ({ after }) =>
          `As ${layout(after).cells.filter((c) => c.node.front).length} frentes, do armário e do aéreo, agora são em areia, e as caixas continuam brancas. O tom quente conversa com o piso e disfarça melhor as marcas do dia a dia.`,
        suggestions: ['Abra as portas para ver o interior', 'Quanto custa e quantas chapas usa?', 'Exporte a lista de peças'],
      },
    ],
  },
];

/** Hora local de `days` dias antes de `now`, como ISO. */
function when(now: Date, [days, time]: At) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Monta o projeto de uma receita, versão por versão, pelos caminhos do app.
 * Falha (com o nome da demo) se alguma operação for recusada pela validação.
 */
export function buildDemo(recipe: DemoRecipe, order: number, now = new Date()): { project: Project; updated: string } {
  const t = templateById(recipe.template);
  if (!t) throw new Error(`Demo ${recipe.key}: modelo ${recipe.template} não existe.`);
  const start = when(now, recipe.at);
  const first: Revision = {
    id: randomUUID(),
    number: 1,
    params: normalize(buildTemplate(t)),
    label: `Modelo: ${t.name}`,
    at: start.toISOString(),
    room: t.room ? structuredClone(t.room) : null,
  };
  const p: Project = {
    id: recipe.id,
    name: recipe.name,
    version: 0,
    cursor: 0,
    revisions: [first],
    messages: [{ id: randomUUID(), role: 'assistant', content: t.intro, revisionId: first.id, revision: 1 }],
    ...(t.room ? { room: structuredClone(t.room) } : {}),
    demo: { key: recipe.key, order },
  };
  let last = start;
  for (const [i, step] of recipe.steps.entries()) {
    const at = when(now, step.at);
    if (at <= last) throw new Error(`Demo ${recipe.key}: passo ${i + 1} fora de ordem no tempo.`);
    last = at;
    const base = p.revisions[p.cursor];
    const before = base.params;
    const stamp = () => {
      const rev = p.revisions[p.cursor];
      rev.at = at.toISOString();
      if (rev.placement) rev.placement = { ...rev.placement, at: rev.at };
      return rev;
    };
    if (step.kind === 'room') {
      const room = step.room(p.room!, before);
      const r = reviseRoom(p, room, roomChangeLabel(p.room, room), at.getTime());
      if (r.noop) throw new Error(`Demo ${recipe.key}: passo ${i + 1} não mudou o ambiente.`);
      stamp();
      continue;
    }
    const context = { requestId: randomUUID(), baseRevisionId: base.id, selectedPartIds: [], referencedPartIds: [] };
    const user: Message = { id: randomUUID(), role: 'user', content: step.user, revisionId: base.id, revision: base.number, context };
    p.messages.push(user);
    if (step.kind === 'ask') {
      const prose = step.reply({ before, after: before, room: p.room });
      p.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: prose,
        revisionId: base.id,
        revision: base.number,
        context,
        ...(step.suggestions ? { suggestions: step.suggestions } : {}),
        result: { outcome: 'answered', resultRevisionId: base.id, appliedOperations: [], changes: [] },
        report: { durationMs: 0, outcome: 'answered', changes: [], prose, completion: 'complete' },
      });
      continue;
    }
    const ops = step.ops(before);
    const run = executeRequest(before, ops);
    if (!run.ok) throw new Error(`Demo ${recipe.key}: passo ${i + 1} recusado: ${run.error}`);
    if (step.room) p.room = step.room(p.room!, before);
    // O mesmo gravador do assistente: a versão leva o pedido como rótulo.
    const applied = applyRequest(p, ops, step.user.trim().slice(0, 90));
    if (!applied.ok || applied.noop) throw new Error(`Demo ${recipe.key}: passo ${i + 1} não mudou o móvel.`);
    const rev = stamp();
    const after = rev.params;
    const changes = describeDesignChanges(before, after);
    const facts = factChanges(designFacts(before, DEFAULT_PRICES), designFacts(after, DEFAULT_PRICES));
    const prose = step.reply({ before, after, room: p.room });
    p.messages.push({
      id: randomUUID(),
      role: 'assistant',
      content: prose,
      revisionId: rev.id,
      revision: rev.number,
      context,
      ...(step.suggestions ? { suggestions: step.suggestions } : {}),
      result: { outcome: 'applied', resultRevisionId: rev.id, appliedOperations: ops, changes },
      report: {
        durationMs: 0,
        outcome: 'applied',
        changes,
        highlights: describeHighlights(before, after, ops),
        prose,
        completion: 'complete',
        ...(facts.length ? { facts } : {}),
      },
    });
  }
  p.cursor = p.revisions.length - 1;
  return { project: p, updated: last.toISOString() };
}
