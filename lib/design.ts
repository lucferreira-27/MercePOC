import { z } from 'zod';
import {
  buildParts,
  generate,
  type MaterialId,
  type Params,
} from './furniture';

export const MIN_GAP = 100;
export const MAX_SHELVES = 8;
export const PANEL = 18;
const EPS = 1e-6;

export const shelfSchema = z.object({
  id: z.string().min(1).max(20),
  elevation: z.number(),
});
export type Shelf = z.infer<typeof shelfSchema>;

export const designSchema = z
  .object({
    schemaVersion: z.literal(2),
    width: z.number().min(300).max(1200),
    height: z.number().min(400).max(2400),
    depth: z.number().min(200).max(600),
    materialId: z.enum(['white', 'oak', 'graphite']),
    shelves: z.array(shelfSchema).max(MAX_SHELVES),
  })
  .strict();
export type Design = z.infer<typeof designSchema>;

export function isDesign(value: unknown): value is Design {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion === 2
  );
}

const byElevation = (a: Shelf, b: Shelf) => a.elevation - b.elevation;
export const sortedShelves = (d: Design): Shelf[] =>
  [...d.shelves].sort(byElevation);

/** Posição herdada pelo id antigo `shelf-N` (N-ésima de baixo para cima). */
export function resolveShelfId(id: string, d: Design): string | null {
  if (d.shelves.some((s) => s.id === id)) return id;
  const legacy = /^shelf-(\d+)$/.exec(id);
  if (legacy) {
    const stable = `sh-${legacy[1]}`;
    if (d.shelves.some((s) => s.id === stable)) return stable;
  }
  return null;
}

/** Rótulo visual pela ordem vertical: Prateleira 1 é a de baixo. */
export function shelfLabel(d: Design, id: string): string {
  const i = sortedShelves(d).findIndex((s) => s.id === id);
  return i < 0 ? id : `Prateleira ${i + 1}`;
}

/**
 * Converte parâmetros legados (schema v1) para o design v2.
 * Gera a geometria com as regras antigas e lê a face inferior de cada
 * prateleira; dimensões, vãos e acabamento são preservados exatamente.
 * O id antigo `shelf-N` vira o id estável `sh-N`.
 */
export function migrateParams(p: Params): Design {
  const legacy = generate(p);
  const shelves: Shelf[] = [];
  let y = PANEL;
  for (let i = 0; i < legacy.openings.length - 1; i++) {
    y += legacy.openings[i];
    shelves.push({ id: `sh-${i + 1}`, elevation: y });
    y += PANEL;
  }
  return {
    schemaVersion: 2,
    width: p.width,
    height: p.height,
    depth: p.depth,
    materialId: p.materialId,
    shelves,
  };
}

/** Alturas livres dos vãos, de baixo para cima (sempre n+1 valores). */
export function gapsOf(d: Design): number[] {
  const shelves = sortedShelves(d);
  const gaps: number[] = [];
  let ref = PANEL;
  for (const s of shelves) {
    gaps.push(s.elevation - ref);
    ref = s.elevation + PANEL;
  }
  gaps.push(d.height - PANEL - ref);
  return gaps;
}

export type ShelfInfo = {
  id: string;
  label: string;
  elevation: number;
  gapBelow: number;
  gapAbove: number;
};

export function shelfInfos(d: Design): ShelfInfo[] {
  const shelves = sortedShelves(d);
  const gaps = gapsOf(d);
  return shelves.map((s, i) => ({
    id: s.id,
    label: `Prateleira ${i + 1}`,
    elevation: s.elevation,
    gapBelow: gaps[i],
    gapAbove: gaps[i + 1],
  }));
}

function assertGaps(d: Design): void {
  const gaps = gapsOf(d);
  const infos = shelfInfos(d);
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i] < MIN_GAP) {
      const below =
        i === 0 ? 'a base' : infos[i - 1].label;
      const above =
        i === gaps.length - 1 ? 'o tampo' : infos[i].label;
      throw new Error(
        `Vão de ${Math.round(gaps[i])} mm entre ${below} e ${above}: mínimo de ${MIN_GAP} mm.`,
      );
    }
  }
}

function finalize(
  d: Design,
  shelves: Shelf[],
  checkCount = true,
): Design {
  const ordered = [...shelves].sort(byElevation);
  if (checkCount && ordered.length > MAX_SHELVES)
    throw new Error(`Limite de ${MAX_SHELVES} prateleiras.`);
  const next: Design = { ...d, shelves: ordered };
  designSchema.parse(next);
  assertGaps(next);
  return next;
}

function requireShelves(d: Design, ids: readonly string[]): Shelf[] {
  return ids.map((id) => {
    const found = d.shelves.find((s) => s.id === id);
    if (!found)
      throw new Error(
        `Peça ${id} não é uma prateleira editável. Base, tampo, laterais e fundo não se movem por aqui.`,
      );
    return found;
  });
}

