import { generateComposition, PROFILE } from '../composition';
import type { MaterialId } from '../furniture';
import { framed, wallAt, type Room } from '../room';
import { canonical, type Design, type ShelfOp } from '../studio';

/**
 * Macros de desenho: a conta fica no código, a IA só diz a intenção.
 *
 * `row` monta uma fileira de módulos iguais ao longo da parede: divide o vão
 * em módulos de até `maxModule`, liga com painel compartilhado, encosta o
 * fundo na parede e, com `avoid`, parte a fileira em volta de janela, porta
 * ou coluna que cruzem a faixa de altura dela. É o que a IA barata errava à
 * mão (posição, ids, sobreposição) nos pedidos de cozinha.
 */
export type RowSpec = {
  /** Início no eixo da parede, em mm a partir do canto esquerdo. */
  fromMm: number;
  widthMm: number;
  height: number;
  depth: number;
  /** Altura da base do módulo em relação ao piso (0 no chão, ~1500 aéreo). */
  baseY: number;
  preset: 'niche' | 'shelf' | 'drawers' | 'rack';
  name: string;
  modules?: number;
  maxModule?: number;
  front?: 'single' | 'double' | 'drawers' | 'none';
  drawers?: number;
  materialId?: MaterialId;
  frontMaterialId?: MaterialId;
  feet?: number;
  wall?: boolean;
  /** Parte a fileira em volta dos obstáculos da parede na faixa dela. */
  avoid?: boolean;
  /** Folga de cada lado do obstáculo, em mm. */
  clearance?: number;
  /** Troca o projeto inteiro pela fileira. */
  replace?: boolean;
};

export type RowPlan = {
  ops: ShelfOp[];
  /** Trechos montados, em mm da parede, com os ids dos módulos. */
  segments: { from: number; to: number; ids: string[] }[];
  /** Trechos que ficaram de fora (obstáculo ou largura menor que 200 mm). */
  skipped: { from: number; to: number; why: string }[];
  /** Parede presa no lugar: o ambiente ganha âncora antes da fileira. */
  anchor: { x: number; z: number } | null;
};

const MIN_MODULE = 200;
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 12) || 'mod';

/** Divide o vão em n módulos quase iguais, em mm inteiros. */
export function splitWidths(total: number, n: number) {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - base * (n - 1) : base));
}

/** Tira dos trechos os intervalos dos obstáculos que cruzam a faixa de altura. */
export function freeSpans(from: number, to: number, y0: number, y1: number, room: Room | undefined, clearance: number) {
  let spans = [{ from, to }];
  const skipped: RowPlan['skipped'] = [];
  for (const o of room?.obstacles ?? []) {
    const f = framed(o);
    if (f.y1 <= y0 || f.y0 >= y1) continue;
    const a = f.x0 - clearance,
      b = f.x1 + clearance;
    const next: typeof spans = [];
    for (const s of spans) {
      if (b <= s.from || a >= s.to) {
        next.push(s);
        continue;
      }
      skipped.push({ from: Math.max(a, s.from), to: Math.min(b, s.to), why: o.label ?? o.kind });
      if (a > s.from) next.push({ from: s.from, to: a });
      if (b < s.to) next.push({ from: b, to: s.to });
    }
    spans = next;
  }
  return { spans, skipped };
}

