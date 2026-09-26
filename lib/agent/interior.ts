import { z } from 'zod';
import { PROFILE, type Cell, type Module } from '../composition';
import { materialIds, type MaterialId } from '../furniture';
import type { ShelfOp } from '../studio';

/**
 * Interior de um módulo descrito como quem desenha: linhas de baixo para
 * cima, cada uma com altura (ou dividindo o que sobra), colunas e a frente.
 * O app faz a conta dos vãos (painel de 18 mm entre eles, mínimo de 100 mm,
 * gaveta de pelo menos 80 mm) e monta os cell.split e front.set na ordem
 * certa. A IA errava essa conta à mão (vãos de 78 e 22 mm no pedido real).
 */
export const FRONTS = ['aberto', 'porta', 'porta_dupla', 'gavetas'] as const;
export const rowSchema = z
  .object({
    altura: z.number().min(100).max(2400).optional().describe('Vão livre da linha em mm; ausente divide o que sobra por igual'),
    colunas: z.number().int().min(1).max(6).optional(),
    frente: z.enum(FRONTS).optional(),
    gavetas: z.number().int().min(1).max(6).optional(),
  })
  .strict();
export const interiorSchema = z
  .object({
    linhas: z.array(rowSchema).min(1).max(12).optional().describe('De baixo para cima'),
    vaos: z.number().int().min(1).max(12).optional().describe('Linhas iguais (atalho de linhas)'),
    colunas: z.number().int().min(1).max(6).optional(),
    frente: z.enum(FRONTS).optional(),
    gavetas: z.number().int().min(1).max(6).optional(),
    porta_inteira: z
      .enum(['porta', 'porta_dupla'])
      .optional()
      .describe('Uma porta (ou duas) cobrindo o módulo inteiro, com as linhas atrás dela como prateleiras'),
    material_frente: z.enum(materialIds).optional(),
  })
  .strict();
export type Interior = z.infer<typeof interiorSchema>;
type Row = z.infer<typeof rowSchema>;

/** Divide `space` em `n` partes inteiras; as fixas ficam, o resto é repartido por igual. */
function share(space: number, wants: (number | undefined)[]) {
  const fixed = wants.reduce<number>((a, v) => a + (v ?? 0), 0);
  const free = wants.filter((v) => v === undefined).length;
  const rest = space - fixed;
  const each = free ? Math.floor(rest / free) : 0;
  let left = rest - each * free;
  return wants.map((v) => {
    if (v !== undefined) return v;
    const extra = left > 0 && free ? left : 0;
    left = 0;
    return each + extra;
  });
}

const DRAWER_MIN = 80;

/**
 * Operações que montam o interior num módulo de vão único (`<id>:root` sem
 * divisão nem frente). Devolve o erro em frase quando a conta não fecha,
 * dizendo o máximo que cabe.
 */
