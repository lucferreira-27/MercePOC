import { z } from 'zod';
import { categoryOf, defaults, materials, materialIds, materialOf, sheetIds, type Face, type MaterialCategory, type Part, type MaterialId } from './furniture';
import * as legacy from './design';
import {
  CORNICE,
  DEFAULT_HANDLE_MATERIAL,
  FRONT_STYLES,
  FRONTS,
  framedFront,
  HANDLE_TYPES,
  LEGS,
  lookIssues,
  lookPatchSchema,
  lookSchema,
  patchLook,
  PLINTH_RECESS,
  STYLE_IDS,
  type FrontStyle,
  type HandleType,
  type Look,
  type LookPatch,
  type StyleId,
  type TopSpec,
} from './look';

/** Versão do projeto gravado. A v4 somou estilo e acabamento (`look`); v2 e v3 migram na leitura. */
export const SCHEMA_VERSION = 4;

export const PROFILE = {
  version: 1,
  panel: 18,
  back: 6,
  front: 18,
  reveal: 2,
  drawer: 15,
  drawerBottom: 6,
  slideSpace: 13,
  rearSpace: 20,
} as const;
type Vec = [number, number, number];
/** Porta de correr: folhas em dois trilhos, o de trás recuado isto (mm). */
export const SLIDE_TRACK = PROFILE.front + 4;
/** Folhas de correr vizinhas se sobrepõem isto (mm), para fechar sem fresta. */
export const SLIDE_OVERLAP = 30;
/** Basculante: altura da folha (mm); acima disso o pistão não segura. */
export const FLAP_HEIGHT = [150, 700] as const;
export type Front = {
  id: string;
  /**
   * Porta de giro (uma ou duas folhas), gavetas, porta de correr (folhas =
   * `heights.length`, em dois trilhos) ou basculante (abre para cima).
   */
  type: 'single' | 'double' | 'drawers' | 'sliding' | 'flap';
  hinge: 'left' | 'right';
  materialId?: MaterialId;
  heights: number[];
  /** Estilo desta frente, no lugar do estilo do módulo (`look.front`). */
  style?: FrontStyle;
  /** Puxador desta frente, no lugar do puxador do módulo (`look.handle`). */
  handle?: HandleType;
};
export type Cell = {
  id: string;
  front?: Front;
  split?: {
    id: string;
    axis: 'x' | 'y';
    ratio: number;
    legacyShelf?: boolean;
    children: [Cell, Cell];
  };
};
export type Module = {
  id: string;
  name: string;
  width: number;
  height: number;
  depth: number;
  materialId: MaterialId;
  back: boolean;
  position: Vec;
  rotation: 0 | 90 | 180 | 270;
  root: Cell;
  legacyIds?: boolean;
  /**
   * Painel de parede (painel de TV, cabeceira): uma chapa só, sem caixa nem
   * compartimentos. `depth` é a espessura. Prateleira de parede (`ledge`):
   * uma tábua horizontal presa na parede ou num painel; `height` é a
   * espessura e `depth` o quanto ela avança. Ausente, o módulo é uma caixa.
   */
  kind?: 'panel' | 'ledge';
  /** Pés: altura em mm que levanta a caixa do piso (0 ou ausente, sem pés). */
  feet?: number;
  /** Suspenso de propósito, preso na parede (aéreo, rack suspenso). */
  wall?: boolean;
  /**
   * Preso na frente de um painel de parede (mountOnPanels): o grupo avançou
   * `by` mm, a espessura do painel. Só na raiz do grupo e só o app escreve.
   * Guardado para desfazer: painel que encolhe, sai ou muda de espessura
   * devolve o móvel à parede ou reajusta.
   */
  mountedOn?: { panel: string; by: number };
  /**
   * Acabamento além do material: base (pés, rodapé, estrutura), puxador,
   * estilo da frente, tampo sobreposto e detalhes (moldura, contorno de aço,
   * fundo de outra cor, LED). Ausente, o módulo é como na v3. Ver `lib/look.ts`.
   */
  look?: Look;
};
export type Connection = {
  id: string;
  parent: string;
  child: string;
  side: 'right' | 'left' | 'top';
  shared: boolean;
  align: 'front' | 'back';
  offset: number;
};
export type Composition = {
  schemaVersion: typeof SCHEMA_VERSION;
  profile: typeof PROFILE;
  modules: Module[];
  connections: Connection[];
  /**
   * Estilo escolhido para o projeto: só rótulo (tela, IA, peças novas). O
   * desenho vem do `look` de cada módulo, então mudar a definição de um estilo
   * não mexe em projeto salvo.
   */
  style?: StyleId;
};
/** Projeto gravado antes da v4: mesma forma, sem estilo nem acabamento. */
export type CompositionV3 = Omit<Composition, 'schemaVersion' | 'style'> & { schemaVersion: 3 };
/** Limites do painel de parede: cabe numa chapa de 2750 × 1840 mm. */
export const PANEL_LIMITS = { long: 2700, short: 1800, thickness: [15, 60], feet: [0, 300] } as const;
/** Prateleira de parede: tábua de até 2700 mm (uma chapa), 15 a 60 de espessura, 150 a 600 de profundidade. */
export const LEDGE_LIMITS = { long: 2700, thickness: [15, 60], depth: [150, 600] } as const;
/** Módulo sem caixa (painel ou prateleira de parede): sem compartimentos, frentes, pés nem conexões. */
export const isFlat = (m: Pick<Module, 'kind'>) => m.kind === 'panel' || m.kind === 'ledge';
/** Base do módulo: sem tipo, pés de caixa são o pé palito da v3. */
export const legsOf = (m: Pick<Module, 'look'>) => m.look?.legs ?? 'palito';
export type Foot = {
  moduleId: string;
  /** Centro do pé no mundo, em mm. */
  position: Vec;
  height: number;
  /** Raio no topo e no piso: o pé palito afina para baixo. */
  radius: [number, number];
};
export type ModularPart = Part & {
  owners: string[];
  cellId?: string;
  color: string;
  rotation: number;
  /**
   * Como a frente abre: porta gira no eixo vertical da dobradiça, gaveta
   * corre para a frente, porta de correr corre de lado no trilho dela
   * (`direction` no x do módulo) e basculante gira no eixo da aresta de cima.
   */
  motion?: {
    id: string;
    type: 'door' | 'drawer' | 'slide' | 'flap';
    pivot: Vec;
    direction: number;
    travel: number;
    /** Folha de correr: trilho da frente (0) ou de trás (1). */
    track?: number;
  };
};
/**
 * O que abre quando a pessoa abre todas as frentes: tudo, menos a folha de
 * correr do trilho de trás. Abrindo as duas, elas só trocam de lugar e o
 * armário continua fechado; a da frente corre por cima da de trás.
 */
export function openAllGroups(parts: readonly ModularPart[]) {
  return [...new Set(parts.filter((p) => p.motion && !(p.motion.type === 'slide' && p.motion.track === 1)).map((p) => p.motion!.id))];
}
export type CellInfo = {
  id: string;
  moduleId: string;
  label: string;
  origin: Vec;
  size: Vec;
  node: Cell;
};
const mid = z.string().min(1).max(100);
const material = z.enum(materialIds);
export function validationMessage(error: z.ZodError) {
  // União de operações recusa sem dizer o campo: cada ramo vira uma lista de
  // falhas e o ramo que aceitou o `kind` é o que diz o campo culpado.
  const leaves: z.core.$ZodIssue[][] = [];
  const collect = (list: z.core.$ZodIssue[]) => {
    const union = list.find((i) => i.code === 'invalid_union');
    if (!union || union.code !== 'invalid_union') {
      leaves.push(list);
      return;
    }
    for (const branch of union.errors) collect(branch.flat());
  };
  collect(error.issues);
  /** Ruído dos outros ramos: o `kind` deles e as chaves que eles não conhecem. */
  const noise = (list: z.core.$ZodIssue[]) =>
    (list.some((i) => i.path.at(-1) === 'kind') ? 2 : 0) +
    (list.some((i) => i.code === 'unrecognized_keys') ? 1 : 0);
  const best = [...leaves].sort(
    (a, b) => noise(a) - noise(b) || a.length - b.length,
  )[0];
  const issue = [...best].sort((a, b) => b.path.length - a.path.length)[0];
  // Regra entre campos (painel, pés) já vem com a frase certa.
  if (issue?.code === 'custom' && issue.message) return issue.message;
  const path = issue?.path ?? [],
    last = path.at(-1);
  // O índice de um vetor (position.1) não é nome de campo: vira o eixo.
  const field =
    typeof last === 'number' && path.at(-2) === 'position'
      ? (['x', 'y', 'z'][last] ?? 'position')
      : String(path.filter((p) => typeof p === 'string').at(-1) ?? 'pedido');
  const labels: Record<string, string> = {
    width: 'Largura: 200 a 1200 mm (painel e prateleira de parede até 2700 mm).',
    height: 'Altura: 200 a 2400 mm (painel de parede até 2700 mm; prateleira de parede: espessura de 15 a 60 mm).',
    depth: 'Profundidade: 200 a 800 mm (espessura do painel: 15 a 60 mm).',
    feet: 'Pés: 0 (sem pés) ou de 50 a 300 mm.',
    count: 'Use de uma a seis gavetas.',
    modules: 'Use de um a 12 módulos.',
    ratio:
      'A divisão deve ficar dentro do compartimento, mantendo os vãos livres.',
    rotation: 'Orientações permitidas: 0°, 90°, 180° e 270°.',
    gap: 'Vão da divisória: pelo menos 100 mm.',
    gapMm: 'O vão livre precisa de pelo menos 100 mm.',
    offset: 'Afastamento permitido: 0 a 5000 mm.',
    name: 'Nome do módulo: 1 a 80 caracteres.',
    position: 'Posição entre -20000 e 20000 mm, com Y a partir de 0.',
    x: 'Posição X entre -20000 e 20000 mm.',
    y: 'Posição Y entre 0 e 20000 mm.',
    z: 'Posição Z entre -20000 e 20000 mm.',
    materialId: `Acabamento inválido: use ${materialIds.join(', ')}.`,
    legMaterialId: `Acabamento do pé inválido: use ${materialIds.join(', ')}.`,
    handleMaterialId: `Acabamento do puxador inválido: use ${materialIds.join(', ')}.`,
    insertMaterialId: `Miolo da frente inválido: use ${materialIds.join(', ')}.`,
    frameMaterialId: `Acabamento da estrutura inválido: use ${materialIds.join(', ')}.`,
    backMaterialId: `Acabamento do fundo inválido: use ${materialIds.join(', ')}.`,
    legs: `Base: use ${Object.keys(LEGS).join(', ')}.`,
    handle: `Puxador: use ${HANDLE_TYPES.join(', ')}.`,
    style: `Estilo: use ${STYLE_IDS.join(', ')} (frente: ${FRONT_STYLES.join(', ')}).`,
    edge: 'Borda do tampo: square, rounded ou chamfer.',
    thickness: 'Espessura do tampo: de 3 a 60 mm, conforme o material.',
    overhang: 'Avanço do tampo: de 0 a 60 mm.',
    back: 'Fundo só aceita ligado ou desligado.',
    preset: 'Preset inválido: use shelf, niche, rack, drawers, panel ou ledge.',
    presets: 'Preset inválido: use shelf, niche, rack, drawers, panel ou ledge.',
    side: 'Posição permitida: à direita, à esquerda ou empilhado acima.',
    align: 'Alinhamento permitido: frentes ou fundos.',
  };
  return (
    labels[field] ??
    `Valor inválido em ${issue?.path.join('.') || 'pedido'}. Confira os campos e limites do projeto.`
  );
}
const frontSchema: z.ZodType<Front> = z
  .object({
    id: mid,
    type: z.enum(['single', 'double', 'drawers', 'sliding', 'flap']),
    hinge: z.enum(['left', 'right']),
    materialId: material.optional(),
    heights: z.array(z.number().positive()).min(1).max(6),
    style: z.enum(FRONT_STYLES).optional(),
    handle: z.enum(HANDLE_TYPES).optional(),
  })
  .strict();
