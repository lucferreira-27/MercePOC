/** Compatibility projections are derived, never accepted as editable composition state. */
import { z } from 'zod';
import * as old from './design';
import { materials, type Params } from './furniture';
import type { TurnStep } from './progress';
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
const MODULE_FIELD: Record<
  'width' | 'height' | 'depth' | 'materialId' | 'back' | 'rotation',
  string
> = {
  width: 'largura',
  height: 'altura',
  depth: 'profundidade',
  materialId: 'material',
  back: 'fundo',
  rotation: 'rotação',
};
const SIDE_LABEL = { left: 'à esquerda', right: 'à direita', top: 'em cima' } as const;
const FRONT_LABEL = {
  single: 'porta simples',
  double: 'porta dupla',
  drawers: 'gavetas',
  none: 'sem frente',
} as const;
const HINGE_LABEL = { left: 'dobradiça à esquerda', right: 'dobradiça à direita' } as const;
/** Nome do material para as etapas: o relatório mostra o nome, não o id. */
function materialName(id: string) {
  return materials.find((m) => m.id === id)?.name ?? id;
}
/**
 * O que cada ferramenta fez no projeto: uma etapa por operação, com o nome da
 * peça e a medida real. As medidas vêm do design depois de aplicar, nunca do
 * texto da IA, então a etapa não promete o que a operação não fez.
 */