export function planRow(design: Design, room: Room | undefined, spec: RowSpec): RowPlan {
  const bounds = generateComposition(canonical(design)).bounds;
  // Referência da parede: a do ambiente (presa agora, para a fileira nova não
  // arrastar a parede junto) ou o lado esquerdo e o fundo do móvel atual.
  const wall = room ? wallAt(room, bounds) : { x: bounds.min[0], z: bounds.min[2] };
  const anchor = room && !room.anchor ? { x: Math.round(wall.x), z: Math.round(wall.z) } : null;
  const clearance = spec.clearance ?? 50;
  const y0 = spec.baseY,
    y1 = spec.baseY + (spec.feet ?? 0) + spec.height;
  const { spans, skipped } = spec.avoid
    ? freeSpans(spec.fromMm, spec.fromMm + spec.widthMm, y0, y1, room, clearance)
    : { spans: [{ from: spec.fromMm, to: spec.fromMm + spec.widthMm }], skipped: [] };
  const taken = new Set(design.modules.map((m) => m.id));
  const base = slug(spec.name);
  let n = 1;
  const nextId = () => {
    while (taken.has(`${base}-${n}`)) n++;
    const id = `${base}-${n}`;
    taken.add(id);
    return id;
  };
  // Frente cobre o vão inteiro: corpo de prateleiras já vem dividido e não
  // aceita porta na raiz, então vira corpo aberto (nicho) com a frente pedida.
  const preset = spec.front && spec.front !== 'none' && spec.preset !== 'drawers' ? 'niche' : spec.preset;
  const ops: ShelfOp[] = [];
  const segments: RowPlan['segments'] = [];
  const maxModule = Math.min(1200, spec.maxModule ?? 900);
  let label = 1;
  for (const s of spans) {
    const width = Math.round(s.to - s.from);
    if (width < MIN_MODULE) {
      skipped.push({ from: s.from, to: s.to, why: 'vão menor que 20 cm' });
      continue;
    }
    const count = Math.max(1, Math.min(Math.floor(width / MIN_MODULE), spec.modules && spans.length === 1 ? spec.modules : Math.ceil(width / maxModule)));
    // Painel compartilhado: vizinhos dividem uma chapa, então cada junta
    // come uma espessura. A soma leva isso em conta para o trecho fechar exato.
    const widths = splitWidths(width + (count - 1) * PROFILE.panel, count);
    const ids: string[] = [];
    let x = s.from;
    for (const [i, w] of widths.entries()) {
      const id = nextId();
      ids.push(id);
      ops.push({ kind: 'module.add', id, preset, name: `${spec.name} ${label++}` });
      ops.push({
        kind: 'module.edit',
        id,
        width: w,
        height: spec.height,
        depth: spec.depth,
        ...(spec.materialId ? { materialId: spec.materialId } : {}),
        ...(spec.feet !== undefined ? { feet: spec.feet } : {}),
        ...(spec.wall ?? spec.baseY > 0 ? { wall: true } : {}),
        ...(i === 0 ? { position: [wall.x + x + w / 2, spec.baseY, wall.z + spec.depth / 2] as [number, number, number] } : {}),
      });
      if (i > 0) ops.push({ kind: 'connect', parent: ids[i - 1], child: id, side: 'right', shared: true, align: 'back', offset: 0 });
      if (spec.front && spec.front !== 'none')
        ops.push({
          kind: 'front.set',
          id: `${id}:root`,
          type: spec.front,
          ...(spec.front === 'drawers' ? { count: spec.drawers ?? 3 } : {}),
          ...(spec.frontMaterialId ? { materialId: spec.frontMaterialId } : {}),
        });
      x += w;
    }
    segments.push({ from: Math.round(s.from), to: Math.round(s.to), ids });
  }
  if (spec.replace && segments.length) {
    // A sobreposição é conferida a cada operação e o projeto nunca pode ficar
    // sem módulo: solta tudo, tira todos menos um, estaciona esse longe,
    // monta a fileira e só então tira o último.
    const last = design.modules.at(-1)!;
    const clear: ShelfOp[] = [
      ...design.connections.map((c): ShelfOp => ({ kind: 'disconnect', child: c.child })),
      ...design.modules.slice(0, -1).map((m): ShelfOp => ({ kind: 'module.remove', id: m.id })),
      { kind: 'module.edit', id: last.id, position: [-19000, 0, 0] },
    ];
    return { ops: [...clear, ...ops, { kind: 'module.remove', id: last.id }], segments, skipped, anchor };
  }
  return { ops, segments, skipped, anchor };
}