const cellSchema: z.ZodType<Cell> = z.lazy(() =>
  z
    .object({
      id: mid,
      front: frontSchema.optional(),
      split: z
        .object({
          id: mid,
          axis: z.enum(['x', 'y']),
          ratio: z.number().gt(0).lt(1),
          legacyShelf: z.boolean().optional(),
          children: z.tuple([cellSchema, cellSchema]),
        })
        .strict()
        .optional(),
    })
    .strict(),
);
export const compositionSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    style: z.enum(STYLE_IDS).optional(),
    profile: z
      .object({ version: z.literal(1) })
      .loose()
      .transform(() => PROFILE),
    modules: z
      .array(
        z
          .object({
            id: mid,
            name: z.string().trim().min(1).max(80),
            width: z.number().min(200).max(PANEL_LIMITS.long),
            // A espessura da prateleira de parede mora na altura: o piso de 200
            // mm da caixa e do painel é conferido por tipo, logo abaixo.
            height: z.number().min(LEDGE_LIMITS.thickness[0]).max(PANEL_LIMITS.long),
            depth: z.number().min(PANEL_LIMITS.thickness[0]).max(800),
            materialId: material,
            back: z.boolean(),
            position: z.tuple([
              z.number().min(-20000).max(20000),
              z.number().min(0).max(20000),
              z.number().min(-20000).max(20000),
            ]),
            rotation: z.union([
              z.literal(0),
              z.literal(90),
              z.literal(180),
              z.literal(270),
            ]),
            root: cellSchema,
            legacyIds: z.boolean().optional(),
            kind: z.enum(['panel', 'ledge']).optional(),
            feet: z.number().min(0).max(PANEL_LIMITS.feet[1]).optional(),
            wall: z.boolean().optional(),
            mountedOn: z.object({ panel: mid, by: z.number().int().min(1).max(PANEL_LIMITS.thickness[1]) }).strict().optional(),
            look: lookSchema.optional(),
          })
          .strict()
          .superRefine((m, ctx) => {
            const fail = (path: string, message: string) =>
              ctx.addIssue({ code: 'custom', path: [path], message });
            for (const issue of lookIssues(m)) fail(issue.path, issue.message);
            // Frentes: chapa de MDF; vidro, tela e palhinha só em porta.
            walk(m.root, (c) => {
              const f = c.front;
              if (!f) return;
              // Frente de chapa; de aço só como quadro de porta (serralheria),
              // com vidro, tela, palhinha ou almofada de madeira no miolo.
              const cat = f.materialId ? categoryOf(f.materialId) : 'sheet';
              const framed = f.type !== 'drawers' && framedFront(f.style ?? m.look?.front);
              if (cat !== 'sheet' && !(cat === 'metal' && framed))
                fail('materialId', `${m.name}: frente em ${materialOf(f.materialId!).name} não dá; a frente é de chapa (${sheetIds.join(', ')}). Aço só no quadro de uma porta de vidro, tela, palhinha ou almofada (look.front glass, mesh, cane ou framed); o miolo vai em insertMaterialId.`);
              if (f.type === 'drawers' && framedFront(f.style))
                fail('style', `${m.name}: gaveta não leva ${FRONTS[f.style!].name}; use lisa, shaker ou ripada.`);
            });
            if (m.kind === 'panel') {
              if (m.depth > PANEL_LIMITS.thickness[1])
                fail('depth', `${m.name}: painel de parede com 15 a 60 mm de espessura.`);
              if (Math.min(m.width, m.height) > PANEL_LIMITS.short)
                fail('width', `${m.name}: painel de até 2700 × 1800 mm (uma chapa).`);
              if (m.root.split || m.root.front)
                fail('root', `${m.name}: painel de parede não tem compartimentos nem frentes.`);
              if (m.feet) fail('feet', `${m.name}: painel de parede não leva pés.`);
              if (m.height < 200) fail('height', `${m.name}: painel de parede com 200 a 2700 mm de altura.`);
            } else if (m.kind === 'ledge') {
              if (m.height > LEDGE_LIMITS.thickness[1])
                fail('height', `${m.name}: prateleira de parede com 15 a 60 mm de espessura (altura).`);
              if (m.depth < LEDGE_LIMITS.depth[0] || m.depth > LEDGE_LIMITS.depth[1])
                fail('depth', `${m.name}: prateleira de parede com 150 a 600 mm de profundidade.`);
              if (m.root.split || m.root.front)
                fail('root', `${m.name}: prateleira de parede não tem compartimentos nem frentes.`);
              if (m.feet) fail('feet', `${m.name}: prateleira de parede não leva pés.`);
            } else {
              if (m.width > 1200) fail('width', 'Largura: 200 a 1200 mm.');
              if (m.height > 2400 || m.height < 200) fail('height', 'Altura: 200 a 2400 mm.');
              if (m.depth < 200) fail('depth', 'Profundidade: 200 a 800 mm.');
            }
            if (m.feet && m.feet < 50) fail('feet', 'Pés: 0 (sem pés) ou de 50 a 300 mm.');
          }),
      )
      .min(1)
      .max(12),
    connections: z
      .array(
        z
          .object({
            id: mid,
            parent: mid,
            child: mid,
            side: z.enum(['right', 'left', 'top']),
            shared: z.boolean(),
            align: z.enum(['front', 'back']),
            offset: z.number().min(0).max(5000),
          })
          .strict(),
      )
      .max(11),
  })
  .strict();
function uid(prefix: string) {
  return prefix + '-' + crypto.randomUUID().slice(0, 12);
}
export function point(p: Vec, m: Module): Vec {
  const a = (m.rotation * Math.PI) / 180;
  return [
    m.position[0] + p[0] * Math.cos(a) + p[2] * Math.sin(a),
    // Os pés levantam a caixa: a posição é o piso do módulo, a caixa começa
    // na altura dos pés.
    m.position[1] + (m.feet ?? 0) + p[1],
    m.position[2] - p[0] * Math.sin(a) + p[2] * Math.cos(a),
  ];
}
/**
 * Milímetro inteiro da lista de corte. O marceneiro corta em milímetro cheio,
 * então 185,33 não existe na oficina: o ruído do ponto flutuante volta a ser
 * inteiro e a fração real é truncada, deixando a sobra para quem fecha a soma.
 */
function wholeMm(value: number): number {
  const near = Math.round(value);
  if (Math.abs(value - near) < 1e-6) return near;
  return Math.floor(value);
}
/**
 * Divide um espaço em partes de milímetro inteiro que somam exatamente o
 * espaço disponível, na proporção dos pesos. Lista de corte que fecha em mm é
 * requisito de oficina: três frentes de 185,33 mm não fecham os 556 mm do vão
 * interno. Cada parte recebe floor(espaço / N) e a última fica com a sobra, de
 * baixo para cima nas gavetas e à direita nas colunas.
 */
function wholeParts(space: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => wholeMm((space * w) / total));
  const last = parts.length - 1;
  parts[last] += space - parts.reduce((a, b) => a + b, 0);
  return parts;
}
/**
 * v3 → v4: mesma geometria, sem estilo nem acabamento. Os campos novos são
 * opcionais, então a migração só troca a versão; o teste de migração confere
 * peças, desenho e orçamento contra o retrato da v3.
 */
