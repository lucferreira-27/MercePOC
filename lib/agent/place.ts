import { z } from 'zod';
import { PANEL_LIMITS } from '../composition';
import { materialIds, type MaterialId } from '../furniture';
import { TV_CLEARANCE_MM, type Room } from '../room';
import type { Design, ShelfOp } from '../studio';
import { conflictsOf, freeSpans, sceneOf, type Box3, type Scene, type SceneModule } from './scene';
import { defaultInterior, interiorOps, interiorSchema, type Interior } from './interior';

/**
 * Onde a peça vai, como quem desenha fala: ao lado, acima ou abaixo de uma
 * referência (módulo, obstáculo da parede ou peça anterior do mesmo lote),
 * ou num ponto da parede. O app acha a superfície (painel de parede ou a
 * própria parede), a profundidade e confere tudo antes de montar.
 */
export const whereSchema = z
  .object({
    de: z.string().max(100).optional().describe('Referência: id de módulo, de obstáculo (ex. ob-tv, ou "tv", "janela", "porta") ou ref de peça anterior deste lote'),
    lado: z.enum(['esquerda', 'direita', 'acima', 'abaixo']).optional(),
    folga: z.number().min(0).max(3000).optional().describe('mm entre a peça e a referência; padrão 0 para módulo e 50 para TV, janela e porta'),
    alinhar: z
      .enum(['topo', 'base', 'centro', 'piso', 'esquerda', 'direita'])
      .optional()
      .describe('No outro eixo: topo, base, centro ou piso (ao lado); esquerda, direita ou centro (acima e abaixo)'),
    x: z.number().min(-20000).max(20000).optional().describe('Borda esquerda da peça, em mm do canto esquerdo da parede'),
    y: z.number().min(0).max(5000).optional().describe('Base da peça (pés incluídos), em mm do piso'),
  })
  .strict();
export type Where = z.infer<typeof whereSchema>;

export const PIECE_TYPES = ['nicho', 'estante', 'armario', 'gaveteiro', 'painel', 'vao'] as const;
export const pieceSchema = z
  .object({
    ref: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,24}$/, 'ref: letras minúsculas, números e hífen (ex. nicho-esq)')
      .describe('Id do módulo novo; outras peças do lote podem usar como referência'),
    nome: z.string().trim().min(1).max(40),
    tipo: z.enum(PIECE_TYPES),
    largura: z.number().min(10).max(PANEL_LIMITS.long).optional(),
    altura: z.number().min(10).max(PANEL_LIMITS.long).optional(),
    profundidade: z.number().min(10).max(800).optional(),
    pes: z.number().min(0).max(300).optional(),
    material: z.enum(materialIds).optional(),
    interior: interiorSchema.optional(),
    onde: whereSchema,
  })
  .strict();
export type Piece = z.infer<typeof pieceSchema>;

/** Padrões de cada tipo (largura, altura, profundidade), no piso e na parede. */
const DEFAULTS: Record<Piece['tipo'], { floor: [number, number, number]; wall: [number, number, number] }> = {
  nicho: { floor: [400, 400, 300], wall: [400, 400, 250] },
  estante: { floor: [800, 1800, 350], wall: [800, 900, 300] },
  armario: { floor: [800, 850, 550], wall: [700, 700, 350] },
  gaveteiro: { floor: [600, 750, 500], wall: [600, 400, 350] },
  painel: { floor: [1200, 1800, 25], wall: [1200, 1800, 25] },
  vao: { floor: [600, 850, 600], wall: [600, 850, 600] },
};
/** Limites por tipo: caixa, painel de parede, vão reservado. */
function limitsOf(tipo: Piece['tipo']) {
  if (tipo === 'painel') return { w: [200, PANEL_LIMITS.long], h: [200, PANEL_LIMITS.long], d: PANEL_LIMITS.thickness as readonly number[] };
  if (tipo === 'vao') return { w: [100, 5000], h: [100, 2700], d: [100, 1000] };
  return { w: [200, 1200], h: [200, 2400], d: [200, 800] };
}

