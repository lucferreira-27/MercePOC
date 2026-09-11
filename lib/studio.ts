/** Compatibility projections are derived, never accepted as editable composition state. */
import { z } from 'zod';
import * as old from './design';
import { type Params } from './furniture';
import {
  applyModularOp,
  compositionSchema,
  generateComposition,
  layout,
  migrateComposition,
  modularOpSchema,
  settle,
  type Composition,
  type ModularOp,
} from './composition';
export type Design = Composition & {
  width: number;
  height: number;
  depth: number;
  materialId: old.Design['materialId'];
  shelves: old.Shelf[];
};
export type ShelfOp = old.ShelfOp | ModularOp;
export function canonical(input: Composition): Composition {
  return compositionSchema.parse(
    JSON.parse(
      JSON.stringify({
        schemaVersion: 3,
        profile: input.profile,
        modules: input.modules,
        connections: input.connections,
      }),
    ),
  );
}
export function normalize(input: Composition | old.Design): Design {
  const d =
    input.schemaVersion === 3 ? canonical(input) : migrateComposition(input);
  settle(d);
  const g = generateComposition(d);
  const m = d.modules[0];
  const shelves = g.parts
    .filter((p) => p.kind === 'shelf' && p.owners.includes(m.id))
    .map((p) => ({ id: p.id, elevation: p.position[1] - 9 - m.position[1] }))
    .sort((a, b) => a.elevation - b.elevation);
  return {
    ...d,
    width: g.bounds.max[0] - g.bounds.min[0],
    height: g.bounds.max[1],
    depth: g.bounds.max[2] - g.bounds.min[2],
    materialId: m.materialId,
    shelves,
  };
}
export const designSchema = z
  .unknown()
  .transform((v) => normalize(v as Composition));