export function migrateComposition(
  input: legacy.Design | CompositionV3 | Composition,
): Composition {
  if (input.schemaVersion === SCHEMA_VERSION) return compositionSchema.parse(input);
  if (input.schemaVersion === 3) return compositionSchema.parse({ ...input, schemaVersion: SCHEMA_VERSION });
  const d = input;
  const shelves = legacy.sortedShelves(d);
  function tree(i: number, start: number): Cell {
    // Sem prateleiras, este nó É o vão inteiro do módulo. Manter o id
    // 'cell-root' preserva a identidade da raiz: remover todas as prateleiras
    // renomeava a raiz para 'cell-legacy-0' e qualquer split seguinte falhava
    // com "Compartimento cell-root não encontrado".
    if (i === shelves.length)
      return { id: i === 0 ? 'cell-root' : `cell-legacy-${i}` };
    const shelf = shelves[i];
    const free = d.height - 18 - start - 18;
    return {
      id: i === 0 ? 'cell-root' : `cell-upper-${i}`,
      split: {
        id: shelf.id,
        axis: 'y',
        ratio: (shelf.elevation - start) / free,
        legacyShelf: true,
        children: [
          { id: `cell-legacy-${i}` },
          tree(i + 1, shelf.elevation + 18),
        ],
      },
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: PROFILE,
    modules: [
      {
        id: 'module-1',
        name: 'Estante',
        width: d.width,
        height: d.height,
        depth: d.depth,
        materialId: d.materialId,
        back: true,
        position: [0, 0, 0],
        rotation: 0,
        root: tree(0, 18),
        legacyIds: true,
      },
    ],
    connections: [],
  };
}
export type PresetId = 'shelf' | 'niche' | 'rack' | 'drawers' | 'panel' | 'ledge';
export function preset(type: PresetId, id = uid('module')): Module {
  const base = migrateComposition(legacy.migrateParams(defaults)).modules[0];
  base.id = id;
  base.legacyIds = false;
  base.root = { id: `${id}:root` };
  if (type === 'panel') {
    // Painel de parede: chapa de 25 mm, sem fundo nem compartimentos.
    base.kind = 'panel';
    base.name = 'Painel';
    base.width = 1800;
    base.height = 1200;
    base.depth = 25;
    base.back = false;
  } else if (type === 'ledge') {
    // Prateleira de parede: tábua de 25 mm presa na parede, 25 cm de fundo.
    base.kind = 'ledge';
    base.name = 'Prateleira de parede';
    base.width = 800;
    base.height = 25;
    base.depth = 250;
    base.back = false;
  } else if (type === 'shelf') {
    base.name = 'Estante';
    // Cinco vãos iguais em milímetro inteiro: a sobra fica no vão de cima,
    // como na última gaveta, porque só milímetro cheio entra na lista de corte.
    const gaps = wholeParts(base.height - 6 * PROFILE.panel, [1, 1, 1, 1, 1]);
    let node = base.root,
      space = base.height - 2 * PROFILE.panel;
    for (let i = 0; i < 4; i++) {
      const rest = space - PROFILE.panel;
      node.split = {
        id: uid('panel'),
        axis: 'y',
        ratio: gaps[i] / rest,
        children: [{ id: uid('cell') }, { id: uid('cell') }],
      };
      node = node.split.children[1];
      space = rest - gaps[i];
    }
  } else {
    base.height = 600;
    base.depth = 450;
    base.name =
      type === 'niche' ? 'Nicho' : type === 'rack' ? 'Rack' : 'Gaveteiro';
    if (type !== 'niche')
      base.root.front = {
        id: uid('front'),
        type: type === 'rack' ? 'double' : 'drawers',
        hinge: 'left',
        heights: type === 'drawers' ? [1, 1, 1] : [1],
      };
  }
  return base;
}
function moduleBy(d: Composition, id: string) {
  const m = d.modules.find((m) => m.id === id);
  if (!m) throw new Error(`Módulo ${id} não encontrado.`);
  return m;
}
/** Dois módulos com o mesmo nome são indistinguíveis na árvore e no CSV. */
function uniqueName(d: Composition, name: string) {
  const taken = new Set(d.modules.map((m) => m.name));
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
function walk(node: Cell, fn: (c: Cell) => void) {
  fn(node);
  if (node.split) node.split.children.forEach((c) => walk(c, fn));
}
function cellBy(d: Composition, id: string) {
  let result: { m: Module; c: Cell } | undefined;
  for (const m of d.modules)
    walk(m.root, (c) => {
      if (c.id === id || c.split?.id === id || c.front?.id === id)
        result = { m, c };
    });
  if (!result) throw new Error(`Compartimento ${id} não encontrado.`);
  if (isFlat(result.m))
    throw new Error(`${result.m.name} é ${result.m.kind === 'ledge' ? 'uma prateleira de parede' : 'um painel de parede'}: não tem compartimentos nem frentes.`);
  return result;
}
function sharedSides(d: Composition, m: Module) {
  const sides = new Set<string>();
  for (const c of d.connections.filter((c) => c.shared)) {
    if (c.parent === m.id) sides.add(c.side === 'top' ? 'top' : c.side);
    if (c.child === m.id)
      sides.add(
        c.side === 'top' ? 'base' : c.side === 'right' ? 'left' : 'right',
      );
  }
  return sides;
}
export function settle(d: Composition, enforce = true) {
  const children = new Set<string>();
  for (const c of d.connections) {
    if (c.parent === c.child || children.has(c.child))
      throw new Error('Cada módulo conectado precisa de um único pai.');
    children.add(c.child);
    moduleBy(d, c.parent);
    moduleBy(d, c.child);
  }
  const visited = new Set<string>();
  function visit(m: Module, anc: Set<string>) {
    if (anc.has(m.id)) throw new Error('Conexões em ciclo não são permitidas.');
    visited.add(m.id);
    const next = new Set([...anc, m.id]);
    for (const c of d.connections.filter((c) => c.parent === m.id)) {
      const child = moduleBy(d, c.child);
      if (c.shared && enforce) {
        // Um painel compartilhado só existe quando as duas faces coincidem.
        // O erro nomeia cada diferença para o usuário saber o que ajustar.
        const differences: string[] = [];
        if (c.offset !== 0) differences.push(`afastamento de ${c.offset} mm`);
        if (m.rotation !== child.rotation)
          differences.push(`orientação ${m.rotation}° × ${child.rotation}°`);
        if (m.materialId !== child.materialId)
          differences.push('acabamento diferente');
        if ((m.feet ?? 0) !== (child.feet ?? 0))
          differences.push(`pés de ${m.feet ?? 0} × ${child.feet ?? 0} mm`);
        else if (m.feet && legsOf(m) !== legsOf(child))
          differences.push(`base ${LEGS[legsOf(m)].name} × ${LEGS[legsOf(child)].name}`);
        if (c.side === 'top' && m.look?.top)
          differences.push(`${m.name} tem tampo sobreposto (sem painel para dividir)`);
        if (m.depth !== child.depth)
          differences.push(
            `profundidade ${m.depth} × ${child.depth} mm em ${m.name} e ${child.name}`,
          );
        if (c.side === 'top' ? m.width !== child.width : m.height !== child.height)
          differences.push(
            c.side === 'top'
              ? `largura ${m.width} mm em ${m.name} × ${child.width} mm em ${child.name}`
              : `altura ${m.height} mm em ${m.name} × ${child.height} mm em ${child.name}`,
          );
        if (differences.length)
          throw new Error(
            `Painel compartilhado exige faces iguais e afastamento 0. Diferença em ${differences.join(', ')}. Iguale os dois módulos ou use "Separar módulos" antes de editar.`,
          );
      }
      const angle = (child.rotation - m.rotation + 360) % 360;
      const w = angle % 180 === 0 ? child.width : child.depth;
      const dep = angle % 180 === 0 ? child.depth : child.width;
      const dx =
        c.side === 'top'
          ? 0
          : (c.side === 'right' ? 1 : -1) *
            ((m.width + w) / 2 - (c.shared ? 18 : 0) + c.offset);
      if (c.side === 'top' && m.look?.cornice && enforce)
        throw new Error(`${m.name} tem moldura no topo: nada vai em cima dela. Tire a moldura (look.cornice) ou ponha ${child.name} em outro lugar.`);
      // Em cima de um tampo sobreposto, o filho apoia no tampo.
      const y =
        c.side === 'top' ? m.height - (c.shared ? 18 : 0) + c.offset + (m.look?.top && !c.shared ? m.look.top.thickness : 0) : 0;
      const dz =
        c.align === 'front' ? (m.depth - dep) / 2 : -(m.depth - dep) / 2;
      child.position = point([dx, y, dz], m);
      // Lado a lado, os dois ficam no mesmo piso: a posição é o chão do
      // módulo e os pés de cada um levantam só a própria caixa. Em cima, o
      // filho apoia no tampo do pai (point já soma os pés do pai).
      if (c.side !== 'top') child.position[1] = m.position[1];
      visit(child, next);
    }
  }
  for (const m of d.modules.filter((m) => !children.has(m.id)))
    visit(m, new Set());
  if (visited.size !== d.modules.length)
    throw new Error('Conexões em ciclo não são permitidas.');
}
export function layout(d: Composition) {
  const cells: CellInfo[] = [];
  /** `behind`: a frente que cobre a divisão (porta de correr pede mais recuo). */
  const panels: { m: Module; c: Cell; origin: Vec; size: Vec; behind?: Front['type'] }[] = [];
  for (const m of d.modules) {
    if (isFlat(m)) continue;
    const depth = m.depth - (m.back ? PROFILE.back : 0);
    let order = 0;
    // `cover`: a porta de um vão acima que já cobre este (prateleiras atrás da porta).
    function visit(c: Cell, origin: Vec, size: Vec, cover?: Front['type']) {
      const covered = !!cover;
      cells.push({
        id: c.id,
        moduleId: m.id,
        label: `${m.name} / compartimento ${++order}`,
        origin,
        size,
        node: c,
      });
      if (size[0] < 100 - 1e-6 || size[1] < 100 - 1e-6)
        throw new Error(
          `${m.name}: compartimento de ${Math.round(size[0])} × ${Math.round(size[1])} mm. Mínimo livre de 100 mm.`,
        );
      if (c.front && covered)
        throw new Error(`${m.name}: este vão fica atrás de uma porta que cobre o vão de fora; tire uma das duas frentes.`);
      if (c.split) {
        // Porta pode cobrir um vão dividido (prateleiras atrás da porta, como
        // num armário de cozinha); gaveta não: a caixa bateria nas divisões.
        if (c.front?.type === 'drawers')
          throw new Error('Remova a frente antes de dividir o compartimento.');
        if (c.front && c.split.legacyShelf)
          throw new Error(`${m.name}: as prateleiras antigas vão até a frente; porta cobrindo o vão pede prateleiras novas (cell.split).`);
        const axis = c.split.axis === 'x' ? 0 : 1;
        const exact = (size[axis] - PROFILE.panel) * c.split.ratio,
          near = Math.round(exact);
        // As divisões novas já nascem em milímetro inteiro (split, move,
        // distribute e resize calculam o vão cheio), então aqui só cai o ruído
        // do ponto flutuante: 556 * (185 / 556) sai 184,99999999999997. Fração
        // herdada de projeto antigo passa intacta, senão a migração de v2
        // perderia a geometria das prateleiras.
        const length = Math.abs(exact - near) < 1e-6 ? near : exact;
        const psize: [number, number, number] = [...size];
        psize[axis] = PROFILE.panel;
        const pos: Vec = [...origin];
        pos[axis] += length;
        panels.push({ m, c, origin: pos, size: psize, ...(cover ?? c.front?.type ? { behind: cover ?? c.front!.type } : {}) });
        const low: Vec = [...size];
        low[axis] = length;
        const high: Vec = [...size];
        high[axis] = size[axis] - length - PROFILE.panel;
        const upper: Vec = [...origin];
        upper[axis] += length + PROFILE.panel;
        visit(c.split.children[0], origin, low, cover ?? c.front?.type);
        visit(c.split.children[1], upper, high, cover ?? c.front?.type);
      }
    }
    visit(
      m.root,
      [
        -m.width / 2 + PROFILE.panel,
        PROFILE.panel,
        -m.depth / 2 + (m.back ? PROFILE.back : 0),
      ],
      [m.width - 2 * PROFILE.panel, m.height - 2 * PROFILE.panel, depth],
    );
  }
  return { cells, panels };
}
/**
 * Medida da caixa de colisão: a da peça, ou a envolvente no plano y-z quando
 * ela está girada no eixo x (basculante aberta). Conservadora, mas exata nas
 * pontas do movimento.
 */
function sized(p: ModularPart): ModularPart {
  if (!p.tilt) return p;
  const c = Math.abs(Math.cos(p.tilt)),
    s = Math.abs(Math.sin(p.tilt));
  return { ...p, tilt: 0, size: [p.size[0], c * p.size[1] + s * p.size[2], s * p.size[1] + c * p.size[2]] };
}
function bounds(input: ModularPart) {
  const p = sized(input);
  const a = p.rotation;
  const x =
    Math.abs(Math.cos(a)) * p.size[0] + Math.abs(Math.sin(a)) * p.size[2];
  const z =
    Math.abs(Math.sin(a)) * p.size[0] + Math.abs(Math.cos(a)) * p.size[2];
  return {
    min: [
      p.position[0] - x / 2,
      p.position[1] - p.size[1] / 2,
      p.position[2] - z / 2,
    ],
    max: [
      p.position[0] + x / 2,
      p.position[1] + p.size[1] / 2,
      p.position[2] + z / 2,
    ],
  };
}
function collide(rawA: ModularPart, rawB: ModularPart) {
  const a = sized(rawA),
    b = sized(rawB);
  const aa = bounds(a),
    bb = bounds(b);
  if (
    ![0, 1, 2].every(
      (i) =>
        Math.min(aa.max[i], bb.max[i]) - Math.max(aa.min[i], bb.min[i]) > 1e-5,
    )
  )
    return false;
  // Separating axes for oriented rectangular panels (rotation only around Y).
  for (const angle of [
    a.rotation,
    a.rotation + Math.PI / 2,
    b.rotation,
    b.rotation + Math.PI / 2,
  ]) {
    const ux = Math.cos(angle),
      uz = -Math.sin(angle);
    const distance = Math.abs(
      (b.position[0] - a.position[0]) * ux +
        (b.position[2] - a.position[2]) * uz,
    );
    const radius = (p: ModularPart) =>
      (Math.abs(Math.cos(p.rotation - angle)) * p.size[0]) / 2 +
      (Math.abs(Math.sin(p.rotation - angle)) * p.size[2]) / 2;
    if (distance >= radius(a) + radius(b) - 1e-5) return false;
  }
  return true;
}
/**
 * Fileira que divide um tampo ou uma moldura: módulos lado a lado (ligados
 * pela lateral, sem afastamento), com a mesma rotação, o mesmo topo, a mesma
 * profundidade e as frentes alinhadas. Medidas no referencial da fileira: `s`
 * ao longo dela, `f` da parede para a frente, `top` no mundo.
 */
export type Run = { ids: string[]; rotation: number; s0: number; s1: number; back: number; front: number; top: number };
/** Topo da caixa no mundo: piso do módulo, pés e altura. */
const boxTop = (m: Module) => m.position[1] + (m.feet ?? 0) + m.height;
export function runsOf(d: Composition, key: (m: Module) => string | null): Run[] {
  const picked = d.modules.filter((m) => !isFlat(m) && key(m) !== null);
  const parent = new Map(picked.map((m) => [m.id, m.id]));
  const find = (id: string): string => (parent.get(id) === id ? id : find(parent.get(id)!));
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  for (const c of d.connections) {
    if (c.side === 'top' || c.offset !== 0) continue;
    const a = picked.find((m) => m.id === c.parent),
      b = picked.find((m) => m.id === c.child);
    if (!a || !b || key(a) !== key(b) || a.rotation !== b.rotation || a.depth !== b.depth || !near(boxTop(a), boxTop(b))) continue;
    const { front } = axes(a.rotation);
    if (!near(front(a.position), front(b.position))) continue;
    parent.set(find(b.id), find(a.id));
  }
  const groups = new Map<string, Module[]>();
  for (const m of picked) groups.set(find(m.id), [...(groups.get(find(m.id)) ?? []), m]);
  return [...groups.values()].map((members) => {
    const { side, front } = axes(members[0].rotation);
    const spans = members.map((m) => ({ m, s: side(m.position), f: front(m.position) })).sort((a, b) => a.s - b.s);
    // Ponta num painel compartilhado com quem não está na fileira: a peça
    // para no meio do painel e encontra a do vizinho sem sobrepor.
    const half = (m: Module, s: 'left' | 'right') => (sharedSides(d, m).has(s) ? PROFILE.panel / 2 : 0);
    return {
      ids: spans.map((v) => v.m.id),
      rotation: members[0].rotation,
      s0: Math.min(...spans.map((v) => v.s - v.m.width / 2)) + half(spans[0].m, 'left'),
      s1: Math.max(...spans.map((v) => v.s + v.m.width / 2)) - half(spans.at(-1)!.m, 'right'),
      back: Math.min(...spans.map((v) => v.f - v.m.depth / 2)),
      front: Math.max(...spans.map((v) => v.f + v.m.depth / 2)),
      top: boxTop(members[0]),
    };
  });
}
/** Ponto do referencial de uma fileira (s ao longo, f para a frente) no mundo. */
export function runPoint(rotation: number, s: number, y: number, f: number): Vec {
  const a = (rotation * Math.PI) / 180;
  return [s * Math.cos(a) + f * Math.sin(a), y, -s * Math.sin(a) + f * Math.cos(a)];
}
/**
 * Caixa do módulo no mundo, com o tampo e a moldura que ele leva em cima e o
 * quanto eles podem avançar para os lados: dois vizinhos não avançam o
 * tampo ou a moldura no mesmo vão entre eles.
 */
function outerBox(m: Module) {
  const a = (m.rotation * Math.PI) / 180,
    c = Math.abs(Math.cos(a)),
    sn = Math.abs(Math.sin(a));
  const reach = Math.max(m.look?.top?.overhang ?? 0, m.look?.cornice ? CORNICE.capReach : 0);
  const hx = (c * m.width + sn * m.depth) / 2 + reach,
    hz = (sn * m.width + c * m.depth) / 2 + reach;
  const y0 = m.position[1],
    y1 = boxTop(m) + (m.look?.top?.thickness ?? 0) + (m.look?.cornice ? CORNICE.fascia + CORNICE.cap : 0);
  return { min: [m.position[0] - hx, y0, m.position[2] - hz], max: [m.position[0] + hx, y1, m.position[2] + hz] };
}
/**
 * Avanço livre na ponta da fileira: a peça passa do lado da caixa só se nada
 * ocupa aquele espaço (vizinho mais alto, outro tampo). Senão para rente.
 */
function freeReach(d: Composition, run: Run, end: 's0' | 's1', reach: number, y0: number, y1: number) {
  if (!reach) return 0;
  const s = end === 's0' ? [run.s0 - reach, run.s0] : [run.s1, run.s1 + reach];
  const corners = [s[0], s[1]].flatMap((sv) => [run.back, run.front + reach].map((fv) => runPoint(run.rotation, sv, 0, fv)));
  const min = [Math.min(...corners.map((p) => p[0])), y0, Math.min(...corners.map((p) => p[2]))],
    max = [Math.max(...corners.map((p) => p[0])), y1, Math.max(...corners.map((p) => p[2]))];
  const blocked = d.modules.some((m) => {
    if (run.ids.includes(m.id)) return false;
    const b = outerBox(m);
    return [0, 1, 2].every((i) => Math.min(max[i], b.max[i]) - Math.max(min[i], b.min[i]) > 0.5);
  });
  return blocked ? 0 : reach;
}
/** Estilo que a frente mostra: o dela, senão o do módulo; gaveta não leva miolo. */
export function frontStyleOf(m: Module, f: Front, drawer: boolean): FrontStyle {
  const s = f.style ?? m.look?.front ?? 'flat';
  return drawer && framedFront(s) ? 'shaker' : s;
}
/** Superfície da frente para a cena e o desenho; lisa não tem. */
function frontFace(style: FrontStyle, w: number, h: number): Face | undefined {
  const frame = Math.round(Math.min(65, Math.max(35, Math.min(w, h) * 0.12)));
  if (style === 'shaker') return { kind: 'shaker', frame };
  if (style === 'slatted') return { kind: 'slatted', pitch: 32 };
  if (framedFront(style)) return { kind: 'frame', frame };
  return undefined;
}
/** Espessura do miolo da porta de quadro: vidro 4, tela 2, palhinha 3, almofada de madeira 15 mm. */
const INSERT_THICKNESS: Partial<Record<MaterialCategory, number>> = { glass: 4, metal: 2, fiber: 3, sheet: 15, solid: 15 };
export function generateComposition(input: Composition, validate = true) {
  const parsed = compositionSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    profile: input.profile,
    modules: input.modules,
    connections: input.connections,
    ...(input.style ? { style: input.style } : {}),
  });
  // O validador fala JSON; a pessoa (e a IA no reparo) recebe a frase.
  if (!parsed.success) throw new Error(validationMessage(parsed.error));
  const d = parsed.data;
  settle(d);
  const { cells, panels } = layout(d);
  const ids = new Set<string>();
  for (const m of d.modules) {
    for (const id of [m.id]) {
      if (ids.has(id)) throw new Error('IDs duplicados.');
      ids.add(id);
    }
    walk(m.root, (c) => {
      for (const id of [c.id, c.split?.id, c.front?.id].filter(
        Boolean,
      ) as string[]) {
        if (ids.has(id)) throw new Error(`ID duplicado: ${id}`);
        ids.add(id);
      }
    });
    if (cells.filter((c) => c.moduleId === m.id && !c.node.split).length > 32)
      throw new Error('Limite de 32 compartimentos por módulo.');
  }
  const parts: ModularPart[] = [];
  const band = (mat: { name: string }) => `${mat.name} 0.4`;
  function add(
    m: Module,
    id: string,
    name: string,
    size: Vec,
    center: Vec,
    thickness: number,
    kind: Part['kind'],
    cellId?: string,
    mat: MaterialId = m.materialId,
    motion?: ModularPart['motion'],
    extra: Pick<ModularPart, 'face' | 'handle'> = {},
  ) {
    const color = materials.find((v) => v.id === mat)!;
    // C/L follow the panel's local plane, independent of placement or opening.
    const horizontal =
      ['base', 'top', 'shelf'].includes(kind) ||
      (kind === 'drawer' && id.endsWith(':bottom'));
    const side =
      ['side', 'divider'].includes(kind) ||
      (kind === 'drawer' && /:left$|:right$/.test(id));
    // Painel de parede: o lado maior corre no comprimento da chapa.
    const dims = kind === 'panel'
      ? [Math.max(size[0], size[1]), Math.min(size[0], size[1])]
      : horizontal
        ? [size[0], size[2]]
        : side
          ? [size[1], size[2]]
          : [size[1], size[0]];
    const sheet = color.category === 'sheet';
    parts.push({
      id,
      name:
        m.legacyIds && d.modules.length === 1 ? name : `${m.name} / ${name}`,
      size,
      position: point(center, m),
      rotation: (m.rotation * Math.PI) / 180,
      c: dims[0],
      l: dims[1],
      thickness,
      kind,
      material: `${color.name} ${thickness}`,
      materialId: color.id,
      category: color.category,
      color: color.color,
      owners: [m.id],
      cellId,
      edges: {
        // Fita só em chapa: vidro, pedra, metal e palhinha não levam.
        c1: kind === 'back' || !sheet ? null : band(color),
        // O painel fica à vista nos quatro lados.
        c2: kind === 'panel' ? band(color) : null,
        l1: kind === 'panel' ? band(color) : null,
        l2: kind === 'panel' ? band(color) : null,
      },
      motion: motion ? { ...motion, pivot: point(motion.pivot, m) } : undefined,
      ...(extra.face ? { face: extra.face } : {}),
      ...(extra.handle ? { handle: extra.handle } : {}),
    });
  }
  /** Peça de uma fileira inteira, no referencial dela (tampo, moldura). */
  function addRun(run: Run, id: string, name: string, s0: number, s1: number, y0: number, y1: number, f0: number, f1: number, kind: Part['kind'], mat: MaterialId, edges: (keyof ModularPart['edges'])[], face?: Face) {
    const color = materialOf(mat);
    const first = moduleBy(d, run.ids[0]),
      last = moduleBy(d, run.ids.at(-1)!);
    const size: Vec = [s1 - s0, y1 - y0, f1 - f0];
    // Tábua simples: a menor medida é a espessura, a maior corre no C (veio).
    const [thin, mid, long] = [...size].sort((a, b) => a - b);
    parts.push({
      id,
      name: run.ids.length === 1 ? `${first.name} / ${name}` : `${name} (${first.name} a ${last.name})`,
      size,
      position: runPoint(run.rotation, (s0 + s1) / 2, (y0 + y1) / 2, (f0 + f1) / 2),
      rotation: (run.rotation * Math.PI) / 180,
      c: long,
      l: mid,
      thickness: thin,
      kind,
      material: `${color.name} ${Math.round(thin * 100) / 100}`,
      materialId: color.id,
      category: color.category,
      color: color.color,
      owners: [...run.ids],
      edges: Object.fromEntries((['c1', 'c2', 'l1', 'l2'] as const).map((k) => [k, color.category === 'sheet' && edges.includes(k) ? band(color) : null])) as ModularPart['edges'],
      ...(face ? { face } : {}),
    });
  }
  /**
   * Porta de quadro: o miolo (vidro, tela ou palhinha) entra no rebaixo do
   * quadro, 8 mm de cada lado, e abre junto com a porta (mesmo movimento).
   */
  function insertOf(m: Module, id: string, label: string, center: Vec, [fw, fh]: [number, number], face: Face | undefined, style: FrontStyle, cellId: string, motion: ModularPart['motion']) {
    if (face?.kind !== 'frame') return;
    const insert = m.look?.insertMaterialId ?? FRONTS[style].insertDefault!;
    const t = INSERT_THICKNESS[categoryOf(insert)] ?? 4;
    const iw = fw - 2 * face.frame + 16,
      ih = fh - 2 * face.frame + 16;
    if (iw < 60 || ih < 60)
      throw new Error(`${m.name}: frente de ${Math.round(fw)} × ${Math.round(fh)} mm é pequena demais para ${FRONTS[style].name} (o quadro leva ${face.frame} mm de cada lado).`);
    // Miolo 3 mm atrás da face do quadro, dentro da espessura da porta.
    add(m, `${id}:insert`, `${FRONTS[style].insertName} ${label}`, [iw, ih, t], [center[0], center[1], center[2] + PROFILE.front / 2 - 3 - t / 2], t, 'insert', cellId, insert, motion);
  }
  for (const m of d.modules.filter((v) => v.kind === 'panel'))
    add(
      m,
      `${m.id}:panel`,
      'Painel',
      [m.width, m.height, m.depth],
      [0, m.height / 2, 0],
      m.depth,
      'panel',
      undefined,
      m.materialId,
      undefined,
      m.look?.front === 'slatted' ? { face: { kind: 'slatted', pitch: 32 } } : m.look?.front === 'perforated' ? { face: { kind: 'perforated', pitch: 25 } } : {},
    );
  // Prateleira de parede: uma tábua horizontal, com fita nos quatro lados.
  for (const m of d.modules.filter((v) => v.kind === 'ledge')) {
    add(m, `${m.id}:ledge`, 'Prateleira de parede', [m.width, m.height, m.depth], [0, m.height / 2, 0], m.height, 'shelf');
    const board = parts[parts.length - 1];
    const b = board.edges.c1;
    board.edges = { c1: b, c2: b, l1: b, l2: b };
  }
  for (const m of d.modules.filter((v) => !isFlat(v))) {
    const s = sharedSides(d, m);
    const w = m.width,
      h = m.height,
      dep = m.depth - (m.back ? PROFILE.back : 0),
      z = (m.back ? PROFILE.back : 0) / 2;
    const id = (face: string) => (m.legacyIds ? face : `${m.id}:${face}`);
    const bottom = s.has('base') ? PROFILE.panel : 0,
      top = s.has('top') ? PROFILE.panel : 0;
    add(
      m,
      id('left'),
      'Lateral esquerda',
      [PROFILE.panel, h - bottom - top, dep],
      [-w / 2 + PROFILE.panel / 2, bottom + (h - bottom - top) / 2, z],
      PROFILE.panel,
      'side',
    );
    add(
      m,
      id('right'),
      'Lateral direita',
      [PROFILE.panel, h - bottom - top, dep],
      [w / 2 - PROFILE.panel / 2, bottom + (h - bottom - top) / 2, z],
      PROFILE.panel,
      'side',
    );
    add(
      m,
      id('base'),
      'Base',
      [s.has('base') ? w : w - 2 * PROFILE.panel, PROFILE.panel, dep],
      [0, PROFILE.panel / 2, z],
      PROFILE.panel,
      'base',
    );
    add(
      m,
      id('top'),
      'Tampo',
      [s.has('top') ? w : w - 2 * PROFILE.panel, PROFILE.panel, dep],
      [0, h - PROFILE.panel / 2, z],
      PROFILE.panel,
      'top',
    );
    if (m.back) {
      const l = s.has('left') ? PROFILE.panel / 2 : 0,
        r = s.has('right') ? PROFILE.panel / 2 : 0,
        b = s.has('base') ? PROFILE.panel / 2 : 0,
        t = s.has('top') ? PROFILE.panel / 2 : 0;
      add(
        m,
        id('back'),
        'Fundo',
        [w - l - r, h - b - t, PROFILE.back],
        [(l - r) / 2, b + (h - b - t) / 2, -m.depth / 2 + 3],
        PROFILE.back,
        'back',
        undefined,
        m.look?.backMaterialId ?? m.materialId,
      );
    }
    // Rodapé recuado ou base aparente: chapa embaixo da caixa, na altura dos
    // pés. Numa fileira de painel compartilhado cada módulo leva o seu trecho,
    // que encosta no do vizinho; a lateral da base aparente só vai na ponta.
    const legs = m.look?.legs;
    if (m.feet && (legs === 'plinth' || legs === 'skirt')) {
      const mat = m.look?.legMaterialId ?? m.materialId;
      const f = m.feet;
      const inL = s.has('left') ? PROFILE.panel / 2 : 0,
        inR = s.has('right') ? PROFILE.panel / 2 : 0;
      const recess = legs === 'plinth' ? PLINTH_RECESS : 0;
      // O rodapé recuado fica meio painel para dentro nas duas pontas; a base
      // aparente vai rente, menos onde encontra o vizinho.
      const x0 = legs === 'plinth' ? -w / 2 + PROFILE.panel / 2 : -w / 2 + inL,
        x1 = legs === 'plinth' ? w / 2 - PROFILE.panel / 2 : w / 2 - inR;
      add(m, id('plinth'), legs === 'plinth' ? 'Rodapé' : 'Base frontal', [x1 - x0, f, PROFILE.panel], [(x0 + x1) / 2, -f / 2, m.depth / 2 - recess - PROFILE.panel / 2], PROFILE.panel, 'plinth', undefined, mat);
      if (legs === 'skirt')
        for (const [sideKey, sx] of [['left', -1], ['right', 1]] as const)
          if (!s.has(sideKey))
            add(m, id(`plinth-${sideKey}`), sideKey === 'left' ? 'Base lateral esquerda' : 'Base lateral direita', [PROFILE.panel, f, m.depth - PROFILE.panel], [sx * (w / 2 - PROFILE.panel / 2), -f / 2, -PROFILE.panel / 2], PROFILE.panel, 'plinth', undefined, mat);
    }
  }
  for (const { m, c, origin, size, behind } of panels) {
    const actual: Vec = [...size],
      pos: Vec = origin.map((v, i) => v + size[i] / 2) as Vec;
    if (c.split!.legacyShelf) {
      actual[0] -= 2;
      actual[2] -= 10;
      pos[2] += 5;
    } else {
      // Atrás de porta de correr, a divisão recua também o trilho de trás.
      const recess = PROFILE.front + PROFILE.reveal + (behind === 'sliding' ? SLIDE_TRACK : 0);
      actual[2] -= recess;
      pos[2] -= recess / 2;
    }
    add(
      m,
      c.split!.id,
      c.split!.axis === 'y' ? 'Prateleira' : 'Divisória vertical',
      actual,
      pos,
      PROFILE.panel,
      c.split!.axis === 'y' ? 'shelf' : 'divider',
      c.id,
    );
  }
  for (const info of cells.filter((c) => c.node.front)) {
    const m = moduleBy(d, info.moduleId),
      f = info.node.front!,
      [x, y, z] = info.origin,
      [w, h, dep] = info.size;
    const mat = f.materialId ?? m.materialId;
    const frontZ = z + dep - PROFILE.front / 2;
    const handle: NonNullable<ModularPart['handle']> = { type: f.handle ?? m.look?.handle ?? 'bar', materialId: m.look?.handleMaterialId ?? DEFAULT_HANDLE_MATERIAL };
    if (f.type === 'single' || f.type === 'double') {
      const count = f.type === 'double' ? 2 : 1;
      const style = frontStyleOf(m, f, false);
      // Portas dividem a largura livre em milímetro inteiro: a última da
      // direita fica com a sobra, como as colunas de uma divisão.
      const widths = wholeParts(
        w - PROFILE.reveal * (count + 1),
        Array(count).fill(1),
      );
      let start = x + PROFILE.reveal;
      for (let i = 0; i < count; i++) {
        const fw = widths[i],
          fh = h - 2 * PROFILE.reveal,
          left = count === 2 ? i === 0 : f.hinge === 'left',
          cx = start + fw / 2;
        start += fw + PROFILE.reveal;
        const face = frontFace(style, fw, fh);
        const motion: ModularPart['motion'] = {
          id: `${f.id}:door-${i}`,
          type: 'door',
          pivot: [
            cx + (left ? -fw / 2 : fw / 2),
            y + h / 2,
            frontZ + PROFILE.front / 2,
          ],
          direction: left ? -1 : 1,
          travel: (95 * Math.PI) / 180,
        };
        add(
          m,
          `${f.id}:door-${i}`,
          `Porta ${i + 1}`,
          [fw, fh, PROFILE.front],
          [cx, y + h / 2, frontZ],
          PROFILE.front,
          'door',
          info.id,
          mat,
          motion,
          { ...(face ? { face } : {}), handle },
        );
        insertOf(m, `${f.id}:door-${i}`, `da porta ${i + 1}`, [cx, y + h / 2, frontZ], [fw, fh], face, style, info.id, motion);
      }
    } else if (f.type === 'sliding') {
      // Porta de correr: folhas em dois trilhos, alternando frente e trás,
      // que se sobrepõem 30 mm. A da frente corre por cima da vizinha da
      // direita; a de trás (e a última da frente) corre para a esquerda.
      const style = frontStyleOf(m, f, false);
      const n = f.heights.length;
      const fh = h - 2 * PROFILE.reveal;
      if (n < 2 || n > 4) throw new Error(`${m.name}: porta de correr com 2 a 4 folhas.`);
      const widths = wholeParts(w - 2 * PROFILE.reveal + (n - 1) * SLIDE_OVERLAP, Array(n).fill(1));
      if (widths.some((v) => v < 250))
        throw new Error(`${m.name}: ${n} folhas de correr num vão de ${Math.round(w)} mm deixam folha com menos de 250 mm; use menos folhas.`);
      if (fh < 300) throw new Error(`${m.name}: porta de correr pede pelo menos 300 mm de altura.`);
      let start = x + PROFILE.reveal;
      widths.forEach((fw, i) => {
        const back = i % 2 === 1;
        const cx = start + fw / 2,
          cz = frontZ - (back ? SLIDE_TRACK : 0);
        start += fw - SLIDE_OVERLAP;
        const face = frontFace(style, fw, fh);
        const motion: ModularPart['motion'] = { id: `${f.id}:leaf-${i}`, type: 'slide', pivot: [0, 0, 0], direction: back || i === n - 1 ? -1 : 1, travel: fw - SLIDE_OVERLAP, track: back ? 1 : 0 };
        add(m, `${f.id}:leaf-${i}`, `Folha de correr ${i + 1}`, [fw, fh, PROFILE.front], [cx, y + h / 2, cz], PROFILE.front, 'door', info.id, mat, motion, { ...(face ? { face } : {}), handle });
        insertOf(m, `${f.id}:leaf-${i}`, `da folha ${i + 1}`, [cx, y + h / 2, cz], [fw, fh], face, style, info.id, motion);
      });
    } else if (f.type === 'flap') {
      // Basculante: uma folha que gira na aresta de cima e sobe, com pistão.
      const style = frontStyleOf(m, f, false);
      const fw = w - 2 * PROFILE.reveal,
        fh = h - 2 * PROFILE.reveal;
      if (fh < FLAP_HEIGHT[0] || fh > FLAP_HEIGHT[1])
        throw new Error(`${m.name}: porta basculante com ${FLAP_HEIGHT[0]} a ${FLAP_HEIGHT[1]} mm de altura (o vão dá ${Math.round(fh)} mm); divida o vão ou use porta de giro.`);
      const face = frontFace(style, fw, fh);
      const motion: ModularPart['motion'] = {
        id: `${f.id}:flap`,
        type: 'flap',
        pivot: [x + w / 2, y + h - PROFILE.reveal, frontZ + PROFILE.front / 2],
        direction: 1,
        travel: (100 * Math.PI) / 180,
      };
      add(m, `${f.id}:flap`, 'Porta basculante', [fw, fh, PROFILE.front], [x + w / 2, y + h / 2, frontZ], PROFILE.front, 'door', info.id, mat, motion, { ...(face ? { face } : {}), handle });
      insertOf(m, `${f.id}:flap`, 'da basculante', [x + w / 2, y + h / 2, frontZ], [fw, fh], face, style, info.id, motion);
    } else {
      const style = frontStyleOf(m, f, true);
      const available =
        h - 2 * PROFILE.reveal - (f.heights.length - 1) * PROFILE.reveal;
      // Frentes de gaveta em milímetro inteiro, de baixo para cima: cada uma
      // recebe floor(espaço / N) e a de cima fecha a conta, então 556 mm viram
      // 185 + 185 + 186 e não sobram 0,01 mm para o marceneiro.
      const fronts = wholeParts(available, f.heights);
      let bottom = y + PROFILE.reveal;
      for (let i = 0; i < f.heights.length; i++) {
        const fh = fronts[i];
        if (fh < 80)
          throw new Error('Cada frente de gaveta precisa de pelo menos 80 mm.');
        const bw = w - 2 * PROFILE.slideSpace,
          bh = fh - (PROFILE.drawerBottom + PROFILE.front),
          bd = dep - PROFILE.front - PROFILE.rearSpace;
        if (
          bw <= 2 * PROFILE.drawer ||
          bh <= PROFILE.drawerBottom ||
          bd <= 2 * PROFILE.drawer
        )
          throw new Error('Compartimento insuficiente para a caixa da gaveta.');
        const group = `${f.id}:drawer-${i}`,
          motion: ModularPart['motion'] = {
            id: group,
            type: 'drawer',
            pivot: [0, 0, 0],
            direction: 1,
            travel: bd * 0.7,
          };
        const frontCenter = bottom + fh / 2;
        const face = frontFace(style, w - 2 * PROFILE.reveal, fh);
        add(
          m,
          `${group}:front`,
          `Frente gaveta ${i + 1}`,
          [w - 2 * PROFILE.reveal, fh, PROFILE.front],
          [x + w / 2, frontCenter, frontZ],
          PROFILE.front,
          'drawer',
          info.id,
          mat,
          motion,
          { ...(face ? { face } : {}), handle },
        );
        const bz = z + PROFILE.rearSpace + bd / 2,
          by = bottom + PROFILE.drawerBottom + bh / 2;
        for (const [side, dx] of [
          ['left', -bw / 2 + PROFILE.drawer / 2],
          ['right', bw / 2 - PROFILE.drawer / 2],
        ] as const)
          add(
            m,
            `${group}:${side}`,
            `Lateral gaveta ${i + 1}`,
            [PROFILE.drawer, bh, bd],
            [x + w / 2 + dx, by, bz],
            PROFILE.drawer,
            'drawer',
            info.id,
            m.materialId,
            motion,
          );
        for (const [side, dz] of [
          ['back', -bd / 2 + PROFILE.drawer / 2],
          ['inner', bd / 2 - PROFILE.drawer / 2],
        ] as const)
          add(
            m,
            `${group}:${side}`,
            `Caixa gaveta ${i + 1}`,
            [bw - 2 * PROFILE.drawer, bh, PROFILE.drawer],
            [x + w / 2, by, bz + dz],
            PROFILE.drawer,
            'drawer',
            info.id,
            m.materialId,
            motion,
          );
        add(
          m,
          `${group}:bottom`,
          `Fundo gaveta ${i + 1}`,
          [bw, PROFILE.drawerBottom, bd],
          [x + w / 2, bottom + 3, bz],
          PROFILE.drawerBottom,
          'drawer',
          info.id,
          m.materialId,
          motion,
        );
        bottom += fh + PROFILE.reveal;
      }
    }
  }
  // Tampo sobreposto: uma peça por fileira que divide o mesmo tampo, apoiada
  // em cima das caixas, com avanço na frente e nas pontas livres.
  const topKey = (m: Module) => (m.look?.top ? JSON.stringify(m.look.top) : null);
  for (const run of runsOf(d, topKey)) {
    const spec = moduleBy(d, run.ids[0]).look!.top as TopSpec;
    const y0 = run.top,
      y1 = run.top + spec.thickness;
    const left = freeReach(d, run, 's0', spec.overhang, y0, y1),
      right = freeReach(d, run, 's1', spec.overhang, y0, y1);
    const face: Face | undefined = spec.edge === 'square' ? undefined : { kind: 'edge', profile: spec.edge, radius: Math.min(spec.thickness / 2, 10) };
    addRun(run, `${run.ids[0]}:slab`, 'Tampo sobreposto', run.s0 - left, run.s1 + right, y0, y1, run.back, run.front + spec.overhang, 'slab', spec.materialId, ['c1', 'l1', 'l2'], face);
  }
  // Moldura do topo: faixa em pé na frente (e nas pontas livres) e capa por
  // cima avançando mais, como uma cimalha. Uma por fileira.
  for (const run of runsOf(d, (m) => (m.look?.cornice ? m.materialId : null))) {
    const mat = moduleBy(d, run.ids[0]).materialId;
    const y0 = run.top,
      y1 = y0 + CORNICE.fascia,
      y2 = y1 + CORNICE.cap;
    const reachL = freeReach(d, run, 's0', CORNICE.capReach, y0, y2),
      reachR = freeReach(d, run, 's1', CORNICE.capReach, y0, y2);
    const fL = reachL ? CORNICE.fasciaReach : 0,
      fR = reachR ? CORNICE.fasciaReach : 0;
    const P = PROFILE.panel;
    addRun(run, `${run.ids[0]}:cornice`, 'Moldura frontal', run.s0 - fL, run.s1 + fR, y0, y1, run.front + CORNICE.fasciaReach - P, run.front + CORNICE.fasciaReach, 'cornice', mat, ['c1']);
    if (fL) addRun(run, `${run.ids[0]}:cornice-left`, 'Moldura lateral esquerda', run.s0 - fL, run.s0 - fL + P, y0, y1, run.back, run.front + CORNICE.fasciaReach - P, 'cornice', mat, ['c1']);
    if (fR) addRun(run, `${run.ids[0]}:cornice-right`, 'Moldura lateral direita', run.s1 + fR - P, run.s1 + fR, y0, y1, run.back, run.front + CORNICE.fasciaReach - P, 'cornice', mat, ['c1']);
    addRun(run, `${run.ids[0]}:cornice-cap`, 'Capa da moldura', run.s0 - reachL, run.s1 + reachR, y1, y2, run.back, run.front + CORNICE.capReach, 'cornice', mat, ['c1', 'l1', 'l2']);
  }
  for (const c of d.connections.filter((c) => c.shared)) {
    const parent = moduleBy(d, c.parent),
      child = moduleBy(d, c.child);
    const pf = c.side === 'top' ? 'top' : c.side,
      cf = c.side === 'top' ? 'base' : c.side === 'right' ? 'left' : 'right';
    const a = parts.find(
        (p) => p.id === (parent.legacyIds ? pf : `${parent.id}:${pf}`),
      )!,
      b = parts.find(
        (p) => p.id === (child.legacyIds ? cf : `${child.id}:${cf}`),
      )!;
    if (
      !a ||
      !b ||
      a.size.some((v, i) => Math.abs(v - b.size[i]) > 1e-5) ||
      a.position.some((v, i) => Math.abs(v - b.position[i]) > 1e-5)
    )
      throw new Error('Faces compartilhadas não coincidem integralmente.');
    a.owners.push(child.id);
    parts.splice(parts.indexOf(b), 1);
  }
  if (parts.length > 200) throw new Error('Limite de 200 painéis físicos.');
  if (validate)
    for (let i = 0; i < d.modules.length; i++)
      for (let j = i + 1; j < d.modules.length; j++) {
        const a = d.modules[i],
          b = d.modules[j];
        if (
          d.connections.some(
            (c) =>
              c.shared &&
              ((c.parent === a.id && c.child === b.id) ||
                (c.parent === b.id && c.child === a.id)),
          )
        )
          continue;
        const envelope = (m: Module): ModularPart => ({
          ...parts[0],
          size: [m.width, m.height, m.depth],
          position: point([0, m.height / 2, 0], m),
          rotation: (m.rotation * Math.PI) / 180,
        });
        if (collide(envelope(a), envelope(b)))
          throw new Error(
            `Módulos sobrepostos: ${a.name} e ${b.name}. Ajuste o posicionamento.`,
          );
      }
  if (validate)
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        // Peças que abrem juntas (a porta e o vidro dela, a frente e a caixa
        // da gaveta) são montadas pelo próprio gerador, uma dentro da outra.
        if (parts[i].motion && parts[i].motion!.id === parts[j].motion?.id) continue;
        if (collide(parts[i], parts[j]))
          throw new Error(
            `Interpenetração: ${parts[i].name} e ${parts[j].name}.`,
          );
      }
  const boxes = parts.map(bounds);
  const min = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i]))),
    max = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.max[i])));
  // Os pés chegam ao piso: o conjunto começa na posição do módulo.
  for (const m of d.modules) if (m.feet) min[1] = Math.min(min[1], m.position[1]);
  return {
    parts,
    cells,
    openings: cells.filter((c) => !c.node.split).map((c) => c.size[1]),
    area: parts.reduce((a, p) => a + (p.c * p.l) / 1e6, 0),
    bounds: { min, max },
    warnings: [
      'Perfil demonstrativo. Conferir ferragens, furação, montagem, cargas e estabilidade com um marceneiro.',
      // Uma frase para todos os presos na parede: quatro avisos iguais tomavam
      // o painel inteiro.
      ...(() => {
        const hung = d.modules.filter((m) => isFlat(m) || m.wall).map((m) => m.name);
        if (!hung.length) return [];
        const names = hung.length === 1 ? hung[0] : `${hung.slice(0, -1).join(', ')} e ${hung.at(-1)}`;
        return [`${names}: fixar na parede com parafuso, bucha e suporte adequados à carga.`];
      })(),
      ...d.modules
        .filter((m) => m.position[1] > 0 && !isFlat(m) && !m.wall)
        .map((m) => `${m.name}: revisar apoio e fixação do módulo elevado.`),
      ...(d.modules.some((m) => m.look?.top && categoryOf(m.look.top.materialId) === 'stone')
        ? ['Tampo de pedra: medir no local depois do móvel instalado; a marmoraria corta e dá o acabamento da borda.']
        : []),
    ],
  };
}