type Ref = { name: string; box: { x0: number; x1: number; y0: number; y1: number; d0: number; d1: number }; kind: 'module' | 'obstacle'; module?: SceneModule; zone?: Scene['zones'][number]; feet?: number; depth?: number; height?: number };

/** A referência pelo id, pela ref do lote, pelo tipo do obstáculo ("tv", "janela") ou pelo nome. */
export function findRef(scene: Scene, design: Design, key: string, placed: readonly Placed[]): Ref | null {
  const k = key.trim().toLowerCase();
  const p = placed.find((v) => v.ref === key || v.id === key);
  if (p) return { name: p.name, box: p.box, kind: 'module', feet: p.feet, depth: p.box.d1 - p.box.d0, height: p.height };
  const m = scene.modules.find((v) => v.id === key) ?? scene.modules.find((v) => v.name.toLowerCase() === k);
  if (m) {
    const mod = design.modules.find((v) => v.id === m.id)!;
    return { name: m.name, box: m, kind: 'module', module: m, feet: mod.feet ?? 0, depth: mod.kind === 'panel' ? undefined : mod.depth, height: mod.kind === 'panel' ? undefined : mod.height };
  }
  const words: Record<string, string> = { tv: 'tv', televisão: 'tv', televisao: 'tv', janela: 'window', porta: 'door', coluna: 'column', tomada: 'outlet' };
  const z =
    scene.zones.find((v) => v.id === key) ??
    scene.zones.find((v) => v.kind === words[k]) ??
    scene.zones.find((v) => v.label.toLowerCase() === k);
  if (z) {
    // A TV é a tela; porta e janela contam com o batente.
    return { name: z.label, box: { x0: z.x0, x1: z.x1, y0: z.y0, y1: z.y1, d0: 0, d1: z.mount ?? 0 }, kind: 'obstacle', zone: z };
  }
  return null;
}

export type Placed = { ref: string; id: string; name: string; box: Box3; feet: number; height: number; notes: string[]; surface: string; cells: string[][] };

const round = (v: number) => Math.round(v);
const span = (a: number, b: number) => `${round(a)}–${round(b)}`;

/**
 * Onde a peça fica, em coordenadas da parede. Medida dita é exata: se não
 * cabe, volta o conflito com o que cabe. Medida ausente vem do tipo e da
 * referência e encolhe até o espaço livre, com a nota do ajuste.
 */
