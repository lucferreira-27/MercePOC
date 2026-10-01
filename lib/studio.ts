/** Compatibility projections are derived, never accepted as editable composition state. */
import { z } from 'zod';
import * as old from './design';
import { materials, type Params } from './furniture';
import type { ChangeHighlight } from './progress';
import {
  applyModularOp,
  compositionSchema,
  generateComposition,
  layout,
  migrateComposition,
  modularOpSchema,
  SCHEMA_VERSION,
  settle,
  type Composition,
  type CompositionV3,
  type ModularOp,
} from './composition';
import { lookChanges } from './look';
import { applyAssetOp, assetById, assetOpSchema, type AssetOp } from './assets';
export type Design = Composition & {
  width: number;
  height: number;
  depth: number;
  materialId: old.Design['materialId'];
  shelves: old.Shelf[];
};
export type ShelfOp = old.ShelfOp | ModularOp | AssetOp;
/**
 * O projeto como é gravado: só os campos do contrato, na versão atual. Uma
 * composição v3 (projeto antigo, cena de teste) sai v4 com a mesma geometria.
 */
export function canonical(input: Composition | CompositionV3): Composition {
  return compositionSchema.parse(
    JSON.parse(
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        profile: input.profile,
        modules: input.modules,
        connections: input.connections,
        ...('style' in input && input.style ? { style: input.style } : {}),
      }),
    ),
  );
}
export function normalize(input: Composition | CompositionV3 | old.Design): Design {
  const d =
    input.schemaVersion === SCHEMA_VERSION || input.schemaVersion === 3 ? canonical(input) : migrateComposition(input);
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
  assetOpSchema,
]) as z.ZodType<ShelfOp>;
export function isDesign(v: unknown): v is Design {
  return (
    !!v &&
    typeof v === 'object' &&
    'schemaVersion' in v &&
    [2, 3, SCHEMA_VERSION].includes(Number(v.schemaVersion))
  );
}
export function migrateParams(v: Params) {
  return normalize(old.migrateParams(v));
}
export function generateDesign(d: Design) {
  return generateComposition(canonical(d));
}
const generated = new WeakMap<object, ReturnType<typeof generateComposition>>();
/**
 * `generateDesign` lembrado por objeto: a mesma versão consultada várias vezes
 * (seleção, nomes, ids vivos) gera uma vez só. Vale para projetos tratados
 * como imutáveis, como o estado da interface e as revisões gravadas. Não
 * altere o design depois nem o resultado devolvido.
 */