export const modularOpSchema = z.union(
  [
    z.object({
      kind: z.literal('module.add'),
      id: mid.optional(),
      preset: z.enum(['shelf', 'niche', 'rack', 'drawers', 'panel', 'ledge']),
      name: z.string().min(1).max(80).optional(),
    }),
    z.object({
      kind: z.literal('module.edit'),
      id: mid,
      name: z.string().min(1).max(80).optional(),
      // Caixa até 1200 × 2400 × 200–800; painel de parede até 2700 e 15–60 de
      // espessura. O limite de cada tipo é conferido no módulo.
      width: z.number().min(200).max(PANEL_LIMITS.long).optional(),
      height: z.number().min(LEDGE_LIMITS.thickness[0]).max(PANEL_LIMITS.long).optional(),
      depth: z.number().min(PANEL_LIMITS.thickness[0]).max(800).optional(),
      materialId: material.optional(),
      back: z.boolean().optional(),
      feet: z.number().min(0).max(PANEL_LIMITS.feet[1]).optional(),
      wall: z.boolean().optional(),
      rotation: z
        .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
        .optional(),
      position: z.tuple([z.number(), z.number(), z.number()]).optional(),
      look: lookPatchSchema.optional(),
    }),
    z.object({
      kind: z.literal('module.duplicate'),
      id: mid,
      newId: mid.optional(),
    }),
    z.object({ kind: z.literal('module.remove'), id: mid }),
    z.object({
      kind: z.literal('connect'),
      parent: mid,
      child: mid,
      side: z.enum(['left', 'right', 'top']),
      shared: z.boolean(),
      align: z.enum(['front', 'back']),
      offset: z.number().min(0).max(5000),
    }),
    z.object({ kind: z.literal('disconnect'), child: mid }),
    z.object({
      kind: z.literal('cell.split'),
      id: mid,
      axis: z.enum(['x', 'y']),
      gapMm: z.number().min(100).optional(),
    }),
    z.object({
      kind: z.literal('cell.move'),
      id: mid,
      gapMm: z.number().min(100),
    }),
    z.object({ kind: z.literal('cell.merge'), id: mid }),
    z.object({ kind: z.literal('cell.distribute'), id: mid }),
    z.object({
      kind: z.literal('front.set'),
      id: mid,
      type: z.enum(['single', 'double', 'drawers', 'sliding', 'flap', 'none']),
      hinge: z.enum(['left', 'right']).optional(),
      count: z.number().int().min(1).max(6).optional(),
      materialId: material.optional(),
      style: z.enum(FRONT_STYLES).nullable().optional(),
      handle: z.enum(HANDLE_TYPES).nullable().optional(),
    }),
    z.object({
      kind: z.literal('drawer.height'),
      id: mid,
      index: z.number().int().min(0).max(5),
      height: z.number().min(80),
    }),
  ].map((s) => s.strict()),
);
// Explicit type keeps the operation contract useful to callers and the model.
export type ModularOp =
  | {
      kind: 'module.add';
      id?: string;
      preset: PresetId;
      name?: string;
    }
  | {
      kind: 'module.edit';
      id: string;
      name?: string;
      width?: number;
      height?: number;
      depth?: number;
      materialId?: MaterialId;
      back?: boolean;
      feet?: number;
      wall?: boolean;
      rotation?: Module['rotation'];
      position?: Vec;
      /** Acabamento: cada campo substitui o atual; `null` tira. */
      look?: LookPatch;
    }
  | { kind: 'module.duplicate'; id: string; newId?: string }
  | { kind: 'module.remove'; id: string }
  | {
      kind: 'connect';
      parent: string;
      child: string;
      side: Connection['side'];
      shared: boolean;
      align: Connection['align'];
      offset: number;
    }
  | { kind: 'disconnect'; child: string }
  | { kind: 'cell.split'; id: string; axis: 'x' | 'y'; gapMm?: number }
  | { kind: 'cell.move'; id: string; gapMm: number }
  | { kind: 'cell.merge' | 'cell.distribute'; id: string }
  | {
      kind: 'front.set';
      id: string;
      type: Front['type'] | 'none';
      hinge?: 'left' | 'right';
      count?: number;
      materialId?: MaterialId;
      /** Estilo e puxador só desta frente; `null` volta ao do módulo. */
      style?: FrontStyle | null;
      handle?: HandleType | null;
    }
  | { kind: 'drawer.height'; id: string; index: number; height: number };
