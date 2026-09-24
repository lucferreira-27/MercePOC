import { materials, type Part } from './furniture';

/**
 * Plano de corte: encaixa as peças nas chapas que a oficina compra.
 *
 * A serra de painel faz cortes de ponta a ponta (guilhotina), então o
 * encaixe também é em guilhotina: cada peça ocupa o canto de um retângulo
 * livre e o resto vira dois retângulos novos, cortando pelo eixo que deixa a
 * sobra maior inteira. Não é o ótimo matemático; é um plano que a serra
 * consegue executar e que dá uma contagem honesta de chapas para o orçamento.
 *
 * Coordenadas em mm: x corre no comprimento da chapa (2750), y na largura.
 * Chapa com veio (madeira) não gira a peça: o C da peça fica no comprimento
 * da chapa, que é o sentido do veio. Chapa lisa gira quando cabe melhor.
 */
export type SheetSpec = {
  /** Comprimento da chapa, sentido do veio. */
  length: number;
  width: number;
  /** Espessura do disco de serra, descontada entre peças. */
  kerf: number;
  /** Refilo em cada borda da chapa: a borda de fábrica não serve de face. */
  trim: number;
};
export const DEFAULT_SHEET: SheetSpec = { length: 2750, width: 1840, kerf: 4, trim: 10 };

export type Placement = {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Medida no eixo x da chapa. */
  w: number;
  h: number;
  rotated: boolean;
};
export type CutSheet = {
  /** Material + espessura: "Carvalho natural 18". */
  key: string;
  material: string;
  materialId: string | null;
  thickness: number;
  grain: boolean;
  index: number;
  placements: Placement[];
  usedArea: number;
  /** Área das peças sobre a área da chapa inteira, de 0 a 1. */
  efficiency: number;
};
export type CutGroup = {
  key: string;
  material: string;
  materialId: string | null;
  thickness: number;
  grain: boolean;
  sheets: number;
  parts: number;
  area: number;
  efficiency: number;
};
export type CutPlan = {
  spec: SheetSpec;
  sheets: CutSheet[];
  groups: CutGroup[];
  /** Peças maiores que a chapa útil: precisam de emenda ou chapa especial. */
  oversize: { id: string; name: string; c: number; l: number; key: string }[];
};

type Free = { x: number; y: number; w: number; h: number };
type OpenSheet = CutSheet & { free: Free[] };

/** "Carvalho natural 18" → material do catálogo; peça sem catálogo fica lisa. */
export function materialFromLabel(label: string) {
  return materials.find((m) => label.startsWith(m.name + ' ')) ?? null;
}

export function cutPlan(parts: readonly Part[], spec: SheetSpec = DEFAULT_SHEET): CutPlan {
  const usable = { w: spec.length - 2 * spec.trim, h: spec.width - 2 * spec.trim };
  const groups = new Map<string, Part[]>();
  for (const part of parts) {
    const list = groups.get(part.material);
    if (list) list.push(part);
    else groups.set(part.material, [part]);
  }
  const sheets: CutSheet[] = [];
  const summary: CutGroup[] = [];
  const oversize: CutPlan['oversize'] = [];
  // Ordem estável: materiais de corpo (18) primeiro, depois as chapas finas.
  const keys = [...groups.keys()].sort((a, b) => {
    const ta = groups.get(a)![0].thickness;
    const tb = groups.get(b)![0].thickness;
    return tb - ta || a.localeCompare(b, 'pt-BR');
  });
  for (const key of keys) {
    const list = groups.get(key)!;
    const mat = materialFromLabel(key);
    const grain = mat?.finish === 'wood';
    const thickness = list[0].thickness;
    // Maior lado primeiro: em guilhotina, as peças compridas definem as faixas
    // e as pequenas preenchem as sobras.
    const queue = [...list].sort(
      (a, b) =>
        Math.max(b.c, b.l) - Math.max(a.c, a.l) || b.c * b.l - a.c * a.l || a.id.localeCompare(b.id),
    );
    const open: OpenSheet[] = [];
    for (const part of queue) {
      const c = Math.round(part.c * 10) / 10;
      const l = Math.round(part.l * 10) / 10;
      const orientations: [number, number, boolean][] = grain
        ? [[c, l, false]]
        : [
            [c, l, false],
            [l, c, true],
          ];
      const fits = orientations.filter(([w, h]) => w <= usable.w && h <= usable.h);
      if (!fits.length) {
        oversize.push({ id: part.id, name: part.name, c, l, key });
        continue;
      }
      let best: { sheet: OpenSheet; free: number; w: number; h: number; rotated: boolean; score: number } | null =
        null;
      for (const sheet of open)
        for (const [i, f] of sheet.free.entries())
          for (const [w, h, rotated] of fits) {
            if (w > f.w + 1e-6 || h > f.h + 1e-6) continue;
            // Menor sobra de área, desempate pelo lado curto que sobra.
            const score = f.w * f.h - w * h + Math.min(f.w - w, f.h - h) * 1e-3;
            if (!best || score < best.score) best = { sheet, free: i, w, h, rotated, score };
          }
      if (!best) {
        const sheet: OpenSheet = {
          key,
          material: key.replace(/\s+\d+(\.\d+)?$/, ''),
          materialId: mat?.id ?? null,
          thickness,
          grain,
          index: open.length + 1,
          placements: [],
          usedArea: 0,
          efficiency: 0,
          free: [{ x: spec.trim, y: spec.trim, w: usable.w, h: usable.h }],
        };
        open.push(sheet);
        const [w, h, rotated] = fits[0];
        best = { sheet, free: 0, w, h, rotated, score: 0 };
      }
      const { sheet, w, h, rotated } = best;
      const f = sheet.free.splice(best.free, 1)[0];
      sheet.placements.push({ id: part.id, name: part.name, x: f.x, y: f.y, w, h, rotated });
      sheet.usedArea += w * h;
      // A peça consome o disco nos dois lados livres. O que sobra à direita e
      // abaixo vira dois retângulos: o corte segue o eixo da sobra menor, para
      // a sobra maior continuar inteira e caber peça grande depois.
      const rightW = f.w - w - spec.kerf;
      const belowH = f.h - h - spec.kerf;
      const splitVertical = f.w - w < f.h - h;
      const right: Free = {
        x: f.x + w + spec.kerf,
        y: f.y,
        w: rightW,
        h: splitVertical ? h : f.h,
      };
      const below: Free = {
        x: f.x,
        y: f.y + h + spec.kerf,
        w: splitVertical ? f.w : w,
        h: belowH,
      };
      for (const r of [right, below]) if (r.w >= 20 && r.h >= 20) sheet.free.push(r);
    }
    const area = spec.length * spec.width;
    for (const sheet of open) {
      const { free: _, ...done } = sheet;
      done.efficiency = done.usedArea / area;
      sheets.push(done);
    }
    const used = open.reduce((a, s) => a + s.usedArea, 0);
    summary.push({
      key,
      material: key.replace(/\s+\d+(\.\d+)?$/, ''),
      materialId: mat?.id ?? null,
      thickness,
      grain,
      sheets: open.length,
      parts: list.length,
      area: used / 1e6,
      efficiency: open.length ? used / (open.length * area) : 0,
    });
  }
  return { spec, sheets, groups: summary, oversize };
}
