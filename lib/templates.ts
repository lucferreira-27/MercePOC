import {
  applyModularOp,
  generateComposition,
  preset,
  PROFILE,
  type Composition,
  type ModularOp,
} from './composition';
import type { MaterialId } from './furniture';
import type { Room } from './room';

/**
 * Pontos de partida prontos. Cada modelo é uma sequência de operações do
 * mesmo contrato que o chat e o editor usam, aplicada pelo motor: o que sai
 * daqui passou pela mesma validação de qualquer edição, e o histórico começa
 * limpo com o modelo como versão 1.
 */
export type TemplateId = 'estante' | 'guarda-roupa' | 'rack' | 'aparador' | 'sapateira';
export type Template = {
  id: TemplateId;
  name: string;
  summary: string;
  /** Texto de boas-vindas: o que foi montado e por onde continuar. */
  intro: string;
  room?: Room;
  ops: ModularOp[];
  first: { id: string; name: string; size: [number, number, number]; materialId: MaterialId; preset: 'niche' };
};

/**
 * Divide um compartimento de `span` mm livres em `n` vãos iguais. Cada divisão
 * já nasce com o vão final: dividir sempre ao meio deixaria o último vão de uma
 * pilha de cinco com 50 mm, abaixo do mínimo do motor.
 */
function stack(cell: string, n: number, span: number, axis: 'x' | 'y' = 'y'): ModularOp[] {
  const ops: ModularOp[] = [];
  const gap = Math.floor((span - (n - 1) * PROFILE.panel) / n);
  let current = cell;
  for (let i = 1; i < n; i++) {
    ops.push({ kind: 'cell.split', id: current, axis, gapMm: gap });
    current = `${current}:high`;
  }
  if (n > 1) ops.push({ kind: 'cell.distribute', id: cell });
  return ops;
}
/** Id do vão `i` (0 = de baixo, ou da esquerda) de uma pilha feita por `stack`. */
function slot(cell: string, i: number, n: number) {
  let id = cell;
  for (let k = 0; k < i; k++) id += ':high';
  return i === n - 1 ? id : `${id}:low`;
}
function add(
  id: string,
  name: string,
  [width, height, depth]: [number, number, number],
  materialId: MaterialId,
): ModularOp[] {
  // O módulo novo nasce encostado à direita da composição; crescer ali
  // invadiria o vizinho. Ele é estacionado longe e a conexão o traz de volta.
  return [
    { kind: 'module.add', id, preset: 'niche', name },
    { kind: 'module.edit', id, width, height, depth, materialId, position: [15000, 0, 0] },
  ];
}
const beside = (parent: string, child: string, shared: boolean, align: 'front' | 'back' = 'front'): ModularOp => ({
  kind: 'connect',
  parent,
  child,
  side: 'right',
  shared,
  align,
  offset: 0,
});