export function resolvePiece(scene: Scene, design: Design, piece: Piece, placed: readonly Placed[], ignore: ReadonlySet<string> = new Set()) {
  const w = piece.onde;
  const ref = w.de ? findRef(scene, design, w.de, placed) : null;
  if (w.de && !ref)
    return {
      error: `Referência "${w.de}" não existe. Use o id de um módulo (${scene.modules.map((m) => m.id).slice(0, 12).join(', ')}), de um obstáculo (${scene.zones.map((z) => z.id).join(', ') || 'nenhum'}) ou a ref de uma peça anterior do lote.`,
    };
  if (ref && !w.lado) return { error: `Com "de" diga o lado: esquerda, direita, acima ou abaixo de ${ref.name}.` };
  const notes: string[] = [];
  const side = w.lado;
  // Sem medida: ao lado de um módulo copia altura, profundidade e pés dele
  // (a fileira fica alinhada); acima ou abaixo copia a largura da referência.
  const beside = side === 'esquerda' || side === 'direita';
  const stacked = side === 'acima' || side === 'abaixo';
  const hung =
    w.y !== undefined
      ? w.y > 5
      : ref
        ? stacked
          ? side === 'acima' || ref.box.y0 > 5
          : w.alinhar !== 'piso' && ref.box.y0 > 5
        : false;
  const [dw, dh, dd] = DEFAULTS[piece.tipo][hung ? 'wall' : 'floor'];
  const moduleRef = ref?.kind === 'module' && ref.height !== undefined;
  let width = piece.largura ?? (stacked && ref ? Math.min(ref.box.x1 - ref.box.x0, limitsOf(piece.tipo).w[1]) : dw);
  let feet = piece.pes ?? (beside && moduleRef ? (ref!.feet ?? 0) : 0);
  let height = piece.altura ?? (beside && moduleRef ? ref!.height! : dh);
  const depth = piece.profundidade ?? (beside && moduleRef && piece.tipo !== 'painel' ? ref!.depth! : dd);
  const auto = { w: piece.largura === undefined, h: piece.altura === undefined };
  if (piece.tipo === 'painel' || piece.tipo === 'vao') feet = 0;
  const lim = limitsOf(piece.tipo);
  const outOf = (v: number, [a, b]: readonly number[], what: string) => (v < a || v > b ? `${what} de ${round(v)} mm fora do limite de ${piece.tipo} (${a} a ${b} mm)` : null);
  const bad = [
    !auto.w && outOf(width, lim.w, 'Largura'),
    !auto.h && outOf(height, lim.h, 'Altura'),
    piece.profundidade !== undefined && outOf(depth, lim.d, 'Profundidade'),
  ].filter(Boolean);
  if (bad.length) return { error: `${piece.nome}: ${bad.join('; ')}.` };
  width = Math.min(Math.max(width, lim.w[0]), lim.w[1]);
  height = Math.min(Math.max(height, lim.h[0]), lim.h[1]);
  const gap = w.folga ?? (ref?.kind === 'obstacle' ? (ref.zone?.rule === 'tv' ? TV_CLEARANCE_MM + 20 : 50) : 0);
  // Posição pela relação; o eixo livre segue o alinhamento pedido.
  const place = (wd: number, ht: number) => {
    const total = ht + feet;
    let x0: number, y0: number;
    if (ref && beside) {
      x0 = side === 'esquerda' ? ref.box.x0 - gap - wd : ref.box.x1 + gap;
      const align = w.alinhar ?? (ref.kind === 'module' ? 'base' : 'centro');
      y0 =
        w.y ??
        (align === 'piso' ? 0 : align === 'topo' ? ref.box.y1 - total : align === 'centro' ? (ref.box.y0 + ref.box.y1) / 2 - total / 2 : ref.box.y0);
    } else if (ref && stacked) {
      // Abaixo com alinhar "piso": apoia no chão (armário embaixo da janela).
      y0 = w.y ?? (side === 'acima' ? ref.box.y1 + gap : w.alinhar === 'piso' ? 0 : ref.box.y0 - gap - total);
      const align = w.alinhar === 'piso' ? 'centro' : (w.alinhar ?? 'centro');
      x0 = w.x ?? (align === 'esquerda' ? ref.box.x0 : align === 'direita' ? ref.box.x1 - wd : (ref.box.x0 + ref.box.x1) / 2 - wd / 2);
    } else {
      y0 = w.y ?? 0;
      x0 = w.x ?? Number.NaN;
    }
    return { x0, x1: x0 + wd, y0, y1: y0 + total };
  };
  let rect = place(width, height);
  // Sem x nem referência: o primeiro trecho livre da parede que cabe.
  if (Number.isNaN(rect.x0)) {
    const free = freeSpans(scene, rect.y0, rect.y1, 0, depth, ignore, placed.map((p) => ({ ...p.box, name: p.name }))).find(([a, b]) => b - a >= width);
    if (!free) return { error: `${piece.nome}: sem trecho livre de ${round(width)} mm na altura ${span(rect.y0, rect.y1)} mm. Diga x, ou outra altura.` };
    rect = { ...rect, x0: free[0], x1: free[0] + width };
  }
  // Superfície: painel de parede atrás da peça (ela fica presa na frente
  // dele) ou a própria parede. Peça que cobre só parte do painel não fecha.
  const surfaceOf = (r: { x0: number; x1: number; y0: number; y1: number }) => {
    let d0 = 0,
      name = 'parede',
      partial: SceneModule | null = null,
      panel: SceneModule | null = null;
    for (const m of scene.modules) {
      if (m.kind !== 'panel' || ignore.has(m.id)) continue;
      const ox = Math.min(r.x1, m.x1) - Math.max(r.x0, m.x0),
        oy = Math.min(r.y1, m.y1) - Math.max(r.y0, m.y0);
      if (ox <= 0.5 || oy <= 0.5) continue;
      const inside = r.x0 >= m.x0 - 0.5 && r.x1 <= m.x1 + 0.5 && r.y0 >= m.y0 - 0.5 && r.y1 <= m.y1 + 0.5;
      if (!inside) partial = m;
      else if (m.d1 > d0) {
        d0 = m.d1;
        name = m.name;
        panel = m;
      }
    }
    return { d0, name, partial, panel };
  };
  const extra = placed.map((p) => ({ ...p.box, name: p.name }));
  let surface = surfaceOf(rect);
  let box: Box3 = { ...rect, d0: surface.d0, d1: surface.d0 + depth };
  let hits = conflictsOf(scene, box, ignore, extra);
  // Medida livre encolhe até o espaço: a borda do lado da referência fica.
  for (let tries = 0; (hits.length || surface.partial) && tries < 6 && (auto.w || auto.h); tries++) {
    const r = reach(scene, box, ignore, extra, surface.partial ?? surface.panel, depth);
    let wd = width,
      ht = height;
    const align = w.alinhar ?? (beside ? (ref?.kind === 'module' ? 'base' : 'centro') : 'centro');
    if (auto.w) {
      if (side === 'esquerda') wd = Math.min(wd, r.left(rect.x1, rect.y0, rect.y1));
      else if (side === 'direita' || (!beside && !stacked) || align === 'esquerda') wd = Math.min(wd, r.right(rect.x0, rect.y0, rect.y1));
      else if (align === 'direita') wd = Math.min(wd, r.left(rect.x1, rect.y0, rect.y1));
      else {
        const c = (rect.x0 + rect.x1) / 2;
        wd = Math.min(wd, 2 * Math.min(r.left(c, rect.y0, rect.y1), r.right(c, rect.y0, rect.y1)));
      }
    }
    // Largura primeiro: o vizinho do lado deixa de parecer bloqueio em cima.
    wd = Math.floor(wd);
    if (wd !== width && wd >= lim.w[0]) rect = place(wd, height);
    if (auto.h) {
      const up = (y: number) => r.up(y, rect.x0, rect.x1),
        down = (y: number) => r.down(y, rect.x0, rect.x1);
      if (side === 'abaixo' || (beside && align === 'topo')) ht = Math.min(ht, down(rect.y1) - feet);
      else if (beside && align === 'centro') {
        const c = (rect.y0 + rect.y1) / 2;
        ht = Math.min(ht, 2 * Math.min(up(c), down(c)) - feet);
      } else ht = Math.min(ht, up(rect.y0) - feet);
    }
    ht = Math.floor(ht);
    if ((wd === width && ht === height) || wd < lim.w[0] || ht < lim.h[0]) break;
    if (wd !== width) notes.push(`largura ajustada para ${wd} mm (espaço livre)`);
    if (ht !== height) notes.push(`altura ajustada para ${ht} mm (espaço livre)`);
    width = wd;
    height = ht;
    rect = place(width, height);
    surface = surfaceOf(rect);
    box = { ...rect, d0: surface.d0, d1: surface.d0 + depth };
    hits = conflictsOf(scene, box, ignore, extra);
  }
  if (hits.length || surface.partial) {
    const why = [...hits.map((h) => h.why), ...(surface.partial ? [`cobre só parte do painel ${surface.partial.name} (x ${span(surface.partial.x0, surface.partial.x1)}, y ${span(surface.partial.y0, surface.partial.y1)} mm): fica inteira na frente dele ou fora dele`] : [])];
    const free = freeSpans(scene, box.y0, box.y1, box.d0, box.d1, ignore, extra)
      .filter(([a, b]) => b - a >= lim.w[0])
      .map(([a, b]) => `${a}–${b}`);
    // Quanto cabe do lado pedido (e do outro): a IA decide de uma vez.
    let room = '';
    if (ref && (beside || stacked)) {
      const rr = reach(scene, box, ignore, extra, surface.partial ?? surface.panel, depth);
      const edge = side === 'esquerda' ? rr.left(rect.x1, rect.y0, rect.y1) : side === 'direita' ? rr.right(rect.x0, rect.y0, rect.y1) : side === 'acima' ? rr.up(rect.y0, rect.x0, rect.x1) : rr.down(rect.y1, rect.x0, rect.x1);
      room = ` ${side === 'acima' || side === 'abaixo' ? 'Altura' : 'Largura'} livre ${side === 'acima' ? 'acima de' : side === 'abaixo' ? 'abaixo de' : `à ${side} de`} ${ref.name}${surface.partial || surface.panel ? ` (dentro de ${(surface.partial ?? surface.panel)!.name})` : ''}: ${Math.max(0, round(edge))} mm (mínimo ${side === 'acima' || side === 'abaixo' ? lim.h[0] : lim.w[0]} mm).`;
    }
    return {
      error: `${piece.nome} (${round(width)} × ${round(height + feet)} mm, x ${span(box.x0, box.x1)}, y ${span(box.y0, box.y1)}): ${[...new Set(why)].join('; ')}.${room} Livre nessa altura: ${free.join(', ') || 'nenhum trecho'} mm.${auto.w || auto.h ? '' : ' Sem largura ou altura, o app encolhe a peça até o espaço livre.'}`,
    };
  }
  return { box, width, height, depth, feet, notes, surface: surface.name, hung: box.y0 > 5 };
}

