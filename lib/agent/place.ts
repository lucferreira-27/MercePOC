import { z } from 'zod';
import { isFlat, LEDGE_LIMITS, PANEL_LIMITS } from '../composition';
import { materialIds, type MaterialId } from '../furniture';
import { TV_CLEARANCE_MM, type Room } from '../room';
import type { Design, ShelfOp } from '../studio';
import { conflictsOf, freeSpans, sceneOf, type Box3, type Scene, type SceneModule } from './scene';
import { defaultInterior, interiorOps, interiorSchema, type Interior } from './interior';
import { splitWidths } from './macros';
import { PROFILE } from '../composition';

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
    x: z.number().min(-20000).max(20000).optional().describe('Só sem de: borda esquerda da peça, em mm do canto esquerdo da parede'),
    y: z.number().min(0).max(5000).optional().describe('Base da peça (pés incluídos), em mm do piso; com de, só vale acima de 0 (piso: alinhar piso)'),
  })
  .strict();
export type Where = z.infer<typeof whereSchema>;

export const PIECE_TYPES = ['nicho', 'estante', 'armario', 'gaveteiro', 'painel', 'prateleira', 'vao'] as const;
export const pieceSchema = z
  .object({
    ref: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,24}$/, 'ref: letras minúsculas, números e hífen (ex. nicho-esq)')
      .describe('Id do módulo novo; outras peças do lote podem usar como referência'),
    nome: z
      .string()
      .transform((s) => Array.from(s, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? '' : ch)).join('').trim())
      .pipe(z.string().min(1).max(40)),
    tipo: z
      .enum(PIECE_TYPES)
      .describe('nicho (caixa aberta), estante (caixa com prateleiras), armario (prateleiras atrás de porta), gaveteiro, painel (chapa de parede), prateleira (tábua horizontal presa na parede ou no painel; altura é a espessura), vao (espaço livre reservado)'),
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
  prateleira: { floor: [800, 25, 250], wall: [800, 25, 250] },
  vao: { floor: [600, 850, 600], wall: [600, 850, 600] },
};
/** Limites por tipo: caixa, painel de parede, vão reservado. */
function limitsOf(tipo: Piece['tipo']) {
  if (tipo === 'painel') return { w: [200, PANEL_LIMITS.long], h: [200, PANEL_LIMITS.long], d: PANEL_LIMITS.thickness as readonly number[] };
  if (tipo === 'vao') return { w: [100, 5000], h: [100, 2700], d: [100, 1000] };
  if (tipo === 'prateleira') return { w: [200, LEDGE_LIMITS.long], h: LEDGE_LIMITS.thickness as readonly number[], d: LEDGE_LIMITS.depth as readonly number[] };
  // Caixa mais larga que 1200 mm vira fileira de módulos com painel compartilhado.
  return { w: [200, 4 * 1200], h: [200, 2400], d: [200, 800] };
}
/** Maior largura de um módulo; acima disso a peça vira fileira. */
const MODULE_MAX = 1200;

type Ref = { name: string; box: { x0: number; x1: number; y0: number; y1: number; d0: number; d1: number }; kind: 'module' | 'obstacle'; module?: SceneModule; zone?: Scene['zones'][number]; feet?: number; depth?: number; height?: number };