export const opSchema = z.union([
  old.opSchema,
  modularOpSchema,
]) as z.ZodType<ShelfOp>;
export function isDesign(v: unknown): v is Design {
  return (
    !!v &&
    typeof v === 'object' &&
    'schemaVersion' in v &&
    [2, 3].includes(Number(v.schemaVersion))
  );
}
export function migrateParams(v: Params) {
  return normalize(old.migrateParams(v));
}
export function generateDesign(d: Design) {
  return generateComposition(canonical(d));
}
export function shelfInfos(d: Design) {
  if (d.modules.length === 1 && d.modules[0].legacyIds)
    return old.shelfInfos(legacyProjection(d));
  return generateDesign(d)
    .parts.filter((p) => p.kind === 'shelf')
    .map((p, i) => {
      const info = layout(d).cells.find((c) => c.node.split?.id === p.id)!;
      const below = (info.size[1] - 18) * info.node.split!.ratio;
      return {
        id: p.id,
        label: d.modules.length === 1 ? `Prateleira ${i + 1}` : p.name,
        elevation: p.position[1] - 9,
        gapBelow: below,
        gapAbove: info.size[1] - 18 - below,
      };
    });
}
function legacyProjection(d: Design): old.Design {
  return {
    schemaVersion: 2,
    width: d.modules[0].width,
    height: d.modules[0].height,
    depth: d.modules[0].depth,
    materialId: d.materialId,
    shelves: d.shelves,
  };
}
export function gapsOf(d: Design) {
  return d.modules.length === 1 && d.modules[0].legacyIds
    ? old.gapsOf(legacyProjection(d))
    : generateDesign(d).openings;
}
export function resolveShelfId(id: string, d: Design) {
  const parts = generateDesign(d).parts;
  if (parts.some((p) => p.id === id)) return id;
  const stable = id.replace(/^shelf-/, 'sh-');
  return parts.some((p) => p.id === stable) ? stable : null;
}
export function entityIds(d: Design) {
  const g = generateDesign(d);
  return [
    ...d.modules.map((m) => m.id),
    ...g.cells.map((c) => c.id),
    ...g.cells.flatMap((c) => (c.node.front ? [c.node.front.id] : [])),
    ...g.parts.map((p) => p.id),
  ];
}
export function selectedPartIds(d: Design, selected: readonly string[]) {
  const g = generateDesign(d),
    cells = new Set<string>();
  const visit = (node: import('./composition').Cell) => {
    cells.add(node.id);
    node.split?.children.forEach(visit);
  };
  for (const c of g.cells)
    if (
      selected.includes(c.id) ||
      (!!c.node.front && selected.includes(c.node.front.id))
    )
      visit(c.node);
  return g.parts
    .filter(
      (p) =>
        selected.includes(p.id) ||
        p.owners.some((id) => selected.includes(id)) ||
        (!!p.cellId && cells.has(p.cellId)),
    )
    .map((p) => p.id);
}
export function applyOp(input: Design, op: ShelfOp): Design {
  const d = canonical(input);
  if (
    op.kind.includes('.') ||
    op.kind === 'connect' ||
    op.kind === 'disconnect'
  )
    return normalize(applyModularOp(d, op as ModularOp));
  const m = d.modules[0];
  const tree = layout(d);
  const simple =
    m.legacyIds &&
    d.modules.length === 1 &&
    tree.cells
      .filter((c) => c.moduleId === m.id)
      .every(
        (c) =>
          !c.node.front &&
          (!c.node.split ||
            (c.node.split.axis === 'y' && c.node.split.legacyShelf)),
      );
  if (simple) {
    const base: old.Design = {
      schemaVersion: 2,
      width: m.width,
      height: m.height,
      depth: m.depth,
      materialId: m.materialId,
      shelves: input.shelves,
    };
    const result = old.applyOp(base, op as old.ShelfOp);
    const converted = migrateComposition(result).modules[0];
    Object.assign(m, {
      width: result.width,
      height: result.height,
      depth: result.depth,
      materialId: result.materialId,
      root: converted.root,
    });
    return normalize(d);
  }
  if (op.kind === 'resize') {
    const { kind: _, ...patch } = op;
    return normalize(
      applyModularOp(d, { kind: 'module.edit', id: m.id, ...patch }),
    );
  }
  if (op.kind === 'distribute')
    return normalize(
      applyModularOp(d, { kind: 'cell.distribute', id: m.root.id }),
    );
  if (op.kind === 'move' || op.kind === 'gap') {
    let current = d;
    const ids = op.kind === 'move' ? op.ids : [op.id];
    for (const id of ids) {
      const c = layout(current).cells.find((c) => c.node.split?.id === id);
      if (!c || c.node.split?.axis !== 'y')
        throw new Error('Selecione uma prateleira horizontal.');
      const gap =
        op.kind === 'move'
          ? (c.size[1] - 18) * c.node.split.ratio + op.deltaMm
          : op.gapMm;
      current = applyModularOp(current, { kind: 'cell.move', id, gapMm: gap });
    }
    return normalize(current);
  }
  if (op.kind === 'remove') {
    let current = d;
    for (const id of op.ids)
      current = applyModularOp(current, { kind: 'cell.merge', id });
    return normalize(current);
  }
  if (op.kind === 'add') {
    const leaf = tree.cells.filter((c) => c.moduleId === m.id && !c.node.split)[
      op.gap
    ];
    if (!leaf) throw new Error('Vão não encontrado.');
    return normalize(
      applyModularOp(d, { kind: 'cell.split', id: leaf.id, axis: 'y' }),
    );
  }
  throw new Error('Operação não suportada.');
}
export function executeRequest(base: Design, ops: ShelfOp[]) {
  let d = base;
  try {
    let pending: Composition = canonical(d);
    for (const op of ops) {
      if (
        op.kind.includes('.') ||
        op.kind === 'connect' ||
        op.kind === 'disconnect'
      )
        pending = applyModularOp(pending, op as ModularOp, false);
      else pending = canonical(applyOp(normalize(pending), op));
    }
    d = normalize(pending);
    return { ok: true as const, design: d };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}
export function resizeDesign(d: Design, p: old.ResizePatch) {
  return applyOp(d, { kind: 'resize', ...p });
}
export function addShelf(d: Design, gap: number) {
  return applyOp(d, { kind: 'add', gap });
}
export function distributeShelves(d: Design) {
  return applyOp(d, { kind: 'distribute' });
}
export function setGapBelow(d: Design, id: string, gapMm: number) {
  return applyOp(d, { kind: 'gap', id, gapMm });
}
export function describeDesignChanges(before: Design, after: Design) {
  const legacyOnly = (d: Design) =>
    d.modules.length === 1 &&
    d.modules[0].legacyIds &&
    d.modules[0].rotation === 0 &&
    d.modules[0].back &&
    layout(d).cells.every(
      (c) => !c.node.front && (!c.node.split || c.node.split.legacyShelf),
    );
  if (
    legacyOnly(before) &&
    legacyOnly(after) &&
    before.modules[0].name === after.modules[0].name &&
    JSON.stringify(before.modules[0].position) ===
      JSON.stringify(after.modules[0].position)
  )
    return old.describeDesignChanges(
      legacyProjection(before),
      legacyProjection(after),
    );
  const out: string[] = [];
  for (const m of after.modules) {
    const b = before.modules.find((b) => b.id === m.id);
    if (!b) {
      out.push(`${m.name}: módulo adicionado`);
      continue;
    }
    for (const key of [
      'name',
      'width',
      'height',
      'depth',
      'materialId',
      'back',
      'rotation',
    ] as const)
      if (m[key] !== b[key])
        out.push(
          `${m.name}: ${{ name: 'nome', width: 'largura', height: 'altura', depth: 'profundidade', materialId: 'material', back: 'fundo', rotation: 'rotação' }[key]} ${b[key]} → ${m[key]}`,
        );
    if (JSON.stringify(m.position) !== JSON.stringify(b.position))
      out.push(`${m.name}: posição ajustada`);
    if (JSON.stringify(m.root) !== JSON.stringify(b.root))
      out.push(`${m.name}: compartimentos ou frentes atualizados`);
  }
  for (const m of before.modules)
    if (!after.modules.some((a) => a.id === m.id))
      out.push(`${m.name}: módulo removido`);
  if (JSON.stringify(before.connections) !== JSON.stringify(after.connections))
    out.push('Conexões entre módulos atualizadas');
  return out;
}
export const describeChanges = describeDesignChanges;
export function cutCSV(d: Design) {
  const q = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
  return (
    '\uFEFF' +
    [
      [
        'ID',
        'Peça',
        'Módulos',
        'Compartimento',
        'Quantidade',
        'C (mm)',
        'L (mm)',
        'Espessura (mm)',
        'Material',
        'C1',
        'C2',
        'L1',
        'L2',
      ],
      ...generateDesign(d).parts.map((p) => [
        p.id,
        p.name,
        p.owners.join(' / '),
        p.cellId ?? '',
        1,
        p.c,
        p.l,
        p.thickness,
        p.material,
        p.edges.c1 ?? '',
        p.edges.c2 ?? '',
        p.edges.l1 ?? '',
        p.edges.l2 ?? '',
      ]),
    ]
      .map((row) => row.map(q).join(';'))
      .join('\r\n')
  );
}
export function cortecloud(d: Design) {
  return {
    parts: generateDesign(d).parts.map((p) => ({
      quantity: 1,
      c: p.c,
      l: p.l,
      function: p.name,
      complement: p.owners.join(' / '),
      ...p.edges,
      material: p.material,
      machining: null,
    })),
  };
}