function resizeCells(node: Cell, oldSize: number[], newSize: number[]) {
  const s = node.split;
  if (!s) return;
  const axis = s.axis === 'x' ? 0 : 1;
  const span = (c: Cell): number =>
    !c.split
      ? 0
      : c.split.axis === s.axis
        ? PROFILE.panel + span(c.split.children[0]) + span(c.split.children[1])
        : Math.max(...c.split.children.map(span));
  const [a, b] = s.children,
    sa = span(a),
    sb = span(b),
    oldLow = (oldSize[axis] - PROFILE.panel) * s.ratio;
  const totalOld = oldSize[axis] - PROFILE.panel - sa - sb,
    totalNew = newSize[axis] - PROFILE.panel - sa - sb;
  // O vão livre escalado vira milímetro inteiro: a fração fica no filho de
  // cima (ou da direita) e a soma dos dois filhos segue exata, sem peça com
  // dízima depois de redimensionar o módulo.
  const low = sa + wholeMm(((oldLow - sa) * totalNew) / totalOld);
  s.ratio = low / (newSize[axis] - PROFILE.panel);
  s.children.forEach((child, i) => {
    const prev = [...oldSize],
      next = [...newSize];
    prev[axis] = i ? oldSize[axis] - PROFILE.panel - oldLow : oldLow;
    next[axis] = i ? newSize[axis] - PROFILE.panel - low : low;
    resizeCells(child, prev, next);
  });
}
/**
 * Altura nova da caixa com os vãos redimensionados na proporção, como no
 * `module.edit`. Serve a quem troca a base ou o tampo e guarda o envelope
 * (o estilo): a caixa cede o que o pé, o tampo ou a moldura ganham.
 */