export function designOf(d: Design) {
  let g = generated.get(d);
  if (!g) {
    g = generateDesign(d);
    generated.set(d, g);
  }
  return g;
}
export function shelfInfos(d: Design) {
  if (d.modules.length === 1 && d.modules[0].legacyIds)
    return old.shelfInfos(legacyProjection(d));
  // Só prateleira de compartimento (divisão horizontal): a prateleira de parede
  // também gera peça 'shelf', mas não tem vão acima nem abaixo para medir.
  const cells = layout(d).cells;
  return generateDesign(d)
    .parts.flatMap((p) => {
      const info = p.kind === 'shelf' ? cells.find((c) => c.node.split?.id === p.id) : undefined;
      return info ? [{ p, info }] : [];
    })
    .map(({ p, info }, i) => {
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
  const g = designOf(d);
  return [
    ...d.modules.map((m) => m.id),
    ...g.cells.map((c) => c.id),
    ...g.cells.flatMap((c) => (c.node.front ? [c.node.front.id] : [])),
    ...g.parts.map((p) => p.id),
  ];
}
export function selectedPartIds(d: Design, selected: readonly string[]) {
  const g = designOf(d),
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
  if (op.kind === 'asset.add') return normalize(applyAssetOp(d, op));
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
/**
 * Um passo do lote sem validar o conjunto: o estado intermediário pode não
 * fechar (módulo recém-criado ainda sem conexão) e só o resultado do lote
 * inteiro é validado.
 */
export function applyStep(pending: Composition, op: ShelfOp): Composition {
  if (op.kind === 'asset.add') return applyAssetOp(pending, op);
  if (op.kind.includes('.') || op.kind === 'connect' || op.kind === 'disconnect')
    return applyModularOp(pending, op as ModularOp, false);
  return canonical(applyOp(normalize(pending), op));
}
export function executeRequest(base: Design, ops: ShelfOp[]) {
  let d = base;
  try {
    let pending: Composition = canonical(d);
    // Trocar o único módulo: tirar primeiro deixaria o projeto vazio no meio
    // do lote. A remoção espera o fim do lote quando outra operação ainda
    // põe módulo; só o resultado final é validado.
    const later: ShelfOp[] = [];
    ops.forEach((op, i) => {
      const adds = ops.slice(i + 1).some((v) => v.kind === 'module.add' || v.kind === 'module.duplicate' || v.kind === 'asset.add');
      if (op.kind === 'module.remove' && pending.modules.length === 1 && adds) later.push(op);
      else pending = applyStep(pending, op);
    });
    for (const op of later) pending = applyStep(pending, op);
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
const HINGE_LABEL = { left: 'dobradiça à esquerda', right: 'dobradiça à direita' } as const;
const ALIGN_LABEL = { front: 'alinhado pela frente', back: 'alinhado pelos fundos' } as const;
/** Nome do material para as etapas: o relatório mostra o nome, não o id. */
function materialName(id: string) {
  return materials.find((m) => m.id === id)?.name ?? id;
}
/**
 * O que mudou no projeto, contado como quem desenha móvel conta: "Nicho
 * adicionado, 800 × 600 × 450 mm, à direita da estante, alinhado pela frente".
 * Cada cartão é derivado do desenho DEPOIS de aplicar e das conexões que
 * ficaram de pé, então a interface nunca promete o que a operação não fez.
 */
export function describeHighlights(
  before: Design,
  after: Design,
  ops: readonly ShelfOp[],
): ChangeHighlight[] {
  /**
   * Chave de agrupamento: um lote que divide três vãos iguais vira um cartão
   * com três linhas, não três cartões idênticos que ninguém compara.
   */
  const groupKey = (op: ShelfOp, i: number): string => {
    if (op.kind === 'cell.split') return `cell.split:${op.axis}`;
    if (op.kind === 'front.set') return `front.set:${op.type}:${op.count ?? ''}:${op.hinge ?? ''}`;
    if (op.kind === 'cell.move' || op.kind === 'cell.merge' || op.kind === 'cell.distribute')
      return op.kind;
    if (op.kind === 'drawer.height') return 'drawer.height';
    return `${op.kind}#${i}`;
  };
  const grupos = new Map<string, ShelfOp[]>();
  const indices = new Map<string, number[]>();
  ops.forEach((op, i) => {
    const chave = groupKey(op, i);
    const atual = grupos.get(chave);
    if (atual) atual.push(op);
    else grupos.set(chave, [op]);
    indices.set(chave, [...(indices.get(chave) ?? []), i]);
  });
  /** Ids que existem em algum dos lados: o que a linha pode destacar. */
  const alive = new Set([
    ...entityIds(after),
    ...before.modules.map((m) => m.id),
  ]);
  const targetsOf = (lote: ShelfOp[]) => {
    const ids = new Set<string>();
    for (const op of lote) {
      if (op.kind === 'asset.add') {
        for (const m of after.modules) if (!before.modules.some((b) => b.id === m.id)) ids.add(m.id);
        continue;
      }
      for (const key of ['id', 'newId', 'child', 'parent'] as const) {
        const v = (op as Record<string, unknown>)[key];
        if (typeof v === 'string' && alive.has(v)) ids.add(v);
      }
      if ('ids' in op && Array.isArray(op.ids)) for (const v of op.ids) if (alive.has(v)) ids.add(v);
    }
    return [...ids];
  };
  const signFor = (op: ShelfOp): '+' | '-' | '~' => {
    if (op.kind === 'front.set') return op.type === 'none' ? '-' : '+';
    if (/remove|disconnect|merge/.test(op.kind)) return '-';
    if (/add|duplicate|split|asset/.test(op.kind)) return '+';
    return '~';
  };
  const cellsAfter = layout(after).cells;
  const cellsBefore = layout(before).cells;
  const name = (d: Design, id: string) =>
    d.modules.find((m) => m.id === id)?.name ?? 'módulo';
  const cellLabel = (id: string) =>
    (cellsAfter.find((c) => c.id === id) ?? cellsBefore.find((c) => c.id === id))?.label ??
    'compartimento';
  const shelfLabel = (id: string) =>
    shelfInfos(before).find((s) => s.id === id)?.label ?? 'prateleira';
  const mm = (value: number) => `${round2(value)} mm`;
  // Prateleira de parede: a altura do módulo é a espessura da tábua; quem lê
  // quer largura × fundo, como se mede prateleira.
  const dims = (m: { width: number; height: number; depth: number; kind?: string }) =>
    m.kind === 'ledge'
      ? `${round2(m.width)} × ${round2(m.depth)} mm, ${round2(m.height)} mm de espessura`
      : `${round2(m.width)} × ${round2(m.height)} × ${round2(m.depth)} mm`;
  const measuresOf = (m: { width: number; height: number; depth: number; kind?: string }) =>
    m.kind === 'ledge'
      ? [
          { label: 'Largura', value: mm(m.width) },
          { label: 'Profundidade', value: mm(m.depth) },
          { label: 'Espessura', value: mm(m.height) },
        ]
      : [
          { label: 'Largura', value: mm(m.width) },
          { label: 'Altura', value: mm(m.height) },
          { label: 'Profundidade', value: mm(m.depth) },
        ];
  const frontsOf = (d: Design, id: string) => {
    const cells = layout(d).cells.filter((c) => c.moduleId === id);
    const parts = cells
      .filter((c) => c.node.front)
      .map((c) => {
        const front = c.node.front!;
        if (front.type === 'drawers') return `${front.heights.length} gavetas`;
        return front.type === 'double' ? 'porta dupla' : 'porta simples';
      });
    const open = cells.filter((c) => !c.node.front && !c.node.split).length;
    if (open) parts.push(open === 1 ? 'um vão aberto' : `${open} vãos abertos`);
    return parts;
  };
  const shelvesOf = (d: Design, id: string) =>
    generateDesign(d).parts.filter((p) => p.kind === 'shelf' && p.owners.includes(id)).length;
  /** Propriedades do módulo que interessam a quem olha o resultado. */
  const moduleFacts = (d: Design, id: string, extra: { label: string; value: string }[] = []) => {
    const m = d.modules.find((v) => v.id === id);
    if (!m) return extra;
    const facts = [...extra];
    const fronts = frontsOf(d, id);
    if (fronts.length) facts.push({ label: 'Frentes', value: fronts.join(', ') });
    const shelves = shelvesOf(d, id);
    if (shelves) facts.push({ label: 'Prateleiras', value: String(shelves) });
    facts.push({ label: 'Acabamento', value: materialName(m.materialId) });
    if (m.rotation) facts.push({ label: 'Orientação', value: `${m.rotation}°` });
    facts.push({ label: 'Fundo', value: m.back ? 'sobreposto' : 'sem fundo' });
    return facts;
  };
  /** Como o módulo se apoia no resto: conexão manda, geometria só desempata. */
  const attachment = (d: Design, id: string) => {
    const conn = d.connections.find((c) => c.child === id);
    if (!conn) return null;
    return {
      parent: name(d, conn.parent),
      side: SIDE_LABEL[conn.side],
      shared: conn.shared,
      align: ALIGN_LABEL[conn.align],
      offset: conn.offset,
    };
  };
  const out: ChangeHighlight[] = [];
  const novos = after.modules.filter((m) => !before.modules.some((b) => b.id === m.id));
  const addedIds = new Set(novos.map((m) => m.id));
  /** Cada módulo novo vira um cartão: dois adds no mesmo lote não se repetem. */
  const usados = new Set<string>();
  for (const [chave, lote] of grupos) {
    const op = lote[0];
    const antes = out.length;
    switch (op.kind) {
      case 'asset.add': {
        const novosDoAtivo = after.modules.filter((m) => !before.modules.some((b) => b.id === m.id));
        const g = generateComposition(canonical(after));
        const xs = g.parts
          .filter((p) => p.owners.some((o) => novosDoAtivo.some((m) => m.id === o)))
          .flatMap((p) => [p.position[0] - p.size[0] / 2, p.position[0] + p.size[0] / 2]);
        const ys = g.parts
          .filter((p) => p.owners.some((o) => novosDoAtivo.some((m) => m.id === o)))
          .map((p) => p.position[1] + p.size[1] / 2);
        const largura = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
        const altura = ys.length ? Math.max(...ys) : 0;
        const nome = assetById(op.asset)?.name ?? 'Móvel';
        out.push({
          tool: op.kind,
          title: op.placement === 'replace' ? `${nome} no lugar do projeto` : `${nome} adicionado ${op.placement === 'left' ? 'à esquerda' : 'à direita'}`,
          summary: `${novosDoAtivo.length} ${novosDoAtivo.length === 1 ? 'módulo' : 'módulos'} da biblioteca, ${round2(largura)} × ${round2(altura)} mm${op.placement === 'replace' ? `; saiu o que havia antes (${before.modules.length} ${before.modules.length === 1 ? 'módulo' : 'módulos'})` : ', alinhado pela parede'}.`,
          measures: [
            { label: 'Largura', value: mm(largura) },
            { label: 'Altura', value: mm(altura) },
          ],
          facts: novosDoAtivo.slice(0, 6).map((m) => ({ label: m.name, value: dims(m) })),
        });
        break;
      }
      case 'module.add':
      case 'module.duplicate': {
        const pedido = op.kind === 'module.add' ? op.id : op.newId;
        const target =
          (pedido ? after.modules.find((m) => m.id === pedido) : undefined) ??
          novos.find((m) => !usados.has(m.id));
        if (!target) break;
        usados.add(target.id);
        const link = attachment(after, target.id);
        const facts: { label: string; value: string }[] = [];
        if (link) {
          facts.push({ label: 'Posição', value: `${link.side} de ${link.parent}` });
          facts.push({ label: 'Alinhamento', value: link.align });
          if (link.offset) facts.push({ label: 'Afastamento', value: mm(link.offset) });
          if (link.shared) facts.push({ label: 'Laterais', value: 'compartilhadas com o vizinho' });
        } else {
          facts.push({ label: 'Posição', value: 'sem conexão, solto no projeto' });
        }
        out.push({
          tool: op.kind,
          title:
            op.kind === 'module.add'
              ? `${target.name} adicionado`
              : `Cópia: ${target.name}`,
          summary:
            op.kind === 'module.add'
              ? `Um novo módulo de ${dims(target)}${link ? ` foi colocado ${link.side} de ${link.parent}, ${link.align}` : ' foi criado no projeto'}.`
              : `Uma cópia independente de ${name(before, op.id)} entrou com ${dims(target)}.`,
          size: [target.width, target.height, target.depth],
          measures: measuresOf(target),
          facts: moduleFacts(after, target.id, facts),
        });
        break;
      }
      case 'module.edit': {
        const edited = after.modules.find((m) => m.id === op.id);
        const previous = before.modules.find((m) => m.id === op.id);
        if (!edited || !previous) break;
        const mudancas: string[] = [];
        if (edited.width !== previous.width)
          mudancas.push(`largura de ${mm(previous.width)} para ${mm(edited.width)}`);
        if (edited.height !== previous.height)
          mudancas.push(`altura de ${mm(previous.height)} para ${mm(edited.height)}`);
        if (edited.depth !== previous.depth)
          mudancas.push(`profundidade de ${mm(previous.depth)} para ${mm(edited.depth)}`);
        if (edited.name !== previous.name)
          mudancas.push(`o nome virou ${edited.name}`);
        if (edited.materialId !== previous.materialId)
          mudancas.push(`acabamento ${materialName(edited.materialId)}`);
        if (edited.rotation !== previous.rotation)
          mudancas.push(`orientação em ${edited.rotation}°`);
        if (edited.back !== previous.back)
          mudancas.push(edited.back ? 'ganhou fundo sobreposto' : 'ficou sem fundo');
        mudancas.push(...lookChanges(previous, edited));
        out.push({
          tool: op.kind,
          title: `${edited.name} ajustado`,
          summary: mudancas.length
            ? `${mudancas.join(', ').replace(/^./, (c) => c.toUpperCase())}.`
            : 'O módulo foi reeditado sem mudar medidas nem acabamento.',
          size: [edited.width, edited.height, edited.depth],
          measures: measuresOf(edited),
          facts: moduleFacts(after, edited.id),
        });
        break;
      }
      case 'module.remove': {
        const gone = before.modules.find((m) => m.id === op.id);
        if (!gone) break;
        out.push({
          tool: op.kind,
          title: `${gone.name} removido`,
          summary: `O módulo saiu do projeto e ficaram ${after.modules.length} no lugar.`,
          measures: measuresOf(gone),
          facts: [
            { label: 'Frentes', value: frontsOf(before, gone.id).join(', ') || 'nenhuma' },
            { label: 'Acabamento', value: materialName(gone.materialId) },
          ],
        });
        break;
      }
      case 'connect': {
        // Conexão de módulo que acabou de entrar já vem contada no cartão dele.
        if (addedIds.has(op.child)) break;
        const child = after.modules.find((m) => m.id === op.child);
        const parent = after.modules.find((m) => m.id === op.parent);
        if (!child || !parent) break;
        out.push({
          tool: op.kind,
          title: `${child.name} conectado à ${SIDE_LABEL[op.side].replace('à ', '')} de ${parent.name}`,
          summary: op.shared
            ? 'A face entre os dois módulos virou uma lateral compartilhada, sem afastamento.'
            : 'Os módulos ficaram encostados, cada um com a própria lateral.',
          size: [child.width, child.height, child.depth],
          facts: [
            { label: 'Alinhamento', value: ALIGN_LABEL[op.align] },
            { label: 'Afastamento', value: op.offset ? mm(op.offset) : 'nenhum' },
            { label: 'Laterais', value: op.shared ? 'compartilhadas' : 'independentes' },
          ],
        });
        break;
      }
      case 'disconnect':
        out.push({
          tool: op.kind,
          title: `${name(before, op.child)} separado`,
          summary: 'O módulo deixou de fazer parte do conjunto e pode ser movido livremente.',
          facts: [{ label: 'Módulo', value: name(before, op.child) }],
        });
        break;
      case 'cell.split': {
        const eixo = op.axis === 'x' ? 0 : 1;
        const splits = lote.filter(
          (v): v is Extract<ShelfOp, { kind: 'cell.split' }> => v.kind === 'cell.split',
        );
        const rows = splits.map((split) => {
          const children = cellsAfter.find((c) => c.id === split.id)?.node.split?.children ?? [];
          const sizes = children.map((child) =>
            round2(cellsAfter.find((c) => c.id === child.id)?.size[eixo] ?? 0),
          );
          return {
            label: cellLabel(split.id),
            value: sizes.length === 2 ? `${sizes[0]} + ${sizes[1]} mm` : 'dois vãos',
            parts: sizes.length === 2 ? sizes : undefined,
          };
        });
        const nome = op.axis === 'x' ? 'duas colunas' : 'duas alturas';
        out.push({
          tool: op.kind,
          title:
            lote.length > 1
              ? `${lote.length} vãos divididos em ${nome}`
              : `Vão dividido em ${nome}`,
          summary:
            lote.length > 1
              ? `A divisória de 18 mm entrou em ${lote.length} compartimentos, cada um com duas medidas próprias.`
              : `A divisória de 18 mm separou o vão em ${nome}, com as medidas abaixo.`,
          rows,
        });
        break;
      }
      case 'cell.move':
        out.push({
          tool: op.kind,
          title: 'Divisória movida',
          summary: `A peça menor ficou com ${mm(op.gapMm)} e a outra fecha o compartimento.`,
          facts: [{ label: 'Compartimento', value: cellLabel(op.id) }],
        });
        break;
      case 'cell.merge':
        out.push({
          tool: op.kind,
          title: 'Divisória removida',
          summary: 'Os dois vãos viraram um só.',
          facts: [{ label: 'Compartimento', value: cellLabel(op.id) }],
        });
        break;
      case 'cell.distribute':
        out.push({
          tool: op.kind,
          title: 'Vãos igualados',
          summary: 'As colunas do compartimento ficaram com o mesmo vão.',
          facts: [{ label: 'Compartimento', value: cellLabel(op.id) }],
        });
        break;
      case 'front.set': {
        const alvo = cellsAfter.find((c) => c.id === op.id)?.node.front;
        const frente =
          op.type === 'drawers'
            ? `${op.count ?? 3} gavetas`
            : op.type === 'double'
              ? 'porta dupla'
              : op.type === 'single'
                ? 'porta'
                : 'vão aberto';
        const frenteTxt = `${frente[0].toUpperCase()}${frente.slice(1)}`;
        const titulo =
          op.type === 'none'
            ? 'Frente removida'
            : lote.length > 1
              ? `${frenteTxt} em ${lote.length} vãos`
              : op.type === 'drawers'
                ? `${frenteTxt} colocadas`
                : `${frenteTxt} colocada`;
        out.push({
          tool: op.kind,
          title: titulo,
          summary:
            op.type === 'none'
              ? 'O vão voltou a ficar aberto.'
              : lote.length > 1
                ? `A mesma frente cobre ${lote.length} vãos.`
                : `A frente cobre o vão de ${cellLabel(op.id)}.`,
          rows: lote
            .filter(
              (v): v is Extract<ShelfOp, { kind: 'front.set' }> => v.kind === 'front.set',
            )
            .map((frenteOp) => ({
            label: cellLabel(frenteOp.id),
            value:
              frenteOp.type === 'drawers'
                ? `${frenteOp.count ?? 3} gavetas`
                : frenteOp.type === 'double'
                  ? 'porta dupla'
                  : frenteOp.type === 'single'
                    ? 'porta'
                    : 'aberto',
          })),
          ...(op.hinge ? { facts: [{ label: 'Abertura', value: HINGE_LABEL[op.hinge] }] } : {}),
          ...(alvo?.materialId
            ? { facts: [{ label: 'Acabamento', value: materialName(alvo.materialId) }] }
            : {}),
        });
        break;
      }
      case 'drawer.height':
        out.push({
          tool: op.kind,
          title: 'Altura da gaveta ajustada',
          summary: `A gaveta ${op.index + 1} ficou com ${mm(op.height)}.`,
          facts: [{ label: 'Compartimento', value: cellLabel(op.id) }],
        });
        break;
      case 'resize': {
        const mudancas: string[] = [];
        for (const key of ['width', 'height', 'depth'] as const)
          if (before[key] !== after[key])
            mudancas.push(`${MODULE_FIELD[key]} de ${mm(before[key])} para ${mm(after[key])}`);
        if (before.materialId !== after.materialId)
          mudancas.push(`acabamento ${materialName(after.materialId)}`);
        out.push({
          tool: op.kind,
          title: 'Medidas do móvel ajustadas',
          summary: mudancas.length
            ? `${mudancas.join(', ').replace(/^./, (c) => c.toUpperCase())}.`
            : 'O móvel foi reeditado sem mudar medidas.',
          size: [after.width, after.height, after.depth],
          measures: measuresOf(after),
        });
        break;
      }
      case 'move':
        out.push({
          tool: op.kind,
          title: op.ids.length > 1 ? 'Prateleiras movidas' : 'Prateleira movida',
          summary: `${op.ids.map(shelfLabel).join(', ')} ${op.deltaMm > 0 ? 'subiu' : 'desceu'} ${mm(Math.abs(op.deltaMm))}.`,
        });
        break;
      case 'gap':
        out.push({
          tool: op.kind,
          title: 'Vão definido',
          summary: `${shelfLabel(op.id)} ficou com ${mm(op.gapMm)} livres abaixo.`,
        });
        break;
      case 'add':
        out.push({
          tool: op.kind,
          title: 'Prateleira adicionada',
          summary: `O móvel ficou com ${after.shelves.length} prateleiras.`,
        });
        break;
      case 'remove':
        out.push({
          tool: op.kind,
          title: 'Prateleira removida',
          summary: `Saíram: ${op.ids.map(shelfLabel).join(', ')}.`,
        });
        break;
      case 'distribute':
        out.push({
          tool: op.kind,
          title: 'Vãos distribuídos',
          summary: `As ${after.shelves.length} prateleiras ficaram com vãos iguais.`,
        });
        break;
      default:
        break;
    }
    // Cada linha nova sabe de onde veio: sinal, operações e o que destacar.
    for (const line of out.slice(antes)) {
      line.sign ??= signFor(op);
      line.ops = indices.get(chave);
      line.targets = targetsOf(lote);
    }
  }
  // Operação sem linha própria (medidas e conexão de um módulo que acabou de
  // entrar) vai para a linha que já fala daquele módulo: na reprodução todo
  // passo tem um título.
  const counted = new Set(out.flatMap((l) => l.ops ?? []));
  ops.forEach((op, i) => {
    if (counted.has(i)) return;
    const ids = targetsOf([op]);
    const owner = out.find((l) => l.targets?.some((t) => ids.includes(t)));
    if (owner) owner.ops = [...(owner.ops ?? []), i].sort((a, b) => a - b);
  });
  return out;
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
  /** Raiz do grupo conectado: é ela que guarda se o grupo está preso num painel. */
  const rootIn = (d: Design, id: string) => {
    let at = id;
    for (let c = d.connections.find((v) => v.child === at); c; c = d.connections.find((v) => v.child === at)) at = c.parent;
    return d.modules.find((v) => v.id === at);
  };
  const nameIn = (d: Design, id: string) => d.modules.find((v) => v.id === id)?.name ?? id;
  for (const m of after.modules) {
    const b = before.modules.find((b) => b.id === m.id);
    if (!b) {
      out.push(`Módulo "${m.name}" adicionado`);
      continue;
    }
    // Preso num painel de parede (mountOnPanels): diz o motivo, não "posição ajustada".
    const grouped = after.connections.some((c) => c.parent === m.id) ? ' (com os módulos ligados a ele)' : '';
    if (m.mountedOn && !b.mountedOn)
      out.push(`${m.name}${grouped}: passa para a frente de ${nameIn(after, m.mountedOn.panel)}, avança ${mm(m.mountedOn.by)}`);
    else if (!m.mountedOn && b.mountedOn)
      out.push(`${m.name}${grouped}: sai da frente de ${nameIn(before, b.mountedOn.panel)} e volta para a parede`);
    else if (m.mountedOn && b.mountedOn && (m.mountedOn.by !== b.mountedOn.by || m.mountedOn.panel !== b.mountedOn.panel))
      out.push(`${m.name}${grouped}: na frente de ${nameIn(after, m.mountedOn.panel)}, avança ${mm(b.mountedOn.by)} → ${mm(m.mountedOn.by)}`);
    const ra = rootIn(after, m.id),
      rb = rootIn(before, m.id);
    const shift = (ra?.mountedOn?.by ?? 0) - (rb?.mountedOn?.by ?? 0);
    const a = ((ra?.rotation ?? 0) * Math.PI) / 180;
    const onlyMount =
      shift !== 0 &&
      ra?.id === rb?.id &&
      Math.abs(m.position[0] - (b.position[0] + shift * Math.round(Math.sin(a)))) < 0.01 &&
      Math.abs(m.position[1] - b.position[1]) < 0.01 &&
      Math.abs(m.position[2] - (b.position[2] + shift * Math.round(Math.cos(a)))) < 0.01;
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
    if ((m.feet ?? 0) !== (b.feet ?? 0))
      out.push(
        m.feet
          ? `${m.name}: pés ${b.feet ? `${mm(b.feet)} → ` : 'de '}${mm(m.feet)}`
          : `${m.name}: sem pés`,
      );
    if (!!m.wall !== !!b.wall)
      out.push(`${m.name}: ${m.wall ? 'suspenso, preso na parede' : 'apoiado no piso'}`);
    for (const line of lookChanges(b, m)) out.push(`${m.name}: ${line}`);
    if (JSON.stringify(m.position) !== JSON.stringify(b.position) && !onlyMount)
      out.push(`"${m.name}": posição ajustada`);
    if (JSON.stringify(m.root) !== JSON.stringify(b.root))
      out.push(`"${m.name}": compartimentos e frentes ajustados`);
  }
  for (const m of before.modules)
    if (!after.modules.some((a) => a.id === m.id))
      out.push(`Módulo "${m.name}" removido`);
  if (JSON.stringify(before.connections) !== JSON.stringify(after.connections))
    out.push('Conexões entre os módulos ajustadas');
  if ((before.style ?? null) !== (after.style ?? null))
    out.push(after.style ? `Estilo do projeto: ${after.style}` : 'Projeto sem estilo marcado');
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
