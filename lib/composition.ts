import { z } from 'zod';
import { defaults, materials, materialIds, type Part, type MaterialId } from './furniture';
import * as legacy from './design';

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
export type Front = {
  id: string;
  type: 'single' | 'double' | 'drawers';
  hinge: 'left' | 'right';
  materialId?: MaterialId;
  heights: number[];
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
   * compartimentos. `depth` é a espessura. Ausente, o módulo é uma caixa.
   */
  kind?: 'panel';
  /** Pés: altura em mm que levanta a caixa do piso (0 ou ausente, sem pés). */
  feet?: number;
  /** Suspenso de propósito, preso na parede (aéreo, rack suspenso). */
  wall?: boolean;
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
  schemaVersion: 3;
  profile: typeof PROFILE;
  modules: Module[];
  connections: Connection[];
};
/** Limites do painel de parede: cabe numa chapa de 2750 × 1840 mm. */
export const PANEL_LIMITS = { long: 2700, short: 1800, thickness: [15, 60], feet: [0, 300] } as const;
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
  motion?: {
    id: string;
    type: 'door' | 'drawer';
    pivot: Vec;
    direction: number;
    travel: number;
  };
};
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
    width: 'Largura: 200 a 1200 mm (painel de parede até 2700 mm).',
    height: 'Altura: 200 a 2400 mm (painel de parede até 2700 mm).',
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
    back: 'Fundo só aceita ligado ou desligado.',
    preset: 'Preset inválido: use shelf, niche, rack, drawers ou panel.',
    presets: 'Preset inválido: use shelf, niche, rack, drawers ou panel.',
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
    type: z.enum(['single', 'double', 'drawers']),
    hinge: z.enum(['left', 'right']),
    materialId: material.optional(),
    heights: z.array(z.number().positive()).min(1).max(6),
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
    schemaVersion: z.literal(3),
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
            height: z.number().min(200).max(PANEL_LIMITS.long),
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
            kind: z.literal('panel').optional(),
            feet: z.number().min(0).max(PANEL_LIMITS.feet[1]).optional(),
            wall: z.boolean().optional(),
          })
          .strict()
          .superRefine((m, ctx) => {
            const fail = (path: string, message: string) =>
              ctx.addIssue({ code: 'custom', path: [path], message });
            if (m.kind === 'panel') {
              if (m.depth > PANEL_LIMITS.thickness[1])
                fail('depth', `${m.name}: painel de parede com 15 a 60 mm de espessura.`);
              if (Math.min(m.width, m.height) > PANEL_LIMITS.short)
                fail('width', `${m.name}: painel de até 2700 × 1800 mm (uma chapa).`);
              if (m.root.split || m.root.front)
                fail('root', `${m.name}: painel de parede não tem compartimentos nem frentes.`);
              if (m.feet) fail('feet', `${m.name}: painel de parede não leva pés.`);
            } else {
              if (m.width > 1200) fail('width', 'Largura: 200 a 1200 mm.');
              if (m.height > 2400) fail('height', 'Altura: 200 a 2400 mm.');
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
function point(p: Vec, m: Module): Vec {
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
export function migrateComposition(
  input: legacy.Design | Composition,
): Composition {
  if (input.schemaVersion === 3) return compositionSchema.parse(input);
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
    schemaVersion: 3,
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
export type PresetId = 'shelf' | 'niche' | 'rack' | 'drawers' | 'panel';
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
  if (result.m.kind === 'panel')
    throw new Error(`${result.m.name} é um painel de parede: não tem compartimentos nem frentes.`);
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
      const y =
        c.side === 'top' ? m.height - (c.shared ? 18 : 0) + c.offset : 0;
      const dz =
        c.align === 'front' ? (m.depth - dep) / 2 : -(m.depth - dep) / 2;
      child.position = point([dx, y, dz], m);
      // point() já soma os pés do pai; os do filho saem da posição, para as
      // duas caixas ficarem na mesma base (e os pés iguais no mesmo piso).
      child.position[1] -= child.feet ?? 0;
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
  const panels: { m: Module; c: Cell; origin: Vec; size: Vec }[] = [];
  for (const m of d.modules) {
    if (m.kind === 'panel') continue;
    const depth = m.depth - (m.back ? PROFILE.back : 0);
    let order = 0;
    function visit(c: Cell, origin: Vec, size: Vec) {
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
      if (c.split) {
        if (c.front)
          throw new Error('Remova a frente antes de dividir o compartimento.');
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
        panels.push({ m, c, origin: pos, size: psize });
        const low: Vec = [...size];
        low[axis] = length;
        const high: Vec = [...size];
        high[axis] = size[axis] - length - PROFILE.panel;
        const upper: Vec = [...origin];
        upper[axis] += length + PROFILE.panel;
        visit(c.split.children[0], origin, low);
        visit(c.split.children[1], upper, high);
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
function bounds(p: ModularPart) {
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
function collide(a: ModularPart, b: ModularPart) {
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
export function generateComposition(input: Composition, validate = true) {
  const d = compositionSchema.parse({
    schemaVersion: 3,
    profile: input.profile,
    modules: input.modules,
    connections: input.connections,
  });
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
      color: color.color,
      owners: [m.id],
      cellId,
      edges: {
        c1: kind === 'back' ? null : `${color.name} 0.4`,
        // O painel fica à vista nos quatro lados.
        c2: kind === 'panel' ? `${color.name} 0.4` : null,
        l1: kind === 'panel' ? `${color.name} 0.4` : null,
        l2: kind === 'panel' ? `${color.name} 0.4` : null,
      },
      motion: motion ? { ...motion, pivot: point(motion.pivot, m) } : undefined,
    });
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
    );
  for (const m of d.modules.filter((v) => v.kind !== 'panel')) {
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
      );
    }
  }
  for (const { m, c, origin, size } of panels) {
    const actual: Vec = [...size],
      pos: Vec = origin.map((v, i) => v + size[i] / 2) as Vec;
    if (c.split!.legacyShelf) {
      actual[0] -= 2;
      actual[2] -= 10;
      pos[2] += 5;
    } else {
      actual[2] -= PROFILE.front + PROFILE.reveal;
      pos[2] -= (PROFILE.front + PROFILE.reveal) / 2;
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
    if (f.type === 'single' || f.type === 'double') {
      const count = f.type === 'double' ? 2 : 1;
      // Portas dividem a largura livre em milímetro inteiro: a última da
      // direita fica com a sobra, como as colunas de uma divisão.
      const widths = wholeParts(
        w - PROFILE.reveal * (count + 1),
        Array(count).fill(1),
      );
      let start = x + PROFILE.reveal;
      for (let i = 0; i < count; i++) {
        const fw = widths[i],
          left = count === 2 ? i === 0 : f.hinge === 'left',
          cx = start + fw / 2;
        start += fw + PROFILE.reveal;
        add(
          m,
          `${f.id}:door-${i}`,
          `Porta ${i + 1}`,
          [fw, h - 2 * PROFILE.reveal, PROFILE.front],
          [cx, y + h / 2, frontZ],
          PROFILE.front,
          'door',
          info.id,
          mat,
          {
            id: `${f.id}:door-${i}`,
            type: 'door',
            pivot: [
              cx + (left ? -fw / 2 : fw / 2),
              y + h / 2,
              frontZ + PROFILE.front / 2,
            ],
            direction: left ? -1 : 1,
            travel: (95 * Math.PI) / 180,
          },
        );
      }
    } else {
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
      for (let j = i + 1; j < parts.length; j++)
        if (collide(parts[i], parts[j]))
          throw new Error(
            `Interpenetração: ${parts[i].name} e ${parts[j].name}.`,
          );
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
        const hung = d.modules.filter((m) => m.kind === 'panel' || m.wall).map((m) => m.name);
        if (!hung.length) return [];
        const names = hung.length === 1 ? hung[0] : `${hung.slice(0, -1).join(', ')} e ${hung.at(-1)}`;
        return [`${names}: fixar na parede com parafuso, bucha e suporte adequados à carga.`];
      })(),
      ...d.modules
        .filter((m) => m.position[1] > 0 && m.kind !== 'panel' && !m.wall)
        .map((m) => `${m.name}: revisar apoio e fixação do módulo elevado.`),
    ],
  };
}

export const modularOpSchema = z.union(
  [
    z.object({
      kind: z.literal('module.add'),
      id: mid.optional(),
      preset: z.enum(['shelf', 'niche', 'rack', 'drawers', 'panel']),
      name: z.string().min(1).max(80).optional(),
    }),
    z.object({
      kind: z.literal('module.edit'),
      id: mid,
      name: z.string().min(1).max(80).optional(),
      // Caixa até 1200 × 2400 × 200–800; painel de parede até 2700 e 15–60 de
      // espessura. O limite de cada tipo é conferido no módulo.
      width: z.number().min(200).max(PANEL_LIMITS.long).optional(),
      height: z.number().min(200).max(PANEL_LIMITS.long).optional(),
      depth: z.number().min(PANEL_LIMITS.thickness[0]).max(800).optional(),
      materialId: material.optional(),
      back: z.boolean().optional(),
      feet: z.number().min(0).max(PANEL_LIMITS.feet[1]).optional(),
      wall: z.boolean().optional(),
      rotation: z
        .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
        .optional(),
      position: z.tuple([z.number(), z.number(), z.number()]).optional(),
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
      type: z.enum(['single', 'double', 'drawers', 'none']),
      hinge: z.enum(['left', 'right']).optional(),
      count: z.number().int().min(1).max(6).optional(),
      materialId: material.optional(),
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
export function applyModularOp(
  input: Composition,
  raw: ModularOp,
  validate = true,
): Composition {
  const parsed = modularOpSchema.safeParse(raw);
  if (!parsed.success) throw new Error(validationMessage(parsed.error));
  const op = parsed.data as ModularOp,
    d: Composition = structuredClone({
      schemaVersion: 3,
      profile: input.profile,
      modules: input.modules,
      connections: input.connections,
    });
  settle(d, validate);
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
      ...generateComposition(d).parts.map((p) => bounds(p).max[0]),
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
    if (m.kind !== 'panel')
      resizeCells(
        m.root,
        [m.width - 36, m.height - 36],
        [(op.width ?? m.width) - 36, (op.height ?? m.height) - 36],
      );
    Object.assign(m, patch);
  } else if (op.kind === 'module.remove') {
    if (d.modules.length === 1) throw new Error('Mantenha ao menos um módulo.');
    if (d.connections.some((c) => c.parent === op.id || c.child === op.id))
      throw new Error('Separe as conexões antes de remover o módulo.');
    moduleBy(d, op.id);
    d.modules = d.modules.filter((m) => m.id !== op.id);
  } else if (op.kind === 'connect') {
    if (d.connections.some((c) => c.child === op.child))
      throw new Error('Separe a conexão existente primeiro.');
    const reference = moduleBy(d, op.parent),
      attached = moduleBy(d, op.child);
    if (reference.id === attached.id)
      throw new Error('Um módulo não pode ser conectado a si mesmo.');
    for (const m of [reference, attached])
      if (m.kind === 'panel')
        throw new Error(
          `${m.name} é um painel de parede e não se conecta: posicione com module.edit {position}.`,
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
      if (c.front)
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
        if (c.split)
          throw new Error('Escolha um compartimento final para a frente.');
        c.front = {
          id: c.front?.id ?? uid('front'),
          type: op.type,
          hinge: op.hinge ?? c.front?.hinge ?? 'left',
          materialId: op.materialId ?? c.front?.materialId,
          heights:
            c.front?.type === op.type &&
            (!op.count || op.count === c.front.heights.length)
              ? c.front.heights
              : Array(op.type === 'drawers' ? (op.count ?? 3) : 1).fill(1),
        };
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
  if (validate) generateComposition(d);
  return compositionSchema.parse(d);
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
    if (!h || m.kind === 'panel') continue;
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
/**
 * Peças para desenhar (miniatura, prancha, imagem que a IA confere): as de
 * corte mais um bloco fino por pé. Os pés não entram na lista de corte, mas
 * sem eles um rack de pés palito parece flutuar no desenho.
 */
export function drawingParts(d: Composition): ModularPart[] {
  const g = generateComposition(d, false);
  const legs = feetOf(d).map((f, i): ModularPart => {
    const m = d.modules.find((v) => v.id === f.moduleId)!;
    const color = materials.find((v) => v.id === m.materialId)!;
    const w = f.radius[0] * 2;
    return {
      id: `${f.moduleId}:foot-${i}`,
      name: 'Pé',
      kind: 'side',
      size: [w, f.height, w],
      position: f.position,
      rotation: 0,
      c: f.height,
      l: w,
      thickness: w,
      material: color.name,
      color: color.color,
      owners: [f.moduleId],
      edges: { c1: null, c2: null, l1: null, l2: null },
    };
  });
  return [...g.parts, ...legs];
}
export function openingPose(part: ModularPart, fraction: number): ModularPart {
  if (!part.motion) return part;
  const m = part.motion;
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
          (p.motion!.type === 'door' ? Math.hypot(p.size[0], p.size[2]) : 1)) /
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