export function setBoxHeight(m: Module, height: number) {
  if (!isFlat(m)) resizeCells(m.root, [m.width - 36, m.height - 36], [m.width - 36, height - 36]);
  m.height = height;
}
/** Eixo da frente (z local) e lateral (x local) de uma rotação, no plano xz do mundo. */
function axes(rotation: number) {
  const a = (rotation * Math.PI) / 180;
  return {
    front: (p: Vec) => p[0] * Math.sin(a) + p[2] * Math.cos(a),
    side: (p: Vec) => p[0] * Math.cos(a) - p[2] * Math.sin(a),
    // Rotação em múltiplos de 90°: andar para a frente é um eixo só.
    step: [Math.round(Math.sin(a)), Math.round(Math.cos(a))] as const,
  };
}
function forward(m: Module, by: number) {
  const { step } = axes(m.rotation);
  m.position = [m.position[0] + by * step[0], m.position[1], m.position[2] + by * step[1]];
}
/** Solta todo grupo preso num painel: volta para a linha da parede. Devolve quanto cada raiz tinha avançado. */
export function unmountPanels(d: Composition) {
  const was = new Map<string, { panel: string; by: number }>();
  for (const m of d.modules)
    if (m.mountedOn) {
      was.set(m.id, m.mountedOn);
      forward(m, -m.mountedOn.by);
      delete m.mountedOn;
    }
  if (was.size) settle(d, false);
  return was;
}
export type Mounting = {
  /** Módulos que encostam num painel sem que ele cubra o fundo inteiro do grupo: segue a sobreposição. */
  partial: { module: string; panel: string }[];
  /** Raízes presas agora, com o painel e quanto avançaram. */
  mounted: { module: string; panel: string; by: number }[];
};
/**
 * Painel de parede atrás de um móvel na mesma parede: o móvel fica preso na
 * frente do painel, avançando a espessura dele, em vez de "Módulos
 * sobrepostos". Sem isto, aumentar o painel da TV até atrás do rack era
 * recusado e a IA contornava mexendo no painel.
 *
 * Só quando o painel cobre o fundo inteiro de todos os módulos do grupo
 * conectado que estão nessa linha de parede (mesma orientação, fundo dentro
 * da espessura do painel). Painel que pega só a borda de um armário, ou só o
 * de cima de uma pilha, continua sendo sobreposição: empurrar tiraria da
 * linha quem não está coberto. Deve rodar depois de `unmountPanels`, para o
 * vínculo ser recalculado do zero (painel que encolheu ou saiu solta).
 */