/** Desloca as prateleiras indicadas preservando a distância entre elas. */
export function moveShelves(
  d: Design,
  ids: readonly string[],
  deltaMm: number,
): Design {
  if (!Number.isFinite(deltaMm) || deltaMm === 0)
    throw new Error('Informe um deslocamento diferente de zero, em mm.');
  const targets = new Set(requireShelves(d, ids).map((s) => s.id));
  return finalize(
    d,
    d.shelves.map((s) =>
      targets.has(s.id) ? { ...s, elevation: s.elevation + deltaMm } : s,
    ),
  );
}

/** Move uma prateleira para obter o vão livre pedido abaixo dela. */
export function setGapBelow(d: Design, id: string, gapMm: number): Design {
  if (!Number.isFinite(gapMm))
    throw new Error('Informe o vão livre em mm.');
  if (gapMm < MIN_GAP)
    throw new Error(
      `Vão pedido de ${gapMm} mm abaixo do mínimo de ${MIN_GAP} mm.`,
    );
  requireShelves(d, [id]);
  const shelves = sortedShelves(d);
  const i = shelves.findIndex((s) => s.id === id);
  const ref = i === 0 ? PANEL : shelves[i - 1].elevation + PANEL;
  return finalize(
    d,
    shelves.map((s, j) => (j === i ? { ...s, elevation: ref + gapMm } : s)),
  );
}

/** Redistribui todas as prateleiras com vãos iguais entre base e tampo. */
export function distributeShelves(d: Design): Design {
  const n = d.shelves.length;
  if (!n) throw new Error('Não há prateleiras internas para distribuir.');
  const gap = (d.height - 2 * PANEL - n * PANEL) / (n + 1);
  const shelves = sortedShelves(d).map((s, i) => ({
    ...s,
    elevation: PANEL + gap * (i + 1) + PANEL * i,
  }));
  return finalize(d, shelves);
}

function nextShelfId(d: Design): string {
  let max = 0;
  for (const s of d.shelves) {
    const m = /^sh-(\d+)$/.exec(s.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `sh-${max + 1}`;
}

/** Insere uma prateleira no centro do vão indicado (0 = abaixo da primeira). */
export function addShelf(d: Design, gap: number): Design {
  const gaps = gapsOf(d);
  if (!Number.isInteger(gap) || gap < 0 || gap >= gaps.length)
    throw new Error(
      `Vão ${gap} inválido: escolha de 0 a ${gaps.length - 1}.`,
    );
  if (d.shelves.length >= MAX_SHELVES)
    throw new Error(`Limite de ${MAX_SHELVES} prateleiras.`);
  const size = gaps[gap];
  const each = (size - PANEL) / 2;
  if (each < MIN_GAP)
    throw new Error(
      `Vão de ${Math.round(size)} mm é pequeno: dividir criaria vãos de ${Math.floor(each)} mm, abaixo do mínimo de ${MIN_GAP} mm.`,
    );
  const shelves = sortedShelves(d);
  const start = gap === 0 ? PANEL : shelves[gap - 1].elevation + PANEL;
  return finalize(d, [
    ...shelves,
    { id: nextShelfId(d), elevation: start + each },
  ]);
}

/** Remove apenas prateleiras internas selecionadas. */
export function removeShelves(d: Design, ids: readonly string[]): Design {
  if (!ids.length) throw new Error('Selecione ao menos uma prateleira.');
  const targets = new Set(requireShelves(d, ids).map((s) => s.id));
  return finalize(
    d,
    d.shelves.filter((s) => !targets.has(s.id)),
    false,
  );
}

export type ResizePatch = {
  width?: number;
  height?: number;
  depth?: number;
  materialId?: MaterialId;
};

/**
 * Redimensiona o móvel. Na altura, preserva a proporção dos vãos livres
 * existentes em relação ao espaço livre total (descontadas as espessuras):
 * cada vão é multiplicado por livre_novo/livre_antigo e as prateleiras
 * são reempilhadas de baixo para cima a partir da base.
 */
export function resizeDesign(d: Design, patch: ResizePatch): Design {
  const next = designSchema.parse({ ...d, ...patch, shelves: d.shelves });
  if (
    patch.width === undefined &&
    patch.height === undefined &&
    patch.depth === undefined &&
    patch.materialId === undefined
  )
    throw new Error('Nenhuma medida informada.');
  if (patch.height === undefined || patch.height === d.height)
    return finalize(next, sortedShelves(d));
  const n = d.shelves.length;
  const freeOf = (h: number) => h - 2 * PANEL - n * PANEL;
  const oldFree = freeOf(d.height);
  const newFree = freeOf(next.height);
  if (newFree < (n + 1) * MIN_GAP) {
    const smallest = Math.round((Math.min(...gapsOf(d)) * newFree) / oldFree);
    throw new Error(
      `Altura de ${next.height} mm espreme os vãos para cerca de ${smallest} mm no menor deles: mínimo de ${MIN_GAP} mm.`,
    );
  }
  const factor = newFree / oldFree;
  const gaps = gapsOf(d).map((g) => g * factor);
  const shelves = sortedShelves(d).map((s, i) => ({
    ...s,
    elevation:
      PANEL + gaps.slice(0, i + 1).reduce((a, g) => a + g, 0) + PANEL * i,
  }));
  return finalize(next, shelves);
}

export const opSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('move'),
      ids: z.array(z.string().min(1).max(20)).min(1).max(MAX_SHELVES),
      deltaMm: z.number().min(-2000).max(2000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('gap'),
      id: z.string().min(1).max(20),
      gapMm: z.number().min(1).max(2000),
    })
    .strict(),
  z.object({ kind: z.literal('distribute') }).strict(),
  z
    .object({
      kind: z.literal('add'),
      gap: z.number().int().min(0).max(MAX_SHELVES),
    })
    .strict(),
  z
    .object({
      kind: z.literal('remove'),
      ids: z.array(z.string().min(1).max(20)).min(1).max(MAX_SHELVES),
    })
    .strict(),
  z
    .object({
      kind: z.literal('resize'),
      width: z.number().min(300).max(1200).optional(),
      height: z.number().min(400).max(2400).optional(),
      depth: z.number().min(200).max(600).optional(),
      materialId: z.enum(['white', 'oak', 'graphite']).optional(),
    })
    .strict(),
]);
export type ShelfOp = z.infer<typeof opSchema>;