/**
 * Quanto espaço livre há a partir de um ponto da peça, para cada lado, na
 * faixa dela: até o primeiro módulo (em 3D), área protegida, borda do painel
 * em que ela está presa, borda da parede, piso ou teto. É o que a peça sem
 * medida pode ocupar.
 */
function reach(scene: Scene, at: Box3, ignore: ReadonlySet<string>, extra: readonly (Box3 & { name: string })[], panel: SceneModule | null, depth: number) {
  const o = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 0.5;
  // Presa num painel (ou cobrindo parte dele): conta na frente dele, e as bordas dele são o limite.
  const box = panel ? { ...at, d0: panel.d1, d1: panel.d1 + depth } : at;
  type R = { x0: number; x1: number; y0: number; y1: number };
  const blocks: R[] = [];
  for (const m of [...scene.modules, ...extra.map((e) => ({ ...e, id: e.name }))])
    if (!ignore.has(m.id) && m.id !== panel?.id && o(box.d0, box.d1, m.d0, m.d1)) blocks.push(m);
  for (const z of scene.zones) {
    if (z.rule === 'free') continue;
    if (z.rule === 'tv') {
      if (box.d1 <= (z.mount ?? 0) + 0.5) continue;
      const c = TV_CLEARANCE_MM;
      blocks.push({ x0: z.x0 - c, x1: z.x1 + c, y0: z.y0 - c, y1: z.y1 + c });
    } else blocks.push(z);
  }
  const W = scene.width ?? Infinity,
    H = scene.height ?? Infinity;
  return {
    left: (x: number, y0: number, y1: number) =>
      x - Math.max(scene.width === null ? -Infinity : 0, panel ? panel.x0 : -Infinity, ...blocks.filter((b) => o(y0, y1, b.y0, b.y1) && b.x1 <= x + 0.5).map((b) => b.x1)),
    right: (x: number, y0: number, y1: number) =>
      Math.min(W, panel ? panel.x1 : Infinity, ...blocks.filter((b) => o(y0, y1, b.y0, b.y1) && b.x0 >= x - 0.5).map((b) => b.x0)) - x,
    up: (y: number, x0: number, x1: number) =>
      Math.min(H, panel ? panel.y1 : Infinity, ...blocks.filter((b) => o(x0, x1, b.x0, b.x1) && b.y0 >= y - 0.5).map((b) => b.y0)) - y,
    down: (y: number, x0: number, x1: number) =>
      y - Math.max(0, panel ? panel.y0 : -Infinity, ...blocks.filter((b) => o(x0, x1, b.x0, b.x1) && b.y1 <= y + 0.5).map((b) => b.y1)),
  };
}