export const templates: Template[] = [
  {
    id: 'estante',
    name: 'Estante de livros',
    summary: '3 corpos de 80 cm em carvalho, portas embaixo no centro',
    intro:
      'Montei uma estante de 2,40 m em carvalho: três corpos de 80 × 210 × 35 cm com painéis compartilhados, cinco vãos iguais cada e portas no vão de baixo do corpo central. Peça para trocar o acabamento, mudar a altura ou colocar gavetas.',
    first: { id: 'e1', name: 'Coluna esquerda', size: [800, 2100, 350], materialId: 'oak', preset: 'niche' },
    ops: [
      ...stack('e1:root', 5, 2064),
      ...add('e2', 'Coluna central', [800, 2100, 350], 'oak'),
      beside('e1', 'e2', true),
      ...stack('e2:root', 5, 2064),
      { kind: 'front.set', id: slot('e2:root', 0, 5), type: 'double' },
      ...add('e3', 'Coluna direita', [800, 2100, 350], 'oak'),
      beside('e2', 'e3', true),
      ...stack('e3:root', 5, 2064),
    ],
  },
  {
    id: 'guarda-roupa',
    name: 'Guarda-roupa',
    summary: '2,40 m, corpo branco e frentes em freijó, gavetas e maleiro',
    intro:
      'Montei um guarda-roupa de 2,40 × 2,40 m com 60 cm de profundidade: cabideiro à esquerda, gaveteiro com portas no centro e coluna de portas à direita, todos com maleiro em cima. Corpo branco e frentes em freijó. Também deixei um quarto de exemplo em Ambiente, com a porta do quarto, para você ver o encaixe; troque pelas suas medidas.',
    room: {
      schemaVersion: 1,
      widthMm: 3300,
      heightMm: 2700,
      depthMm: 3000,
      baseboardMm: 0,
      obstacles: [
        { id: 'ob-porta', kind: 'door', xMm: 2480, yMm: 0, widthMm: 760, heightMm: 2100 },
        { id: 'ob-tomada', kind: 'outlet', xMm: 3050, yMm: 300, widthMm: 80, heightMm: 80 },
      ],
    },
    first: { id: 'g1', name: 'Cabideiro', size: [900, 2400, 600], materialId: 'white', preset: 'niche' },
    ops: [
      { kind: 'cell.split', id: 'g1:root', axis: 'y', gapMm: 1900 },
      { kind: 'front.set', id: 'g1:root:low', type: 'double', materialId: 'freijo' },
      { kind: 'front.set', id: 'g1:root:high', type: 'double', materialId: 'freijo' },
      ...add('g2', 'Gaveteiro', [900, 2400, 600], 'white'),
      beside('g1', 'g2', true),
      { kind: 'cell.split', id: 'g2:root', axis: 'y', gapMm: 1900 },
      { kind: 'cell.split', id: 'g2:root:low', axis: 'y', gapMm: 640 },
      { kind: 'front.set', id: 'g2:root:low:low', type: 'drawers', count: 3, materialId: 'freijo' },
      { kind: 'front.set', id: 'g2:root:low:high', type: 'double', materialId: 'freijo' },
      { kind: 'front.set', id: 'g2:root:high', type: 'double', materialId: 'freijo' },
      ...add('g3', 'Coluna de portas', [600, 2400, 600], 'white'),
      beside('g2', 'g3', true),
      { kind: 'cell.split', id: 'g3:root', axis: 'y', gapMm: 1900 },
      { kind: 'front.set', id: 'g3:root:low', type: 'single', hinge: 'right', materialId: 'freijo' },
      { kind: 'front.set', id: 'g3:root:high', type: 'single', hinge: 'right', materialId: 'freijo' },
    ],
  },
  {
    id: 'rack',
    name: 'Rack com torres',
    summary: 'Rack grafite de 1,20 m entre duas torres de nichos em nogueira',
    intro:
      'Montei um conjunto de sala: rack grafite de 120 × 50 × 45 cm com gavetas e portas, entre duas torres de nogueira de 45 × 180 × 35 cm alinhadas pelo fundo. Peça para alargar o rack, trocar as torres por portas ou mudar os acabamentos.',
    first: { id: 'r1', name: 'Torre esquerda', size: [450, 1800, 350], materialId: 'walnut', preset: 'niche' },
    ops: [
      ...stack('r1:root', 4, 1764),
      ...add('r2', 'Rack', [1200, 500, 450], 'graphite'),
      beside('r1', 'r2', false, 'back'),
      { kind: 'cell.split', id: 'r2:root', axis: 'x', gapMm: 380 },
      { kind: 'front.set', id: 'r2:root:low', type: 'drawers', count: 2 },
      { kind: 'front.set', id: 'r2:root:high', type: 'double' },
      ...add('r3', 'Torre direita', [450, 1800, 350], 'walnut'),
      beside('r2', 'r3', false, 'back'),
      ...stack('r3:root', 4, 1764),
    ],
  },
  {
    id: 'aparador',
    name: 'Aparador',
    summary: 'Buffet de 1,80 m em nogueira com frentes verde sálvia',
    intro:
      'Montei um aparador de 180 × 80 × 45 cm em nogueira: portas nas pontas e três gavetas no centro, com frentes em verde sálvia. Peça para trocar as cores, aumentar as gavetas ou deixar um nicho aberto.',
    first: { id: 'a1', name: 'Portas esquerda', size: [600, 800, 450], materialId: 'walnut', preset: 'niche' },
    ops: [
      { kind: 'front.set', id: 'a1:root', type: 'double', materialId: 'sage' },
      ...add('a2', 'Gavetas', [600, 800, 450], 'walnut'),
      beside('a1', 'a2', true),
      { kind: 'front.set', id: 'a2:root', type: 'drawers', count: 3, materialId: 'sage' },
      ...add('a3', 'Portas direita', [600, 800, 450], 'walnut'),
      beside('a2', 'a3', true),
      { kind: 'front.set', id: 'a3:root', type: 'double', materialId: 'sage' },
    ],
  },
  {
    id: 'sapateira',
    name: 'Sapateira de entrada',
    summary: 'Nichos para sapatos, gavetas e porta, em areia',
    intro:
      'Montei uma sapateira de entrada de 160 × 110 × 35 cm em areia: coluna de nichos abertos para sapatos à esquerda e, à direita, porta em cima e duas gavetas embaixo. Peça para aumentar a quantidade de nichos ou trocar a porta por gavetas.',
    first: { id: 's1', name: 'Nichos', size: [800, 1100, 350], materialId: 'sand', preset: 'niche' },
    ops: [
      ...stack('s1:root', 5, 1064),
      ...add('s2', 'Porta e gavetas', [800, 1100, 350], 'sand'),
      beside('s1', 's2', true),
      { kind: 'cell.split', id: 's2:root', axis: 'y', gapMm: 440 },
      { kind: 'front.set', id: 's2:root:low', type: 'drawers', count: 2 },
      { kind: 'front.set', id: 's2:root:high', type: 'single', hinge: 'right' },
    ],
  },
];

export function templateById(id: string) {
  return templates.find((t) => t.id === id);
}

/** Aplica o modelo no motor e devolve a composição validada. */
export function buildTemplate(t: Template): Composition {
  const first = preset(t.first.preset, t.first.id);
  first.name = t.first.name;
  let d: Composition = {
    schemaVersion: 3,
    profile: PROFILE,
    modules: [first],
    connections: [],
  };
  d = applyModularOp(d, {
    kind: 'module.edit',
    id: t.first.id,
    width: t.first.size[0],
    height: t.first.size[1],
    depth: t.first.size[2],
    materialId: t.first.materialId,
  });
  for (const [i, op] of t.ops.entries()) {
    try {
      d = applyModularOp(d, op);
    } catch (e) {
      throw new Error(`Modelo ${t.id}, operação ${i + 1} (${op.kind}): ${(e as Error).message}`);
    }
  }
  generateComposition(d);
  return d;
}