export function mountOnPanels(d: Composition): Mounting {
  const parentOf = new Map(d.connections.map((c) => [c.child, c.parent]));
  const rootOf = (id: string) => {
    while (parentOf.has(id)) id = parentOf.get(id)!;
    return id;
  };
  const groups = new Map<string, Module[]>();
  for (const m of d.modules) groups.set(rootOf(m.id), [...(groups.get(rootOf(m.id)) ?? []), m]);
  const partial: Mounting['partial'] = [];
  const push = new Map<string, { panel: string; by: number }>();
  for (const p of d.modules.filter((m) => m.kind === 'panel')) {
    const { front, side } = axes(p.rotation);
    const back = front(p.position) - p.depth / 2,
      face = back + p.depth,
      left = side(p.position) - p.width / 2,
      right = left + p.width,
      bottom = p.position[1],
      top = bottom + p.height;
    const span = (m: Module) => {
      const low = m.position[1] + (m.feet ?? 0);
      return { back: front(m.position) - m.depth / 2, left: side(m.position) - m.width / 2, right: side(m.position) + m.width / 2, low, high: low + m.height };
    };
    for (const [root, members] of groups) {
      if (root === p.id || moduleBy(d, root).rotation !== p.rotation) continue;
      // Linha da parede do painel: fundo dentro da espessura dele.
      const line = members.filter((m) => {
        if (m.kind === 'panel' || m.rotation !== p.rotation) return false;
        const b = span(m).back;
        return b >= back - 1 && b <= face - 1;
      });
      const touching = line.filter((m) => {
        const s = span(m);
        return Math.min(s.right, right) - Math.max(s.left, left) > 1 && Math.min(s.high, top) - Math.max(s.low, bottom) > 1;
      });
      if (!touching.length) continue;
      const covered = line.every((m) => {
        const s = span(m);
        return s.left >= left - 1 && s.right <= right + 1 && s.low >= bottom - 1 && s.high <= top + 1;
      });
      if (!covered) {
        partial.push(...touching.map((m) => ({ module: m.id, panel: p.id })));
        continue;
      }
      const by = Math.ceil(face - Math.min(...line.map((m) => span(m).back)) - 1e-6);
      if (by > (push.get(root)?.by ?? 0)) push.set(root, { panel: p.id, by });
    }
  }
  for (const [id, mount] of push) {
    const m = moduleBy(d, id);
    forward(m, mount.by);
    m.mountedOn = mount;
  }
  if (push.size) settle(d, false);
  return { partial, mounted: [...push].map(([module, v]) => ({ module, ...v })) };
}
/**
 * Erro de validação depois de prender em painel, em frase que diz o motivo:
 * painel que cobre só parte do fundo, ou o avanço que bateu em outro móvel.
 */