export function describeOperations(
  before: Design,
  after: Design,
  ops: readonly ShelfOp[],
): TurnStep[] {
  const cellsAfter = new Map(layout(after).cells.map((c) => [c.id, c]));
  const cellsBefore = new Map(layout(before).cells.map((c) => [c.id, c]));
  const name = (d: Design, id: string) =>
    d.modules.find((m) => m.id === id)?.name ?? 'módulo';
  const cellLabel = (id: string) =>
    cellsAfter.get(id)?.label ?? cellsBefore.get(id)?.label ?? 'compartimento';
  const shelfLabel = (id: string) =>
    shelfInfos(before).find((s) => s.id === id)?.label ?? 'prateleira';
  const size = (m: { width: number; height: number; depth: number }) =>
    `${round2(m.width)} × ${round2(m.height)} × ${round2(m.depth)} mm`;
  const added = (d: Design) => d.modules.find((m) => !before.modules.some((b) => b.id === m.id));
  const steps: TurnStep[] = [];
  for (const op of ops) {
    switch (op.kind) {
      case 'resize': {
        const fields = (['width', 'height', 'depth'] as const)
          .filter((key) => after[key] !== before[key])
          .map((key) => `${MODULE_FIELD[key]} ${mm(before[key])} → ${mm(after[key])}`);
        if (before.materialId !== after.materialId)
          fields.push(
            `material ${materialName(before.materialId)} → ${materialName(after.materialId)}`,
          );
        steps.push({
          tool: 'resize',
          label: 'Redimensionar o móvel',
          detail: fields.join(' · '),
        });
        break;
      }
      case 'move':
        steps.push({
          tool: 'move',
          label: op.ids.length > 1 ? 'Mover prateleiras' : 'Mover prateleira',
          detail: `${op.ids.map(shelfLabel).join(', ')}: ${op.deltaMm > 0 ? '+' : ''}${round2(op.deltaMm)} mm`,
        });
        break;
      case 'gap':
        steps.push({
          tool: 'gap',
          label: 'Definir o vão da prateleira',
          detail: `${shelfLabel(op.id)}: ${mm(op.gapMm)} livres abaixo`,
        });
        break;
      case 'distribute':
        steps.push({
          tool: 'distribute',
          label: 'Distribuir as prateleiras',
          detail: `${after.shelves.length} vãos iguais`,
        });
        break;
      case 'add':
        steps.push({
          tool: 'add',
          label: 'Adicionar prateleira',
          detail: `${before.shelves.length} → ${after.shelves.length} prateleiras`,
        });
        break;
      case 'remove':
        steps.push({
          tool: 'remove',
          label: 'Remover prateleira',
          detail: op.ids.map(shelfLabel).join(', '),
        });
        break;
      case 'module.add': {
        const created = added(after);
        steps.push({
          tool: 'module.add',
          label: 'Adicionar módulo',
          detail: created ? `${created.name} · ${size(created)}` : op.preset,
        });
        break;
      }
      case 'module.edit': {
        const edited = after.modules.find((m) => m.id === op.id);
        const previous = before.modules.find((m) => m.id === op.id);
        if (!edited || !previous) break;
        const fields = (['width', 'height', 'depth'] as const)
          .filter((key) => edited[key] !== previous[key])
          .map((key) => `${MODULE_FIELD[key]} ${mm(previous[key])} → ${mm(edited[key])}`);
        if (edited.name !== previous.name)
          fields.push(`nome ${previous.name} → ${edited.name}`);
        if (edited.materialId !== previous.materialId)
          fields.push(
            `material ${materialName(previous.materialId)} → ${materialName(edited.materialId)}`,
          );
        if (edited.rotation !== previous.rotation)
          fields.push(`rotação ${previous.rotation}° → ${edited.rotation}°`);
        if (edited.back !== previous.back)
          fields.push(edited.back ? 'fundo sobreposto ligado' : 'fundo sobreposto desligado');
        if (JSON.stringify(edited.position) !== JSON.stringify(previous.position))
          fields.push('posição ajustada');
        steps.push({
          tool: 'module.edit',
          label: 'Editar módulo',
          detail: `${edited.name}: ${fields.join(' · ')}`,
        });
        break;
      }
      case 'module.duplicate': {
        const copy = added(after);
        steps.push({
          tool: 'module.duplicate',
          label: 'Duplicar módulo',
          detail: copy
            ? `${copy.name} a partir de ${name(before, op.id)} · ${size(copy)}`
            : name(before, op.id),
        });
        break;
      }
      case 'module.remove':
        steps.push({
          tool: 'module.remove',
          label: 'Remover módulo',
          detail: name(before, op.id),
        });
        break;
      case 'connect':
        steps.push({
          tool: 'connect',
          label: 'Conectar módulos',
          detail: [
            `${name(after, op.child)} ${SIDE_LABEL[op.side]} de ${name(after, op.parent)}`,
            ...(op.shared ? ['laterais compartilhadas'] : []),
            ...(op.offset ? [`deslocado ${mm(op.offset)}`] : []),
          ].join(' · '),
        });
        break;
      case 'disconnect':
        steps.push({
          tool: 'disconnect',
          label: 'Desconectar módulos',
          detail: name(before, op.child),
        });
        break;
      case 'cell.split': {
        const axis = op.axis === 'x' ? 0 : 1;
        const children = cellsAfter.get(op.id)?.node.split?.children ?? [];
        const sizes = children.map((child) => round2(cellsAfter.get(child.id)?.size[axis] ?? 0));
        steps.push({
          tool: 'cell.split',
          label: 'Dividir compartimento',
          detail: [
            `${cellLabel(op.id)}: ${op.axis === 'x' ? 'duas colunas' : 'duas alturas'}`,
            ...(sizes.length === 2 ? [`${sizes[0]} + ${sizes[1]} mm`] : []),
          ].join(' · '),
        });
        break;
      }
      case 'cell.move':
        steps.push({
          tool: 'cell.move',
          label: 'Mover a divisória',
          detail: `${cellLabel(op.id)}: peça de ${mm(op.gapMm)}`,
        });
        break;
      case 'cell.merge':
        steps.push({
          tool: 'cell.merge',
          label: 'Unir compartimentos',
          detail: `${cellLabel(op.id)}: divisória removida`,
        });
        break;
      case 'cell.distribute':
        steps.push({
          tool: 'cell.distribute',
          label: 'Distribuir as divisórias',
          detail: `${cellLabel(op.id)}: vãos iguais`,
        });
        break;
      case 'front.set': {
        const front =
          op.type === 'drawers'
            ? `${op.count ?? 3} gavetas`
            : FRONT_LABEL[op.type];
        steps.push({
          tool: 'front.set',
          label: 'Colocar frente',
          detail: [
            `${front} em ${cellLabel(op.id)}`,
            ...(op.hinge ? [HINGE_LABEL[op.hinge]] : []),
            ...(op.materialId ? [materialName(op.materialId)] : []),
          ].join(' · '),
        });
        break;
      }
      case 'drawer.height':
        steps.push({
          tool: 'drawer.height',
          label: 'Ajustar a altura da gaveta',
          detail: `${cellLabel(op.id)}: gaveta ${op.index + 1} com ${mm(op.height)}`,
        });
        break;
    }
  }
  return steps;
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
      out.push(`Módulo "${m.name}" adicionado`);
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
    ] as const) {
      if (m[key] === b[key]) continue;
      if (key === 'name') {
        out.push(`Módulo renomeado: ${b[key]} → ${m[key]}`);
        continue;
      }
      const field = MODULE_FIELD[key];
      if (key === 'width' || key === 'height' || key === 'depth')
        out.push(`${m.name}: ${field} ${mm(b[key])} → ${mm(m[key])}`);
      else if (key === 'materialId')
        out.push(
          `${m.name}: ${field} ${materialName(b[key])} → ${materialName(m[key])}`,
        );
      else if (key === 'rotation')
        out.push(`${m.name}: ${field} ${b[key]}° → ${m[key]}°`);
      else out.push(`${m.name}: fundo sobreposto ${m[key] ? 'ligado' : 'desligado'}`);
    }
    if (JSON.stringify(m.position) !== JSON.stringify(b.position))
      out.push(`"${m.name}": posição ajustada`);
    if (JSON.stringify(m.root) !== JSON.stringify(b.root))
      out.push(`"${m.name}": compartimentos e frentes ajustados`);
  }
  for (const m of before.modules)
    if (!after.modules.some((a) => a.id === m.id))
      out.push(`Módulo "${m.name}" removido`);
  if (JSON.stringify(before.connections) !== JSON.stringify(after.connections))
    out.push('Conexões entre os módulos ajustadas');
  return out;
}
export const describeChanges = describeDesignChanges;
/** Duas casas, como a interface mostra: dízima de milímetro não vai ao arquivo. */
const round2 = (value: number) => Math.round(value * 100) / 100;
const mm = (value: number) => `${round2(value)} mm`;
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
        round2(p.c),
        round2(p.l),
        round2(p.thickness),
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
      c: round2(p.c),
      l: round2(p.l),
      function: p.name,
      complement: p.owners.join(' / '),
      ...p.edges,
      material: p.material,
      machining: null,
    })),
  };
}