/** A referência pelo id, pela ref do lote, pelo tipo do obstáculo ("tv", "janela") ou pelo nome. */
export function findRef(scene: Scene, design: Design, key: string, placed: readonly Placed[]): Ref | null {
  const k = key.trim().toLowerCase();
  const p = placed.find((v) => v.ref === key || v.id === key);
  if (p) return { name: p.name, box: p.box, kind: 'module', feet: p.feet, depth: p.box.d1 - p.box.d0, height: p.height };
  const m = scene.modules.find((v) => v.id === key) ?? scene.modules.find((v) => v.name.toLowerCase() === k);
  if (m) {
    const mod = design.modules.find((v) => v.id === m.id)!;
    return { name: m.name, box: m, kind: 'module', module: m, feet: mod.feet ?? 0, depth: isFlat(mod) ? undefined : mod.depth, height: isFlat(mod) ? undefined : mod.height };
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

export type Placed = { ref: string; id: string; ids?: string[]; name: string; box: Box3; feet: number; height: number; notes: string[]; surface: string; cells: string[][]; material?: MaterialId; shelf?: boolean };

const round = (v: number) => Math.round(v);
const span = (a: number, b: number) => `${round(a)}–${round(b)}`;

/**
 * Onde a peça fica, em coordenadas da parede. Medida dita é exata: se não
 * cabe, volta o conflito com o que cabe. Medida ausente vem do tipo e da
 * referência e encolhe até o espaço livre, com a nota do ajuste.
 */
export function resolvePiece(scene: Scene, design: Design, piece: Piece, placed: readonly Placed[], ignore: ReadonlySet<string> = new Set()) {
  // A IA costuma preencher todo campo opcional com zero: com uma referência,
  // x não vale e y 0 é "não dito" (o piso é alinhar piso). Sem isto, "abaixo
  // da TV" com x 0 e y 0 ia para o canto do piso.
  const w = piece.onde.de ? { ...piece.onde, x: undefined, y: piece.onde.y ? piece.onde.y : undefined } : piece.onde;
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
  // Pé ou rodízio baixo (30, 40 mm) vira o mínimo do contrato, com aviso:
  // recusar custava uma etapa inteira para a IA refazer a peça.
  if (feet > 0 && feet < 50) {
    notes.push(`pés de ${Math.round(feet)} mm viraram 50 mm, o mínimo`);
    feet = 50;
  }
  // Altura do vizinho só para móvel alto (armário, estante) ou fileira de
  // aéreos: um gaveteiro ao lado de um vassoureiro de 2,2 m ficava com 2,2 m.
  const flat = piece.tipo === 'painel' || piece.tipo === 'prateleira';
  const copyHeight = beside && moduleRef && !flat && (piece.tipo === 'armario' || piece.tipo === 'estante' || ref!.box.y0 > 5);
  let height = piece.altura ?? (copyHeight ? ref!.height! : dh);
  const depth = piece.profundidade ?? (beside && moduleRef && !flat ? ref!.depth! : dd);
  const auto = { w: piece.largura === undefined, h: piece.altura === undefined };
  if (flat || piece.tipo === 'vao') feet = 0;
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
      // No piso, a peça fica em pé na frente do painel mesmo passando da borda
      // dele; presa, pela metade do painel não fecha.
      const standing = r.y0 <= 5;
      if (!inside && !standing) partial = m;
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
  let hits = conflictsOf(scene, box, ignore, extra, piece.tipo === 'painel');
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
    hits = conflictsOf(scene, box, ignore, extra, piece.tipo === 'painel');
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
      error: `${piece.nome} (${round(width)} × ${round(height + feet)} mm, x ${span(box.x0, box.x1)}, y ${span(box.y0, box.y1)}): ${[...new Set(why)].join('; ')}.${room} ${free.length ? `Livre nessa altura: ${free.join(', ')} mm.` : 'Nenhum trecho livre nessa altura.'}${auto.w || auto.h ? '' : ' Sem largura ou altura, o app encolhe a peça até o espaço livre.'}`,
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

/**
 * A ligação que a peça ganha com a referência, quando encosta nela como o
 * motor liga: ao lado, no mesmo piso e com fundo ou frente alinhados; ou em
 * cima, centrada e alinhada. Sem giro, sem painel nem prateleira de parede.
 */
function linkFor(
  design: Design,
  scene: Scene,
  placed: readonly Placed[],
  piece: Piece,
  box: Box3,
  ids: readonly string[],
  self: { material?: MaterialId; feet: number } = { feet: 0 },
) {
  const key = piece.onde.de;
  const side = piece.onde.lado;
  if (!key || !side || side === 'abaixo') return null;
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  const mod = design.modules.find((m) => m.id === key);
  const prev = placed.find((v) => v.ref === key || v.id === key);
  let parent: string | undefined, name: string, ref: Box3;
  if (mod) {
    if (mod.kind || mod.rotation) return null;
    const s = scene.modules.find((m) => m.id === mod.id);
    if (!s) return null;
    parent = mod.id;
    name = mod.name;
    ref = s;
  } else if (prev && !prev.shelf && prev.ids?.length && prev.box.d1 > 0) {
    // Peça do mesmo lote: a da ponta que encosta nesta.
    parent = side === 'esquerda' ? prev.ids[0] : prev.ids[prev.ids.length - 1];
    if (side === 'acima' && prev.ids.length > 1) return null;
    name = prev.name;
    ref = prev.box;
  } else return null;
  // Uma fileira nova à esquerda: a ponta direita dela já é filha na fileira.
  if (side === 'esquerda' && ids.length > 1) return null;
  const child = side === 'esquerda' ? ids[ids.length - 1] : ids[0];
  const align = near(box.d0, ref.d0) ? ('back' as const) : near(box.d1, ref.d1) ? ('front' as const) : null;
  if (!align) return null;
  if (side === 'direita' || side === 'esquerda') {
    const touching = side === 'direita' ? near(box.x0, ref.x1) : near(box.x1, ref.x0);
    if (!touching || !near(box.y0, ref.y0)) return null;
    // Corpos do mesmo móvel (peças do mesmo lote) com a mesma altura,
    // profundidade, pés e acabamento dividem a lateral, como na fileira do
    // row_build e na regra do contrato: um painel só entre eles. Módulo que já
    // existia fica com a lateral dele.
    const shared =
      !mod &&
      !!prev &&
      near(box.y1, ref.y1) &&
      near(box.d1 - box.d0, ref.d1 - ref.d0) &&
      prev.feet === self.feet &&
      prev.material === self.material;
    return { parent, child, side: side === 'direita' ? ('right' as const) : ('left' as const), align, name, shared };
  }
  const centered = near((box.x0 + box.x1) / 2, (ref.x0 + ref.x1) / 2);
  if (!near(box.y0, ref.y1) || !centered || ids.length > 1) return null;
  return { parent, child, side: 'top' as const, align, name, shared: false };
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
export function planPieces(design: Design, room: Room | undefined, pieces: readonly Piece[], replace = false) {
  const scene = sceneOf(design, room);
  // Troca do móvel inteiro: o que existe sai, então não conta como obstáculo
  // nem como referência. A parede fica onde estava.
  if (replace) scene.modules = [];
  const placed: Placed[] = [];
  const ops: ShelfOp[] = [];
  const reserved: { ref: string; label: string; x0: number; x1: number; y0: number; y1: number }[] = [];
  // Acabamento sem pedido: o do vizinho de referência, senão o que mais
  // aparece no projeto. Carvalho de fábrica ao lado de móvel branco abria
  // três grupos de chapa a mais.
  const count = new Map<string, number>();
  for (const m of design.modules) if (!isFlat(m)) count.set(m.materialId, (count.get(m.materialId) ?? 0) + 1);
  const common = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] as MaterialId | undefined;
  const finishOf = (piece: Piece): MaterialId | undefined => {
    if (piece.material) return piece.material as MaterialId;
    const ref = piece.onde.de ? design.modules.find((m) => m.id === piece.onde.de) : undefined;
    const prev = piece.onde.de ? placed.find((v) => v.ref === piece.onde.de) : undefined;
    return (ref && !isFlat(ref) ? ref.materialId : prev?.material) ?? common;
  };
  for (const piece of pieces) {
    const r = resolvePiece(scene, design, piece, placed);
    if ('error' in r) return { error: r.error as string, placed };
    if (piece.tipo === 'vao') {
      // Vão reservado (máquina, geladeira): vira área protegida da parede,
      // e as peças seguintes (e as futuras) não entram nele.
      reserved.push({ ref: piece.ref, label: piece.nome, x0: r.box.x0, x1: r.box.x1, y0: r.box.y0, y1: r.box.y1 });
      scene.zones.push({ id: piece.ref, kind: 'other', label: piece.nome, x0: r.box.x0, x1: r.box.x1, y0: r.box.y0, y1: r.box.y1, rule: 'block' });
      placed.push({ ref: piece.ref, id: piece.ref, name: piece.nome, box: { ...r.box, d0: 0, d1: 0 }, feet: 0, height: r.height, notes: r.notes, surface: 'piso', cells: [] });
      continue;
    }
    const id = freeId(design, placed, piece.ref);
    // Larga demais para um módulo: fileira de módulos iguais, com painel
    // compartilhado, do mesmo tamanho total (cada junta economiza 18 mm).
    const flatPiece = piece.tipo === 'painel' || piece.tipo === 'prateleira';
    const count = flatPiece ? 1 : Math.ceil((r.width + PROFILE.panel) / MODULE_MAX - 1e-9);
    let widths = count > 1 ? splitWidths(r.width + (count - 1) * PROFILE.panel, count) : [r.width];
    // Colunas de uma peça que vira fileira são do conjunto, não de cada
    // módulo: 3 nichos em 1,4 m viravam 6 (3 por módulo). Divide as colunas
    // (3 em 2 módulos = 2 + 1) e as larguras na mesma proporção, para os vãos
    // saírem iguais.
    const spec0 = piece.interior;
    const total = spec0 ? (spec0.linhas ? Math.max(1, ...spec0.linhas.map((v) => v.colunas ?? 1)) : (spec0.colunas ?? 1)) : 1;
    let share: number[] | null = null;
    if (!flatPiece && count > 1 && total >= count) {
      const cols = Array.from({ length: count }, (_, i) => Math.floor(total / count) + (i < total % count ? 1 : 0));
      const sum = r.width + (count - 1) * PROFILE.panel;
      const byCols = cols.map((c) => Math.round((sum * c) / total));
      byCols[count - 1] += sum - byCols.reduce((a, v) => a + v, 0);
      if (byCols.every((v) => v <= MODULE_MAX && v >= 200)) {
        share = cols;
        widths = byCols;
      }
    }
    const specFor = (i: number): Interior | undefined => {
      if (!share || !spec0) return spec0;
      if (spec0.linhas) return { ...spec0, linhas: spec0.linhas.map((v) => ((v.colunas ?? 1) === total ? { ...v, colunas: share![i] } : v)) };
      return { ...spec0, colunas: share[i] };
    };
    const wx = scene.origin.x + r.box.x0 + widths[0] / 2;
    const wz = scene.origin.z + r.box.d0 + r.depth / 2;
    const ids: string[] = [];
    let cells: string[][] = [];
    const fronts = { doors: 0, drawers: 0, open: 0 };
    for (const [i, width] of widths.entries()) {
      const mid = i === 0 ? id : freeId(design, placed, `${id}-${i + 1}`);
      ids.push(mid);
      ops.push({
        kind: 'module.add',
        id: mid,
        preset: piece.tipo === 'painel' ? 'panel' : piece.tipo === 'prateleira' ? 'ledge' : 'niche',
        name: count > 1 ? `${piece.nome} ${i + 1}` : piece.nome,
      });
      ops.push({
        kind: 'module.edit',
        id: mid,
        width,
        height: r.height,
        depth: r.depth,
        ...(finishOf(piece) ? { materialId: finishOf(piece) } : {}),
        ...(r.feet ? { feet: r.feet } : {}),
        // Fora do piso é preso na parede, mesmo apoiado em outro módulo:
        // estante em cima de balcão também leva fixação contra tombar.
        ...(r.hung && !flatPiece ? { wall: true } : {}),
        ...(i === 0 ? { position: [wx, r.box.y0, wz] as [number, number, number] } : {}),
      });
      if (i > 0) ops.push({ kind: 'connect', parent: ids[i - 1], child: mid, side: 'right', shared: true, align: 'back', offset: 0 });
      if (!flatPiece) {
        const spec: Interior = specFor(i) ?? defaultInterior(piece.tipo as 'nicho', r.height);
        const inside = interiorOps(mid, { width, height: r.height }, spec);
        if ('error' in inside) return { error: `${piece.nome}: ${inside.error}`, placed };
        ops.push(...inside.ops);
        fronts.doors += inside.fronts.doors;
        fronts.drawers += inside.fronts.drawers;
        fronts.open += inside.fronts.open;
        cells = i === 0 ? inside.cells : cells.map((row, k) => [...row, ...(inside.cells[k] ?? [])]);
        if (i === 0) r.notes.push(...inside.notes);
      }
    }
    if (!flatPiece) r.notes.push(`frente: ${fronts.doors} folhas de porta, ${fronts.drawers} gavetas, ${fronts.open} vãos abertos`);
    if (count > 1) r.notes.push(`${count} módulos de ${widths.join(' + ')} mm com painel compartilhado (${ids.join(', ')})${share ? `; as ${total} colunas ficam ${share.join(' + ')}` : ''}`);
    // Encostada num módulo (ao lado no mesmo piso, ou centrada em cima), a
    // peça fica ligada a ele: anda junto no arrasto e no mover. "À direita
    // deste módulo" sempre quis dizer isso no estúdio.
    const link = !flatPiece ? linkFor(design, scene, placed, piece, r.box, ids, { material: finishOf(piece), feet: r.feet }) : null;
    if (link) {
      ops.push({ kind: 'connect', parent: link.parent, child: link.child, side: link.side, shared: link.shared, align: link.align, offset: 0 });
      r.notes.push(link.shared ? `ligado a ${link.name} com a lateral dividida (um painel só entre os dois)` : `ligado a ${link.name} (anda junto)`);
    }
    placed.push({ ref: piece.ref, id, ids, name: piece.nome, box: r.box, feet: r.feet, height: r.height, notes: r.notes, surface: r.surface, cells, material: finishOf(piece), ...(piece.tipo === 'prateleira' ? { shelf: true } : {}) });
    if (piece.tipo === 'painel') {
      // O painel deste lote já é superfície para as peças seguintes (o rack
      // na frente dele fica preso nele, em vez de "bater" no painel) e é onde
      // a TV se prende quando passa pelo centro da tela, como no encaixe final.
      const b = r.box;
      scene.modules.push({ id, name: piece.nome, kind: 'panel', floor: b.y0 <= 5, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, d0: b.d0, d1: b.d1 });
      for (const z of scene.zones) {
        const cx = (z.x0 + z.x1) / 2,
          cy = (z.y0 + z.y1) / 2;
        if (z.rule === 'tv' && b.x0 <= cx && b.x1 >= cx && b.y0 <= cy && b.y1 >= cy) z.mount = Math.max(z.mount ?? 0, b.d1);
      }
    }
  }
  if (replace && ops.length && design.modules.length) {
    // Como a fileira do row_build: o projeto nunca fica sem módulo e a
    // sobreposição é conferida a cada operação. Solta tudo, tira todos menos
    // um, estaciona esse longe, monta as peças e só então tira o último.
    const last = design.modules.at(-1)!;
    const clear: ShelfOp[] = [
      ...design.connections.map((c): ShelfOp => ({ kind: 'disconnect', child: c.child })),
      ...design.modules.slice(0, -1).map((m): ShelfOp => ({ kind: 'module.remove', id: m.id })),
      { kind: 'module.edit', id: last.id, position: [-19000, 0, 0] },
    ];
    return { ops: [...clear, ...ops, { kind: 'module.remove', id: last.id } as ShelfOp], placed, scene, reserved };
  }
  return { ops, placed, scene, reserved };
}

/** Uma linha por peça montada, com as medidas do app: vai para a IA e para o registro. */
export function placedLine(p: Placed) {
  const b = p.box;
  if (p.surface === 'piso' && !p.cells.length && b.d1 === 0)
    return `${p.name}: vão reservado de ${round(b.x1 - b.x0)} × ${round(b.y1 - b.y0)} mm em x ${span(b.x0, b.x1)} (nada entra nele)`;
  const cells = p.cells.length ? `; vãos (de baixo para cima): ${p.cells.map((r) => r.join(' ')).join(' | ')}` : '';
  return `${p.name} (id ${p.id}): ${round(b.x1 - b.x0)} × ${round(b.y1 - b.y0)} × ${round(b.d1 - b.d0)} mm${p.shelf ? ' (prateleira de parede: largura × espessura × profundidade)' : ''}, x ${span(b.x0, b.x1)}, y ${span(b.y0, b.y1)}, ${b.y0 <= 5 ? 'no piso' : p.surface === 'parede' ? 'preso na parede' : `preso no ${p.surface}`}${p.notes.length ? ` (${p.notes.join('; ')})` : ''}${cells}`;
}