export function interiorOps(
  moduleId: string,
  size: { width: number; height: number },
  spec: Interior,
  cellId = `${moduleId}:root`,
  inner?: { width: number; height: number },
): { ops: ShelfOp[]; cells: string[][] } | { error: string } {
  const P = PROFILE.panel;
  const W = inner?.width ?? size.width - 2 * P;
  const H = inner?.height ?? size.height - 2 * P;
  const rows: Row[] = spec.linhas ?? Array.from({ length: spec.vaos ?? 1 }, () => ({}));
  // Porta inteira: as linhas ficam abertas atrás dela.
  const filled = rows.map((r) => ({
    colunas: r.colunas ?? spec.colunas ?? 1,
    frente: spec.porta_inteira ? 'aberto' : (r.frente ?? spec.frente ?? 'aberto'),
    gavetas: r.gavetas ?? spec.gavetas,
    altura: r.altura,
  }));
  const space = H - (filled.length - 1) * P;
  const heights = share(space, filled.map((r) => r.altura));
  const maxRows = Math.max(1, Math.floor((H + P) / (100 + P)));
  if (heights.some((h) => h < 100))
    return {
      error: `Interior de ${W} × ${H} mm livres não comporta essas linhas: cada vão precisa de 100 mm (cabem até ${maxRows} linhas iguais de ${Math.floor((H - (maxRows - 1) * P) / maxRows)} mm).`,
    };
  if (heights.reduce((a, b) => a + b, 0) !== space)
    return { error: `As alturas das linhas somam ${heights.reduce((a, b) => a + b, 0)} mm, e o vão livre tem ${space} mm (${H} mm menos ${filled.length - 1} painéis de ${P} mm).` };
  for (const [i, r] of filled.entries()) {
    const maxCols = Math.max(1, Math.floor((W + P) / (100 + P)));
    if (r.colunas > maxCols) return { error: `Linha ${i + 1}: ${r.colunas} colunas não cabem em ${W} mm (até ${maxCols}, 100 mm cada).` };
    const drawers = r.frente === 'gavetas' ? (r.gavetas ?? Math.min(3, Math.max(1, Math.floor(heights[i] / 180)))) : 0;
    if (drawers && heights[i] - 4 - 2 * (drawers - 1) < drawers * DRAWER_MIN)
      return {
        error: `Linha ${i + 1}: ${drawers} gavetas não cabem em ${heights[i]} mm (cada frente precisa de ${DRAWER_MIN} mm; cabem ${Math.max(0, Math.floor((heights[i] - 2) / (DRAWER_MIN + 2)))}).`,
      };
  }
  const ops: ShelfOp[] = [];
  const rowCells: string[] = [];
  let current = cellId;
  for (let i = 0; i < filled.length; i++) {
    if (i === filled.length - 1) {
      rowCells.push(current);
      break;
    }
    ops.push({ kind: 'cell.split', id: current, axis: 'y', gapMm: heights[i] });
    rowCells.push(`${current}:low`);
    current = `${current}:high`;
  }
  const cells: string[][] = [];
  for (const [i, r] of filled.entries()) {
    const widths = share(W - (r.colunas - 1) * P, Array(r.colunas).fill(undefined));
    const leaves: string[] = [];
    let cur = rowCells[i];
    for (let c = 0; c < r.colunas; c++) {
      if (c === r.colunas - 1) {
        leaves.push(cur);
        break;
      }
      ops.push({ kind: 'cell.split', id: cur, axis: 'x', gapMm: widths[c] });
      leaves.push(`${cur}:low`);
      cur = `${cur}:high`;
    }
    cells.push(leaves);
    if (r.frente === 'aberto') continue;
    for (const [c, leaf] of leaves.entries()) {
      const type = r.frente === 'gavetas' ? 'drawers' : r.frente === 'porta_dupla' || (r.frente === 'porta' && widths[c] >= 700) ? 'double' : 'single';
      ops.push({
        kind: 'front.set',
        id: leaf,
        type,
        ...(type === 'drawers' ? { count: r.gavetas ?? Math.min(3, Math.max(1, Math.floor(heights[i] / 180))) } : {}),
        ...(type === 'single' && leaves.length > 1 ? { hinge: c < leaves.length / 2 ? 'left' : 'right' } : {}),
        ...(spec.material_frente ? { materialId: spec.material_frente as MaterialId } : {}),
      } as ShelfOp);
    }
  }
  if (spec.porta_inteira) {
    const type = spec.porta_inteira === 'porta_dupla' || W >= 700 ? 'double' : 'single';
    ops.push({ kind: 'front.set', id: cellId, type, ...(spec.material_frente ? { materialId: spec.material_frente as MaterialId } : {}) } as ShelfOp);
  }
  return { ops, cells };
}

/**
 * Operações que esvaziam o interior de um módulo (frentes e divisões, de
 * baixo para cima), para trocar por outro. A IA precisava tirar frente por
 * frente e mesclar na ordem certa.
 */
export function clearOps(m: Module): ShelfOp[] {
  const ops: ShelfOp[] = [];
  const visit = (c: Cell) => {
    if (c.split) c.split.children.forEach(visit);
    if (c.front) ops.push({ kind: 'front.set', id: c.id, type: 'none' });
    if (c.split) ops.push({ kind: 'cell.merge', id: c.id });
  };
  visit(m.root);
  return ops;
}

/** Interior padrão de cada tipo, pela altura: o que a pessoa espera de "estante", "armário". */
export function defaultInterior(type: 'nicho' | 'estante' | 'armario' | 'gaveteiro', height: number): Interior {
  const inner = height - 2 * PROFILE.panel;
  if (type === 'estante') return { vaos: Math.max(2, Math.min(8, Math.round(inner / 360))) };
  if (type === 'gaveteiro') return { frente: 'gavetas', gavetas: Math.max(1, Math.min(6, Math.floor(inner / 180))) };
  // Armário: prateleiras atrás de uma porta (duas quando é largo).
  if (type === 'armario') return { vaos: Math.max(1, Math.min(6, Math.round(inner / 380))), porta_inteira: 'porta' };
  return {};
}