/** Aplica uma operação de forma atômica: tudo válido ou nada muda. */
export function applyOp(d: Design, op: ShelfOp): Design {
  switch (op.kind) {
    case 'move':
      return moveShelves(d, op.ids, op.deltaMm);
    case 'gap':
      return setGapBelow(d, op.id, op.gapMm);
    case 'distribute':
      return distributeShelves(d);
    case 'add':
      return addShelf(d, op.gap);
    case 'remove':
      return removeShelves(d, op.ids);
    case 'resize':
      return resizeDesign(d, op);
  }
}

const MATERIAL_NAMES: Record<MaterialId, string> = {
  white: 'Branco fosco',
  oak: 'Carvalho natural',
  graphite: 'Grafite',
};

const mm = (v: number) => `${Math.round(v)} mm`;

/** Descreve em português as diferenças entre dois designs. */
export function describeDesignChanges(before: Design, after: Design): string[] {
  const out: string[] = [];
  if (before.width !== after.width)
    out.push(`Largura: ${before.width} mm → ${after.width} mm`);
  if (before.height !== after.height)
    out.push(`Altura: ${before.height} mm → ${after.height} mm`);
  if (before.depth !== after.depth)
    out.push(`Profundidade: ${before.depth} mm → ${after.depth} mm`);
  if (before.materialId !== after.materialId)
    out.push(
      `Material: ${MATERIAL_NAMES[before.materialId]} → ${MATERIAL_NAMES[after.materialId]}`,
    );
  const b = new Map(before.shelves.map((s) => [s.id, s.elevation]));
  const a = new Map(after.shelves.map((s) => [s.id, s.elevation]));
  const beforeGaps = new Map(
    shelfInfos(before).map((s) => [s.id, s.gapBelow]),
  );
  const afterInfos = new Map(shelfInfos(after).map((s) => [s.id, s]));
  for (const [id] of b)
    if (!a.has(id)) {
      const i = sortedShelves(before).findIndex((s) => s.id === id);
      out.push(`Prateleira ${i + 1} removida`);
    }
  const sameSet =
    b.size === a.size && [...b.keys()].every((id) => a.has(id));
  if (sameSet && b.size > 0) {
    const gaps = gapsOf(after);
    const equal =
      gaps.length > 0 && gaps.every((g) => Math.abs(g - gaps[0]) < EPS);
    const moved = [...b.keys()].filter((id) => b.get(id) !== a.get(id));
    if (equal && moved.length === b.size) {
      out.push('Prateleiras redistribuídas igualmente');
      return out;
    }
  }
  for (const [id, info] of afterInfos) {
    if (!b.has(id)) {
      out.push(
        `${info.label} adicionada no vão de ${mm(info.gapBelow)} abaixo`,
      );
      continue;
    }
    const delta = (a.get(id) ?? 0) - (b.get(id) ?? 0);
    if (delta !== 0) {
      const was = beforeGaps.get(id) ?? 0;
      out.push(
        `${info.label} ${delta > 0 ? 'subiu' : 'desceu'} ${mm(Math.abs(delta))} (vão abaixo ${mm(was)} → ${mm(info.gapBelow)})`,
      );
    }
  }
  return out;
}

/** Geometria, cotas, lista e exportações derivadas do mesmo design. */
export function generateDesign(input: Design) {
  const d = designSchema.parse(input);
  const shelves = sortedShelves(d);
  const openings = gapsOf(d);
  if (openings.some((v) => v < MIN_GAP))
    throw new Error(
      'Cada vão precisa de pelo menos 100 mm. Reduza as prateleiras ou aumente a altura.',
    );
  return buildParts({
    width: d.width,
    height: d.height,
    depth: d.depth,
    materialId: d.materialId,
    shelfIds: shelves.map((s) => s.id),
    elevations: shelves.map((s) => s.elevation),
    openings,
  });
}