/** Id livre: a ref pedida, ou com sufixo se já existe. */
function freeId(design: Design, placed: readonly Placed[], ref: string) {
  const taken = new Set([...design.modules.map((m) => m.id), ...placed.map((p) => p.id)]);
  if (!taken.has(ref)) return ref;
  for (let i = 2; ; i++) if (!taken.has(`${ref}-${i}`)) return `${ref}-${i}`;
}

/**
 * Peças novas → operações do contrato, em ordem, com a parede presa. Volta
 * o erro da primeira peça que não fecha (nada é montado pela metade).
 */
export function planPieces(design: Design, room: Room | undefined, pieces: readonly Piece[]) {
  const scene = sceneOf(design, room);
  const placed: Placed[] = [];
  const ops: ShelfOp[] = [];
  const reserved: { label: string; x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const piece of pieces) {
    const r = resolvePiece(scene, design, piece, placed);
    if ('error' in r) return { error: r.error as string, placed };
    if (piece.tipo === 'vao') {
      // Vão reservado (máquina, geladeira): vira área protegida da parede,
      // e as peças seguintes (e as futuras) não entram nele.
      reserved.push({ label: piece.nome, x0: r.box.x0, x1: r.box.x1, y0: r.box.y0, y1: r.box.y1 });
      scene.zones.push({ id: piece.ref, kind: 'other', label: piece.nome, x0: r.box.x0, x1: r.box.x1, y0: r.box.y0, y1: r.box.y1, rule: 'block' });
      placed.push({ ref: piece.ref, id: piece.ref, name: piece.nome, box: { ...r.box, d0: 0, d1: 0 }, feet: 0, height: r.height, notes: r.notes, surface: 'piso', cells: [] });
      continue;
    }
    const id = freeId(design, placed, piece.ref);
    const wx = scene.origin.x + r.box.x0 + r.width / 2;
    const wz = scene.origin.z + r.box.d0 + r.depth / 2;
    // Apoia em outro módulo (sem folga, logo acima de um módulo de piso) não é suspenso.
    const resting = scene.modules.some(
      (m) => m.kind === 'box' && Math.abs(m.y1 - r.box.y0) < 1 && Math.min(m.x1, r.box.x1) - Math.max(m.x0, r.box.x0) > 0.5 && Math.min(m.d1, r.box.d1) - Math.max(m.d0, r.box.d0) > 0.5,
    );
    ops.push({ kind: 'module.add', id, preset: piece.tipo === 'painel' ? 'panel' : 'niche', name: piece.nome });
    ops.push({
      kind: 'module.edit',
      id,
      width: r.width,
      height: r.height,
      depth: r.depth,
      ...(piece.material ? { materialId: piece.material as MaterialId } : {}),
      ...(r.feet ? { feet: r.feet } : {}),
      ...(r.hung && !resting && piece.tipo !== 'painel' ? { wall: true } : {}),
      position: [wx, r.box.y0, wz],
    });
    let cells: string[][] = [];
    if (piece.tipo !== 'painel') {
      const spec: Interior = piece.interior ?? defaultInterior(piece.tipo as 'nicho', r.height);
      const inside = interiorOps(id, { width: r.width, height: r.height }, spec);
      if ('error' in inside) return { error: `${piece.nome}: ${inside.error}`, placed };
      ops.push(...inside.ops);
      cells = inside.cells;
    }
    placed.push({ ref: piece.ref, id, name: piece.nome, box: r.box, feet: r.feet, height: r.height, notes: r.notes, surface: r.surface, cells });
  }
  return { ops, placed, scene, reserved };
}

/** Uma linha por peça montada, com as medidas do app: vai para a IA e para o registro. */
export function placedLine(p: Placed) {
  const b = p.box;
  if (p.surface === 'piso' && !p.cells.length && b.d1 === 0)
    return `${p.name}: vão reservado de ${round(b.x1 - b.x0)} × ${round(b.y1 - b.y0)} mm em x ${span(b.x0, b.x1)} (nada entra nele)`;
  const cells = p.cells.length ? `; vãos (de baixo para cima): ${p.cells.map((r) => r.join(' ')).join(' | ')}` : '';
  return `${p.name} (id ${p.id}): ${round(b.x1 - b.x0)} × ${round(b.y1 - b.y0)} × ${round(b.d1 - b.d0)} mm, x ${span(b.x0, b.x1)}, y ${span(b.y0, b.y1)}, ${b.y0 <= 5 ? 'no piso' : p.surface === 'parede' ? 'preso na parede' : `preso no ${p.surface}`}${p.notes.length ? ` (${p.notes.join('; ')})` : ''}${cells}`;
}