function mountingError(d: Composition, mounting: Mounting, before: Map<string, { panel: string; by: number }>, e: unknown) {
  const message = (e as Error).message;
  if (!message.startsWith('Módulos sobrepostos')) return e;
  const name = (id: string) => d.modules.find((m) => m.id === id)?.name ?? id;
  const part = mounting.partial.find((v) => message.includes(name(v.module)) && message.includes(name(v.panel)));
  if (part)
    return new Error(
      `${name(part.panel)} cobre só parte do fundo de ${name(part.module)} (ou dos módulos ligados a ele na parede). Para prender o móvel na frente do painel, o painel precisa cobrir o fundo inteiro; senão, afaste ou encolha o painel.`,
    );
  const fresh = mounting.mounted.filter((v) => before.get(v.module)?.by !== v.by);
  const hit = fresh.find((v) => message.includes(name(v.module)));
  if (hit)
    return new Error(
      `Ao prender ${name(hit.module)} na frente de ${name(hit.panel)} (avança ${hit.by} mm), ele bateu em outro móvel. ${message}`,
    );
  return e;
}
export function applyModularOp(
  input: Composition,
  raw: ModularOp,
  validate = true,
): Composition {
  const parsed = modularOpSchema.safeParse(raw);
  if (!parsed.success) throw new Error(validationMessage(parsed.error));
  const op = parsed.data as ModularOp,
    d: Composition = structuredClone({
      schemaVersion: SCHEMA_VERSION,
      profile: input.profile,
      modules: input.modules,
      connections: input.connections,
      ...(input.style ? { style: input.style } : {}),
    });
  settle(d, validate);
  // A operação trabalha na linha da parede; quem fica preso em painel é
  // recalculado no fim (painel que encolheu ou saiu devolve o móvel à parede).
  const was = unmountPanels(d);
  if (op.kind === 'module.add' || op.kind === 'module.duplicate') {
    let m: Module;
    if (op.kind === 'module.add') {
      m = preset(op.preset, op.id);
      if (op.name) m.name = op.name;
    } else {
      m = structuredClone(moduleBy(d, op.id));
      m.id = op.newId ?? uid('module');
      m.name += ' · cópia';
      m.legacyIds = false;
      walk(m.root, (c) => {
        c.id = uid('cell');
        if (c.split) c.split.id = uid('panel');
        if (c.front) c.front.id = uid('front');
      });
    }
    const right = Math.max(
      ...generateComposition(d, false).parts.map((p) => bounds(p).max[0]),
    );
    m.name = uniqueName(d, m.name);
    m.position = [
      right + (m.rotation % 180 ? m.depth : m.width) / 2 + 100,
      0,
      0,
    ];
    d.modules.push(m);
  } else if (op.kind === 'module.edit') {
    const m = moduleBy(d, op.id);
    const { kind: _, id: __, ...patch } = op;
    if (d.connections.some((c) => c.child === m.id) && op.position)
      throw new Error('Separe o módulo antes de mover sua posição.');
    // Posição lida do estado de um móvel preso em painel vem já avançada: na
    // mesma profundidade é um arrasto de lado ou de altura, e ele segue preso.
    const mount = was.get(m.id);
    if (mount && patch.position) {
      const { front, step } = axes(m.rotation);
      if (Math.abs(front(patch.position) - (front(m.position) + mount.by)) <= 1)
        patch.position = [patch.position[0] - mount.by * step[0], patch.position[1], patch.position[2] - mount.by * step[1]];
    }
    const { look: lookPatch, ...rest } = patch;
    // Pés numa fileira de painéis compartilhados valem para a fileira toda:
    // metade com pés e metade sem é uma lateral que não fecha. O tipo de base
    // (palito, rodapé, estrutura) vai junto, pela mesma razão.
    // Sem pés (feet 0) a base sai junto, a não ser que o pedido diga outra.
    const base: LookPatch | null =
      op.feet === 0 && lookPatch?.legs === undefined
        ? { legs: null, legMaterialId: null }
        : lookPatch && (lookPatch.legs !== undefined || lookPatch.legMaterialId !== undefined)
          ? { ...(lookPatch.legs !== undefined ? { legs: lookPatch.legs } : {}), ...(lookPatch.legMaterialId !== undefined ? { legMaterialId: lookPatch.legMaterialId } : {}) }
          : null;
    if (op.feet !== undefined || base) {
      const row = new Set([m.id]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const c of d.connections.filter((c) => c.shared && c.side !== 'top'))
          for (const [a, b] of [[c.parent, c.child], [c.child, c.parent]])
            if (row.has(a) && !row.has(b)) {
              row.add(b);
              grew = true;
            }
      }
      for (const other of d.modules)
        if (row.has(other.id) && other.id !== m.id) {
          if (op.feet !== undefined) other.feet = op.feet;
          if (base) {
            other.look = patchLook(other.look, base);
            if (!other.look) delete other.look;
          }
        }
    }
    if (!isFlat(m))
      resizeCells(
        m.root,
        [m.width - 36, m.height - 36],
        [(op.width ?? m.width) - 36, (op.height ?? m.height) - 36],
      );
    Object.assign(m, rest);
    if (lookPatch || base) {
      m.look = patchLook(m.look, { ...base, ...lookPatch });
      if (!m.look) delete m.look;
    }
  } else if (op.kind === 'module.remove') {
    if (d.modules.length === 1) throw new Error('Mantenha ao menos um módulo.');
    moduleBy(d, op.id);
    // As conexões do módulo saem com ele: quem estava ligado fica onde está
    // (depois do settle a posição de cada um já é a do mundo) e ganha as
    // próprias laterais no lugar das compartilhadas. Antes a remoção era
    // recusada e quem pedia tinha de separar as conexões uma a uma.
    d.connections = d.connections.filter((c) => c.parent !== op.id && c.child !== op.id);
    d.modules = d.modules.filter((m) => m.id !== op.id);
  } else if (op.kind === 'connect') {
    if (d.connections.some((c) => c.child === op.child))
      throw new Error('Separe a conexão existente primeiro.');
    const reference = moduleBy(d, op.parent),
      attached = moduleBy(d, op.child);
    if (reference.id === attached.id)
      throw new Error('Um módulo não pode ser conectado a si mesmo.');
    for (const m of [reference, attached])
      if (isFlat(m))
        throw new Error(
          `${m.name} é ${m.kind === 'ledge' ? 'uma prateleira de parede' : 'um painel de parede'} e não se conecta: posicione com module.edit {position}.`,
        );
    if (op.side === 'top' && attached.feet)
      throw new Error(`${attached.name} vai em cima de outro módulo: tire os pés (feet 0) antes.`);
    if (op.shared) {
      // Painel compartilhado é uma face única entre dois módulos: alinhar o
      // filho à referência é a própria definição da conexão, não um ajuste
      // extra. O diff mostra cada medida alterada no relatório do turno.
      const before = [attached.width, attached.height];
      Object.assign(attached, {
        rotation: reference.rotation,
        materialId: reference.materialId,
        depth: reference.depth,
        ...(op.side === 'top' ? {} : { feet: reference.feet }),
        ...(op.side === 'top'
          ? { width: reference.width }
          : { height: reference.height }),
      });
      // Lado a lado, a base é a mesma (rodapé, estrutura ou pé).
      if (op.side !== 'top') {
        attached.look = patchLook(attached.look, { legs: reference.look?.legs ?? null, legMaterialId: reference.look?.legMaterialId ?? null });
        if (!attached.look) delete attached.look;
      }
      resizeCells(
        attached.root,
        [before[0] - 36, before[1] - 36],
        [attached.width - 36, attached.height - 36],
      );
    }
    const { kind: _, ...connection } = op;
    d.connections.push({
      id: uid('connection'),
      ...connection,
      ...(op.shared ? { offset: 0 } : {}),
    });
  } else if (op.kind === 'disconnect') {
    const c = d.connections.find((c) => c.child === op.child);
    if (!c) throw new Error('Módulo sem conexão.');
    if (c.shared) {
      c.shared = false;
      settle(d);
    }
    d.connections = d.connections.filter((v) => v.id !== c.id);
  } else {
    const { c } = cellBy(d, op.id);
    const info = layout(d).cells.find((v) => v.id === c.id)!;
    if (op.kind === 'cell.split') {
      // Duas causas diferentes, dois conselhos diferentes: a divisão de um nó
      // que já tem split falhava dizendo "sem frente", que não era o caso.
      if (c.split)
        throw new Error(
          'Este compartimento já está dividido: use cell.merge para voltar ao vão único antes de dividir de novo.',
        );
      // Dividir atrás de uma porta vale (a porta segue cobrindo os dois
      // vãos); atrás de gavetas não.
      if (c.front?.type === 'drawers')
        throw new Error('Escolha um compartimento livre, sem frente.');
      const length = info.size[op.axis === 'x' ? 0 : 1] - 18;
      // A divisão guarda a proporção no schema, mas o vão nasce em milímetro
      // inteiro: com gapMm, o valor pedido; sem ele, floor(metade) com a sobra
      // para o filho de cima (eixo Y) ou da direita (eixo X).
      const low = wholeMm(op.gapMm ?? length / 2);
      c.split = {
        id: `${c.id}:divider`,
        axis: op.axis,
        ratio: low / length,
        children: [{ id: `${c.id}:low` }, { id: `${c.id}:high` }],
      };
    } else if (op.kind === 'cell.move') {
      if (!c.split) throw new Error('Selecione uma divisória.');
      // O vão pedido é o tamanho da peça menor: milímetro inteiro na lista de
      // corte e a outra parte fica com o resto, fechando o compartimento.
      c.split.ratio =
        wholeMm(op.gapMm) / (info.size[c.split.axis === 'x' ? 0 : 1] - 18);
    } else if (op.kind === 'cell.merge') {
      if (!c.split) throw new Error('Selecione uma divisão.');
      if (c.split.children.some((v) => v.split || v.front))
        throw new Error('Remova as frentes e subdivisões antes de mesclar.');
      delete c.split;
    } else if (op.kind === 'cell.distribute') {
      const distribute = (node: Cell, size: number[]) => {
        if (!node.split) return;
        const axis = node.split.axis;
        const count = (v: Cell): number =>
          v.split?.axis === axis
            ? count(v.split.children[0]) + count(v.split.children[1])
            : 1;
        const a = count(node.split.children[0]),
          b = count(node.split.children[1]),
          index = axis === 'x' ? 0 : 1;
        // Vãos iguais em milímetro inteiro: cada folha recebe floor(espaço / N)
        // e a última fica com a sobra, então a soma das folhas mais as
        // divisórias fecha exatamente o compartimento.
        const parts = wholeParts(
            size[index] - (a + b - 1) * PROFILE.panel,
            Array(a + b).fill(1),
          ),
          low =
            parts.slice(0, a).reduce((x, y) => x + y, 0) +
            (a - 1) * PROFILE.panel;
        node.split.ratio = low / (size[index] - PROFILE.panel);
        node.split.children.forEach((child, i) => {
          const next = [...size];
          next[index] = i ? size[index] - PROFILE.panel - low : low;
          distribute(child, next);
        });
      };
      distribute(c, info.size);
    } else if (op.kind === 'front.set') {
      if (op.type === 'none') delete c.front;
      else {
        // Porta num vão dividido cobre as divisões (prateleiras atrás dela);
        // gaveta só em vão final, e nada dentro pode ter frente própria.
        if (c.split && op.type === 'drawers')
          throw new Error('Escolha um compartimento final para a frente.');
        if (c.split) {
          let inner = false;
          walk(c, (v) => {
            if (v !== c && v.front) inner = true;
          });
          if (inner) throw new Error('Tire as frentes de dentro deste vão antes de pôr uma porta que cobre o vão inteiro.');
        }
        const style = op.style === null ? undefined : (op.style ?? c.front?.style),
          handle = op.handle === null ? undefined : (op.handle ?? c.front?.handle);
        c.front = {
          id: c.front?.id ?? uid('front'),
          type: op.type,
          hinge: op.hinge ?? c.front?.hinge ?? 'left',
          materialId: op.materialId ?? c.front?.materialId,
          heights:
            c.front?.type === op.type &&
            (!op.count || op.count === c.front.heights.length)
              ? c.front.heights
              : Array(op.type === 'drawers' ? (op.count ?? 3) : op.type === 'sliding' ? (op.count ?? 2) : 1).fill(1),
          ...(style ? { style } : {}),
          ...(handle ? { handle } : {}),
        };
        if (!c.front.materialId) delete c.front.materialId;
      }
    } else if (op.kind === 'drawer.height') {
      const f = c.front;
      if (f?.type !== 'drawers' || op.index >= f.heights.length)
        throw new Error('Gaveta não encontrada.');
      const free = info.size[1] - 4 - 2 * (f.heights.length - 1);
      if (f.heights.length === 1) {
        if (Math.abs(op.height - free) > 1e-5)
          throw new Error('A única frente ocupa toda a altura disponível.');
      } else {
        const sum = f.heights.reduce((a, b) => a + b, 0) - f.heights[op.index];
        f.heights = f.heights.map((h, i) =>
          i === op.index ? op.height : (h / sum) * (free - op.height),
        );
      }
    }
  }
  settle(d, validate);
  const mounting = mountOnPanels(d);
  settle(d, validate);
  if (validate)
    try {
      generateComposition(d);
    } catch (e) {
      throw mountingError(d, mounting, was, e);
    }
  // Erro de schema vira frase para a pessoa, não o JSON do validador.
  const checked = compositionSchema.safeParse(d);
  if (!checked.success) throw new Error(validationMessage(checked.error));
  return checked.data;
}
/**
 * Pés dos módulos, no mundo: quatro por caixa, recuados 50 mm das laterais e
 * 40 mm da frente e do fundo. Não são peças de corte (vêm prontos, entram no
 * orçamento como ferragem); servem ao desenho, à cena e ao orçamento.
 */
export function feetOf(d: Composition): Foot[] {
  const out: Foot[] = [];
  for (const m of d.modules) {
    const h = m.feet ?? 0;
    if (!h || isFlat(m)) continue;
    const x = m.width / 2 - 50,
      z = m.depth / 2 - 40;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const top = point([sx * x, 0, sz * z], m);
      out.push({
        moduleId: m.id,
        position: [top[0], m.position[1] + h / 2, top[2]],
        height: h,
        radius: [17, 11],
      });
    }
  }
  return out;
}
export function openingPose(part: ModularPart, fraction: number): ModularPart {
  if (!part.motion) return part;
  const m = part.motion;
  if (m.type === 'slide') {
    // Corre no trilho, ao longo do x do módulo.
    const dist = m.direction * m.travel * fraction;
    return {
      ...part,
      position: [part.position[0] + Math.cos(part.rotation) * dist, part.position[1], part.position[2] - Math.sin(part.rotation) * dist],
    };
  }
  if (m.type === 'flap') {
    // Gira na aresta de cima: a borda de baixo vem para a frente e sobe.
    const angle = -m.direction * m.travel * fraction;
    const front = [Math.sin(part.rotation), Math.cos(part.rotation)];
    const dy = part.position[1] - m.pivot[1],
      dz = (part.position[0] - m.pivot[0]) * front[0] + (part.position[2] - m.pivot[2]) * front[1];
    const y = dy * Math.cos(angle) - dz * Math.sin(angle),
      z = dy * Math.sin(angle) + dz * Math.cos(angle);
    // O deslocamento lateral (ao longo do x do módulo) fica como estava.
    const lateral = [part.position[0] - m.pivot[0] - dz * front[0], part.position[2] - m.pivot[2] - dz * front[1]];
    return {
      ...part,
      position: [m.pivot[0] + lateral[0] + z * front[0], m.pivot[1] + y, m.pivot[2] + lateral[1] + z * front[1]],
      tilt: angle,
    };
  }
  if (m.type === 'drawer') {
    const dist = m.travel * fraction;
    return {
      ...part,
      position: [
        part.position[0] + Math.sin(part.rotation) * dist,
        part.position[1],
        part.position[2] + Math.cos(part.rotation) * dist,
      ],
    };
  }
  const angle = m.direction * m.travel * fraction,
    dx = part.position[0] - m.pivot[0],
    dz = part.position[2] - m.pivot[2];
  return {
    ...part,
    position: [
      m.pivot[0] + dx * Math.cos(angle) + dz * Math.sin(angle),
      part.position[1],
      m.pivot[2] - dx * Math.sin(angle) + dz * Math.cos(angle),
    ],
    rotation: part.rotation + angle,
  };
}
export function openingLimit(
  parts: ModularPart[],
  group: string,
  opened: Record<string, number> = {},
  from = 0,
  to = 1,
) {
  const moving = parts.filter((p) => p.motion?.id === group);
  if (!moving.length) return 0;
  const obstacles = parts
    .filter((p) => p.motion?.id !== group)
    .map((p) => openingPose(p, opened[p.motion?.id ?? ''] ?? 0));
  const steps = Math.max(
    190,
    ...moving.map((p) =>
      Math.ceil(
        (p.motion!.travel *
          (p.motion!.type === 'door' ? Math.hypot(p.size[0], p.size[2]) : p.motion!.type === 'flap' ? Math.hypot(p.size[1], p.size[2]) : 1)) /
          2,
      ),
    ),
  );
  for (let step = 1; step <= steps; step++) {
    const f = from + ((to - from) * step) / steps;
    if (
      moving.some((p) => obstacles.some((q) => collide(openingPose(p, f), q)))
    )
      return from + ((to - from) * (step - 1)) / steps;
  }
  return to;
}
