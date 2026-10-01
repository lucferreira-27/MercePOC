import { z } from 'zod';
import {
  generateComposition,
  type Composition,
  type ModularPart,
} from './composition';

/**
 * Ambiente (quarto ou parede) onde o móvel vai ficar.
 *
 * São dados do lugar, não do móvel: por isso moram no projeto, fora das
 * revisões, e sobrevivem a desfazer e refazer. Medidas em milímetros, com x a
 * partir da esquerda da parede e y do piso. O encaixe é conferido com a
 * composição encostada ao canto esquerdo da parede, sem afastamento.
 */
export type Room = {
  schemaVersion: 1;
  widthMm: number;
  heightMm: number;
  depthMm?: number;
  baseboardMm?: number;
  /**
   * Onde o móvel começa na parede: distância do canto esquerdo da parede ao
   * lado esquerdo da composição. Ausente, o móvel encosta no canto.
   */
  offsetMm?: number;
  /**
   * Parede presa no mundo: x do canto esquerdo e z da face da parede, em mm.
   * Existe depois que o móvel é arrastado: aí a parede fica parada e o
   * afastamento do canto (e da parede) sai do lugar do móvel. Ausente, a
   * parede acompanha o móvel, encostada atrás dele a `offsetMm` do canto.
   */
  anchor?: { x: number; z: number };
  obstacles?: Obstacle[];
  /** Paredes além da do fundo: laterais, divisórias e muretas, no piso. */
  walls?: Wall[];
};

/**
 * Parede a mais no ambiente: a lateral que fecha um canto, uma divisória ou
 * uma mureta. É um elemento próprio, não um obstáculo: fica no piso, em
 * planta, e não na face da parede do fundo. Medidas em mm, com x a partir do
 * canto esquerdo da parede do fundo e z a partir da face dela, para dentro do
 * ambiente. (xMm, zMm) é o canto de trás à esquerda da base.
 */
export type Wall = {
  id: string;
  label?: string;
  xMm: number;
  zMm: number;
  /** Comprimento: a largura de quem olha de frente para a parede. */
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  /** 0: corre ao longo da parede do fundo; 90: sai dela para a frente. */
  rotation: 0 | 90;
};

type Extent = { min: readonly number[]; max: readonly number[] };
/** Onde está a parede no mundo: presa, ou encostada atrás do móvel. */
export function wallAt(room: Room, bounds: Extent) {
  return room.anchor ?? { x: bounds.min[0] - (room.offsetMm ?? 0), z: bounds.min[2] };
}
/** Distância do canto esquerdo da parede ao lado esquerdo do móvel. */
export function roomOffset(room: Room, bounds: Extent) {
  return Math.round(bounds.min[0] - wallAt(room, bounds).x);
}
/** Folga entre a parede e o fundo do móvel (negativa: atravessa a parede). */
export function wallGap(room: Room, bounds: Extent) {
  return Math.round(bounds.min[2] - wallAt(room, bounds).z);
}

export type ObstacleKind = 'door' | 'window' | 'outlet' | 'column' | 'tv' | 'other';

export type Obstacle = {
  id: string;
  kind: ObstacleKind;
  label?: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  /** Giro da folha da porta: não entra no veredito, vira nota de conferência. */
  swingMm?: number;
};

export type FitCode =
  | 'too-wide'
  | 'too-tall'
  | 'too-deep'
  | 'floor-gap'
  | 'obstacle-overlap'
  | 'wall-overlap'
  | 'tv-blocked';

export type FitIssue = {
  code: FitCode;
  message: string;
  detail?: string;
  /**
   * Quem causa o problema (código, obstáculo e módulo): a conferência do
   * pedido compara por aqui. Pelo código só, uma TV já tapada escondia outro
   * módulo novo tapando a mesma TV.
   */
  key?: string;
};

export type FitReport = {
  fits: boolean;
  issues: FitIssue[];
  notes: string[];
  /** Ids dos obstáculos que cruzam algum módulo: a lista do painel marca. */
  crossed?: string[];
  /** Ids das paredes que cruzam algum módulo. */
  crossedWalls?: string[];
};

/**
 * Limites do ambiente, em milímetros. São os mesmos no schema do servidor e no
 * formulário do painel: um só número muda nos dois lugares.
 */
export const ROOM_LIMITS = {
  width: [200, 20000],
  height: [200, 20000],
  depth: [200, 20000],
  baseboard: [0, 500],
  offset: [0, 20000],
  obstacleX: [-20000, 20000],
  obstacleY: [0, 20000],
  obstacleSize: [10, 20000],
  obstacleSwing: [0, 5000],
  obstacles: 32,
  wallX: [-20000, 20000],
  wallZ: [0, 20000],
  wallLength: [100, 20000],
  wallHeight: [100, 20000],
  wallThickness: [50, 1000],
  walls: 16,
} as const;

/**
 * Folga em volta da tela da TV: nada que avance para a frente do plano dela
 * chega mais perto que isto. Painel atrás da TV não conta (é onde ela vai).
 */
export const TV_CLEARANCE_MM = 30;

/** Retângulo na parede, no mundo: x ao longo dela, y do piso. */
export type WallRect = { x0: number; x1: number; y0: number; y1: number };
/** Caixa no mundo (x, y, z), como as das peças e dos módulos. */
export type WorldBox = { min: readonly number[]; max: readonly number[] };

/**
 * Onde a TV encosta: a frente do painel de parede que tem o centro da tela
 * (painel de TV, ripado atrás dela) ou a própria parede. É o mesmo plano
 * para o veredito, para a cena 3D e para o desenho que a IA confere.
 */
export function tvMountZ(tv: WallRect, panels: readonly WorldBox[], wallZ: number) {
  const cx = (tv.x0 + tv.x1) / 2,
    cy = (tv.y0 + tv.y1) / 2;
  let z = wallZ;
  for (const p of panels)
    if (p.min[0] <= cx && p.max[0] >= cx && p.min[1] <= cy && p.max[1] >= cy) z = Math.max(z, p.max[2]);
  return z;
}

/**
 * A caixa tapa a TV: cruza a tela (com a folga em volta) e avança além do
 * plano onde ela encosta. O painel que segura a TV termina nesse plano e
 * nunca tapa; um nicho, uma prateleira ou outro painel na frente, sim.
 */
export function blocksTv(tv: WallRect, mountZ: number, box: WorldBox, clearance = TV_CLEARANCE_MM) {
  return (
    Math.min(box.max[0], tv.x1 + clearance) - Math.max(box.min[0], tv.x0 - clearance) > 0.5 &&
    Math.min(box.max[1], tv.y1 + clearance) - Math.max(box.min[1], tv.y0 - clearance) > 0.5 &&
    box.max[2] > mountZ + 0.5
  );
}

/** TVs da parede no mundo: a tela e o plano onde encostam. */
export function tvPlacements(design: Composition, room: Room, g = generateComposition(design)) {
  const wall = wallAt(room, g.bounds);
  const panels = g.parts.filter((p) => p.kind === 'panel').map(worldBox);
  return (room.obstacles ?? [])
    .filter((o) => o.kind === 'tv')
    .map((o) => {
      const rect: WallRect = { x0: wall.x + o.xMm, x1: wall.x + o.xMm + o.widthMm, y0: o.yMm, y1: o.yMm + o.heightMm };
      return { obstacle: o, rect, mountZ: tvMountZ(rect, panels, wall.z) };
    });
}

/** Caixa de mundo de uma peça (x, y, z), girada em passos de 90°. */
function worldBox(part: ModularPart): WorldBox {
  const turned = Math.round((part.rotation * 180) / Math.PI) % 180 !== 0;
  const w = turned ? part.size[2] : part.size[0];
  const d = turned ? part.size[0] : part.size[2];
  return {
    min: [part.position[0] - w / 2, part.position[1] - part.size[1] / 2, part.position[2] - d / 2],
    max: [part.position[0] + w / 2, part.position[1] + part.size[1] / 2, part.position[2] + d / 2],
  };
}

/** Tolerância de encaixe: abaixo disto a face encosta, não cruza. */
const TOUCH = 1e-6;
/** Abaixo disto a peça está no piso; acima, o móvel flutua. */
const ON_FLOOR = 5;

export const obstacleSchema: z.ZodType<Obstacle> = z
  .object({
    id: z.string().trim().min(1).max(100),
    kind: z.enum(['door', 'window', 'outlet', 'column', 'tv', 'other']),
    label: z.string().trim().min(1).max(80).optional(),
    xMm: z
      .number()
      .min(ROOM_LIMITS.obstacleX[0])
      .max(ROOM_LIMITS.obstacleX[1]),
    yMm: z
      .number()
      .min(ROOM_LIMITS.obstacleY[0])
      .max(ROOM_LIMITS.obstacleY[1]),
    widthMm: z
      .number()
      .min(ROOM_LIMITS.obstacleSize[0])
      .max(ROOM_LIMITS.obstacleSize[1]),
    heightMm: z
      .number()
      .min(ROOM_LIMITS.obstacleSize[0])
      .max(ROOM_LIMITS.obstacleSize[1]),
    swingMm: z
      .number()
      .min(ROOM_LIMITS.obstacleSwing[0])
      .max(ROOM_LIMITS.obstacleSwing[1])
      .optional(),
  })
  .strict();

const between = (limit: readonly [number, number]) => z.number().min(limit[0]).max(limit[1]);
export const wallSchema: z.ZodType<Wall> = z
  .object({
    id: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(80).optional(),
    xMm: between(ROOM_LIMITS.wallX),
    zMm: between(ROOM_LIMITS.wallZ),
    widthMm: between(ROOM_LIMITS.wallLength),
    heightMm: between(ROOM_LIMITS.wallHeight),
    thicknessMm: between(ROOM_LIMITS.wallThickness),
    rotation: z.union([z.literal(0), z.literal(90)]),
  })
  .strict();

export const roomSchema: z.ZodType<Room> = z
  .object({
    schemaVersion: z.literal(1),
    widthMm: z.number().min(ROOM_LIMITS.width[0]).max(ROOM_LIMITS.width[1]),
    heightMm: z.number().min(ROOM_LIMITS.height[0]).max(ROOM_LIMITS.height[1]),
    depthMm: z
      .number()
      .min(ROOM_LIMITS.depth[0])
      .max(ROOM_LIMITS.depth[1])
      .optional(),
    baseboardMm: z
      .number()
      .min(ROOM_LIMITS.baseboard[0])
      .max(ROOM_LIMITS.baseboard[1])
      .optional(),
    offsetMm: z
      .number()
      .min(ROOM_LIMITS.offset[0])
      .max(ROOM_LIMITS.offset[1])
      .optional(),
    anchor: z
      .object({ x: z.number().min(-40000).max(40000), z: z.number().min(-40000).max(40000) })
      .strict()
      .optional(),
    obstacles: z.array(obstacleSchema).max(ROOM_LIMITS.obstacles).optional(),
    walls: z.array(wallSchema).max(ROOM_LIMITS.walls).optional(),
  })
  .strict();

/**
 * Outro obstáculo da parede que ocupa o mesmo lugar. Dois na mesma área
 * (janela sobre a TV) se atravessam no 3D e não existem assim na parede.
 */
export function obstacleOverlap(o: Pick<Obstacle, 'id' | 'kind' | 'xMm' | 'yMm' | 'widthMm' | 'heightMm'>, others: readonly Obstacle[]) {
  const TOUCH = 1;
  const a = framed(o);
  return (
    others.find((v) => {
      if (v.id === o.id) return false;
      const b = framed(v);
      return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > TOUCH && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > TOUCH;
    }) ?? null
  );
}
/**
 * Primeiro par de obstáculos no mesmo lugar da parede, como frase: "A janela
 * bate na TV." Vale para o painel, o servidor e a IA, não só para o arrasto.
 */
export function obstacleClash(list: readonly Obstacle[]) {
  for (let i = 0; i < list.length; i++) {
    const other = obstacleOverlap(list[i], list.slice(i + 1));
    if (other) return `${obstacleName(list[i], true)} bate ${obstacleOn(other)}. Afaste um dos dois na parede.`;
  }
  return null;
}
const NAME: Record<ObstacleKind, [article: string, noun: string]> = {
  door: ['a', 'porta'],
  window: ['a', 'janela'],
  outlet: ['a', 'tomada'],
  column: ['a', 'coluna'],
  tv: ['a', 'TV'],
  other: ['o', 'obstáculo'],
};
function obstacleName(o: Obstacle, capital = false) {
  const [art, noun] = NAME[o.kind];
  const text = o.label ? `${art === 'a' ? 'a' : 'o'} ${noun} "${o.label}"` : `${art} ${noun}`;
  return capital ? text[0].toUpperCase() + text.slice(1) : text;
}
/** "na TV", "no obstáculo": a preposição concorda com o artigo. */
function obstacleOn(o: Obstacle) {
  const name = obstacleName(o);
  return (name.startsWith('a ') ? 'na ' : 'no ') + name.slice(2);
}

/** O vão mais o batente ou o caixilho que o desenho põe em volta dele. */
export const OBSTACLE_FRAME: Partial<Record<ObstacleKind, number>> = { door: 50, window: 30 };
export function framed(o: Pick<Obstacle, 'kind' | 'xMm' | 'yMm' | 'widthMm' | 'heightMm'>) {
  const f = OBSTACLE_FRAME[o.kind] ?? 0;
  return { x0: o.xMm - f, x1: o.xMm + o.widthMm + f, y0: Math.max(0, o.yMm - f), y1: o.yMm + o.heightMm + f };
}

/** Nome de cada tipo na interface: "Porta", "Janela"... */
export const OBSTACLE_LABEL: Record<ObstacleKind, string> = {
  door: 'Porta',
  window: 'Janela',
  outlet: 'Tomada',
  tv: 'TV',
  column: 'Coluna',
  other: 'Outro',
};

/**
 * Tamanho e altura do piso de cada tipo quando a pessoa só escolhe o tipo:
 * as medidas comuns de obra. Coluna vai do piso ao teto (`heightMm` 0 aqui
 * vira o pé-direito da parede).
 */
export const OBSTACLE_PRESET: Record<ObstacleKind, { widthMm: number; heightMm: number; yMm: number }> = {
  door: { widthMm: 800, heightMm: 2100, yMm: 0 },
  window: { widthMm: 1000, heightMm: 1000, yMm: 1100 },
  outlet: { widthMm: 80, heightMm: 80, yMm: 300 },
  tv: { widthMm: 1200, heightMm: 700, yMm: 1100 },
  column: { widthMm: 300, heightMm: 0, yMm: 0 },
  other: { widthMm: 600, heightMm: 600, yMm: 1000 },
};

/** Porta e coluna ficam no piso: só andam na horizontal. */
export function floorBound(kind: ObstacleKind) {
  return kind === 'door' || kind === 'column';
}

/** Obstáculo novo do tipo, com as medidas comuns cabendo na parede. */
export function presetObstacle(kind: ObstacleKind, room: Pick<Room, 'widthMm' | 'heightMm'>, id: string): Obstacle {
  const p = OBSTACLE_PRESET[kind];
  const heightMm = Math.min(p.heightMm || room.heightMm, room.heightMm);
  const widthMm = Math.min(p.widthMm, room.widthMm);
  return { id, kind, xMm: 0, yMm: Math.max(0, Math.min(p.yMm, room.heightMm - heightMm)), widthMm, heightMm };
}

/**
 * Primeiro lugar livre da parede para o obstáculo, na altura dele: sem bater
 * em outro obstáculo e, se der, sem ficar na frente do móvel (`blocked` diz
 * onde o móvel está, em x da parede). Procura a partir de `nearX` para os dois
 * lados; `null` quando a parede não tem espaço.
 */
export function freeSpot(
  o: Obstacle,
  room: Pick<Room, 'widthMm' | 'obstacles'>,
  blocked: (x0: number, x1: number) => boolean = () => false,
  nearX = 0,
) {
  const others = (room.obstacles ?? []).filter((v) => v.id !== o.id);
  const f = OBSTACLE_FRAME[o.kind] ?? 0;
  const lo = f,
    hi = room.widthMm - o.widthMm - f;
  if (hi < lo) return null;
  const tries: number[] = [];
  const start = Math.min(hi, Math.max(lo, Math.round(nearX / 50) * 50));
  for (let d = 0; start - d >= lo || start + d <= hi; d += 50) {
    if (start + d <= hi) tries.push(start + d);
    if (d && start - d >= lo) tries.push(start - d);
  }
  tries.push(hi);
  const fits = (x: number) => !obstacleOverlap({ ...o, xMm: x }, others);
  const x = tries.find((v) => fits(v) && !blocked(v - f, v + o.widthMm + f)) ?? tries.find(fits);
  return x === undefined ? null : x;
}

/** Nome com artigo no começo da frase: "a porta", "a janela "Sala"". */
export function obstacleWord(o: Pick<Obstacle, 'kind' | 'label'>) {
  return o.label ? `"${o.label}"` : `${NAME[o.kind][0]} ${NAME[o.kind][1]}`;
}

/**
 * Único obstáculo que só mudou de lugar (x, y) entre os dois ambientes, com o
 * resto igual: é o que junta arrastos seguidos numa versão só.
 */
export function movedObstacle(before: Room | undefined, after: Room | undefined) {
  if (!before || !after) return null;
  const a = before.obstacles ?? [],
    b = after.obstacles ?? [];
  if (a.length !== b.length) return null;
  const { obstacles: _a, ...restA } = before;
  const { obstacles: _b, ...restB } = after;
  void _a;
  void _b;
  if (JSON.stringify(restA) !== JSON.stringify(restB)) return null;
  let moved: string | null = null;
  for (const [i, o] of a.entries()) {
    const n = b[i];
    if (n.id !== o.id) return null;
    if (JSON.stringify(n) === JSON.stringify(o)) continue;
    if (JSON.stringify({ ...n, xMm: o.xMm, yMm: o.yMm }) !== JSON.stringify(o) || moved) return null;
    moved = o.id;
  }
  return moved;
}

// ---------------------------------------------------------------- paredes

/** Espessura de uma parede de alvenaria comum, com o reboco dos dois lados. */
export const WALL_THICKNESS_MM = 150;
/** Id da parede do fundo na seleção da cena: as outras paredes têm o próprio. */
export const MAIN_WALL = 'main';
/** Passo das paredes no arrasto e nas alças: 1 cm. */
const WALL_GRID = 10;
/** Distância em que a borda de uma parede gruda num canto ou noutra parede. */
export const WALL_MAGNET_MM = 60;

/** Base da parede em planta, no sistema do ambiente (x do canto, z da face do fundo). */
export function wallFootprint(w: Pick<Wall, 'xMm' | 'zMm' | 'widthMm' | 'thicknessMm' | 'rotation'>) {
  const along = w.rotation === 0;
  return {
    x0: w.xMm,
    x1: w.xMm + (along ? w.widthMm : w.thicknessMm),
    z0: w.zMm,
    z1: w.zMm + (along ? w.thicknessMm : w.widthMm),
  };
}

/**
 * Caixa da parede no mundo, a partir do canto esquerdo e da face da parede do
 * fundo (`wallAt`); a altura para no teto.
 */
export function wallBox(w: Wall, origin: { x: number; z: number }, ceiling: number): WorldBox {
  const f = wallFootprint(w);
  return { min: [origin.x + f.x0, 0, origin.z + f.z0], max: [origin.x + f.x1, Math.min(w.heightMm, ceiling), origin.z + f.z1] };
}
/** As caixas têm volume em comum, mais de 1 mm em cada eixo? Encostar face com face não conta. */
export function boxesCross(a: WorldBox, b: WorldBox) {
  return [0, 1, 2].every((i) => Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]) > 1);
}

/** "Parede 2" pelo número do id, ou o nome dado. */
export function wallName(w: Pick<Wall, 'id' | 'label'>) {
  if (w.label) return w.label;
  const n = /(\d+)$/.exec(w.id)?.[1];
  return n ? `Parede ${n}` : 'Parede';
}
/** Com artigo, no meio da frase: "a parede 2", "a parede "Lavanderia"". */
export function wallWord(w: Pick<Wall, 'id' | 'label'>) {
  return w.label ? `a parede "${w.label}"` : `a ${wallName(w).toLowerCase()}`;
}
export function nextWallId(walls: readonly Pick<Wall, 'id'>[] = []) {
  let n = 1;
  while (walls.some((w) => w.id === `wall-${n}`)) n++;
  return `wall-${n}`;
}

type WallRoom = Pick<Room, 'widthMm' | 'heightMm' | 'depthMm' | 'walls'>;

/**
 * Parede nova: sai da parede do fundo para a frente, com o pé-direito, 1,2 m
 * de comprimento e 15 cm de espessura, fechando o canto direito por dentro.
 * A prévia segue o cursor até o clique.
 */
export function presetWall(room: WallRoom): Wall {
  return {
    id: nextWallId(room.walls),
    xMm: room.widthMm - WALL_THICKNESS_MM,
    zMm: 0,
    widthMm: Math.max(ROOM_LIMITS.wallLength[0], Math.min(1200, room.depthMm ?? 1200)),
    heightMm: Math.min(room.heightMm, ROOM_LIMITS.wallHeight[1]),
    thicknessMm: WALL_THICKNESS_MM,
    rotation: 90,
  };
}

/**
 * Onde a base pode ficar: da face da parede do fundo para a frente (até a
 * profundidade, quando informada) e até uma espessura para fora de cada
 * canto, onde fica a lateral que fecha o canto por fora.
 */
function wallArea(room: WallRoom, w: Pick<Wall, 'thicknessMm'>) {
  return { x0: -w.thicknessMm, x1: room.widthMm + w.thicknessMm, z0: 0, z1: room.depthMm ?? ROOM_LIMITS.wallZ[1] };
}

/** Linhas onde a borda de uma parede gruda: os cantos, a face do fundo e as outras paredes. */
function wallTargets(room: WallRoom, except?: string) {
  const xs = [0, room.widthMm];
  const zs = [0, ...(room.depthMm ? [room.depthMm] : [])];
  for (const v of room.walls ?? []) {
    if (v.id === except) continue;
    const f = wallFootprint(v);
    xs.push(f.x0, f.x1);
    zs.push(f.z0, f.z1);
  }
  return { xs, zs };
}

/** Quanto andar para a borda mais perto de uma linha grudar nela; 0 se nenhuma está perto. */
function magnet(edges: readonly number[], targets: readonly number[], radius = WALL_MAGNET_MM) {
  let best = 0,
    dist = radius;
  for (const e of edges)
    for (const t of targets) {
      const d = Math.abs(t - e);
      if (d < dist) {
        dist = d;
        best = t - e;
      }
    }
  return best;
}
const snapTo = (v: number, step = WALL_GRID) => Math.round(v / step) * step;
const clampTo = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * A parede levada para (x, z): passo de 1 cm, a borda grudando no canto, na
 * face do fundo ou noutra parede quando chega perto, sem sair do ambiente.
 */
export function moveWallTo(w: Wall, xMm: number, zMm: number, room: WallRoom): Wall {
  const moved = { ...w, xMm: snapTo(xMm), zMm: snapTo(zMm) };
  const f = wallFootprint(moved);
  const t = wallTargets(room, w.id);
  const a = wallArea(room, w);
  moved.xMm = Math.round(clampTo(moved.xMm + magnet([f.x0, f.x1], t.xs), a.x0, a.x1 - (f.x1 - f.x0)));
  moved.zMm = Math.round(clampTo(moved.zMm + magnet([f.z0, f.z1], t.zs), a.z0, a.z1 - (f.z1 - f.z0)));
  return moved;
}

/** Ponta da parede no comprimento: 'start' é a de x (ou z) menor. */
export type WallEnd = 'start' | 'end';

/**
 * A ponta levada para `at` (mm no eixo da parede: x quando corre ao longo do
 * fundo, z quando sai dele), com a outra ponta parada. Passo de 1 cm, gruda
 * em cantos e noutras paredes, nunca fica com menos de 10 cm nem sai do
 * ambiente.
 */
export function resizeWallEnd(w: Wall, end: WallEnd, at: number, room: WallRoom): Wall {
  const along = w.rotation === 0;
  const a = wallArea(room, w);
  const t = wallTargets(room, w.id);
  const [min, max] = ROOM_LIMITS.wallLength;
  const start = along ? w.xMm : w.zMm;
  const stop = start + w.widthMm;
  let v = snapTo(at);
  v += magnet([v], along ? t.xs : t.zs);
  if (end === 'end') {
    v = clampTo(v, start + min, Math.min(along ? a.x1 : a.z1, start + max));
    return { ...w, widthMm: Math.round(v - start) };
  }
  v = clampTo(v, Math.max(along ? a.x0 : a.z0, stop - max), stop - min);
  return { ...w, ...(along ? { xMm: Math.round(v) } : { zMm: Math.round(v) }), widthMm: Math.round(stop - v) };
}

/** Altura nova, de 10 cm até o pé-direito; perto do teto, vai até ele. */
export function resizeWallHeight(w: Wall, heightMm: number, room: Pick<Room, 'heightMm'>): Wall {
  const h = Math.abs(room.heightMm - heightMm) < WALL_MAGNET_MM ? room.heightMm : snapTo(heightMm);
  return { ...w, heightMm: Math.round(clampTo(h, ROOM_LIMITS.wallHeight[0], room.heightMm)) };
}

/** Gira 90° em volta do centro da base, sem sair do ambiente. */
export function rotateWall(w: Wall, room: WallRoom): Wall {
  const f = wallFootprint(w);
  const turned: Wall = { ...w, rotation: w.rotation === 0 ? 90 : 0 };
  const g = wallFootprint({ ...turned, xMm: 0, zMm: 0 });
  const a = wallArea(room, w);
  return {
    ...turned,
    xMm: Math.round(clampTo((f.x0 + f.x1 - g.x1) / 2, a.x0, a.x1 - g.x1)),
    zMm: Math.round(clampTo((f.z0 + f.z1 - g.z1) / 2, a.z0, a.z1 - g.z1)),
  };
}

/** Paredes na altura do teto acompanham o pé-direito; nenhuma passa dele. */
export function fitWallsToCeiling(walls: readonly Wall[], before: number, after: number): Wall[] {
  return walls.map((w) => (w.heightMm >= before || w.heightMm > after ? { ...w, heightMm: after } : w));
}

/** Lado da parede do fundo que a alça mexe: as pontas (largura) ou o topo (pé-direito). */
export type MainWallEdge = 'start' | 'end' | 'top';

/**
 * A parede do fundo com a alça solta em `at`, em mm no sistema do ambiente de
 * agora: x a partir do canto esquerdo para as pontas, y do piso para o topo.
 *
 * A ponta direita muda a largura. A esquerda muda a largura e o canto, e
 * prende a parede no mundo (`anchor`) para nada nela sair do lugar: os
 * obstáculos e as outras paredes são recontados do canto novo. Nenhuma ponta
 * passa por cima de um obstáculo, o teto não desce sobre um, e as paredes na
 * altura do teto acompanham o pé-direito. As pontas grudam nos lados do móvel.
 */
export function resizeMainWall(room: Room, bounds: Extent, edge: MainWallEdge, at: number): Room {
  const frames = (room.obstacles ?? []).map(framed);
  if (edge === 'top') {
    const h = Math.round(clampTo(snapTo(at), Math.max(ROOM_LIMITS.height[0], ...frames.map((f) => f.y1)), ROOM_LIMITS.height[1]));
    return { ...room, heightMm: h, ...(room.walls ? { walls: fitWallsToCeiling(room.walls, room.heightMm, h) } : {}) };
  }
  const wall = wallAt(room, bounds);
  const [minW, maxW] = ROOM_LIMITS.width;
  let x = snapTo(at);
  x += magnet([x], [bounds.min[0] - wall.x, bounds.max[0] - wall.x]);
  if (edge === 'end') return { ...room, widthMm: Math.round(clampTo(x, Math.max(minW, ...frames.map((f) => f.x1)), maxW)) };
  const shift = Math.round(clampTo(x, room.widthMm - maxW, Math.min(room.widthMm - minW, ...frames.map((f) => f.x0))));
  if (!shift) return room;
  const anchor = { x: wall.x + shift, z: wall.z };
  const offset = Math.max(0, Math.round(bounds.min[0] - anchor.x));
  const { offsetMm: _old, ...rest } = room;
  void _old;
  return {
    ...rest,
    widthMm: room.widthMm - shift,
    ...(offset ? { offsetMm: offset } : {}),
    anchor,
    ...(room.obstacles ? { obstacles: room.obstacles.map((o) => ({ ...o, xMm: o.xMm - shift })) } : {}),
    ...(room.walls ? { walls: room.walls.map((w) => ({ ...w, xMm: w.xMm - shift })) } : {}),
  };
}

const WALL_SHAPE = ['xMm', 'zMm', 'widthMm', 'heightMm', 'rotation'] as const;
/**
 * Única parede que só mudou de lugar ou de medida (arrasto, alça, giro) entre
 * os dois ambientes, com o resto igual: é o que junta ajustes seguidos numa
 * versão só, como os arrastos de obstáculo.
 */
export function editedWall(before: Room | undefined, after: Room | undefined) {
  if (!before || !after) return null;
  const a = before.walls ?? [],
    b = after.walls ?? [];
  if (a.length !== b.length) return null;
  const { walls: _a, ...restA } = before;
  const { walls: _b, ...restB } = after;
  void _a;
  void _b;
  if (JSON.stringify(restA) !== JSON.stringify(restB)) return null;
  let edited: string | null = null;
  for (const [i, w] of a.entries()) {
    const n = b[i];
    if (n.id !== w.id) return null;
    if (JSON.stringify(n) === JSON.stringify(w)) continue;
    const shape = Object.fromEntries(WALL_SHAPE.map((k) => [k, w[k]]));
    if (JSON.stringify({ ...n, ...shape }) !== JSON.stringify(w) || edited) return null;
    edited = w.id;
  }
  return edited;
}

/**
 * Rótulo da versão para uma mudança no ambiente, pelo que mudou: "Pôs a
 * porta", "Moveu a janela", "Tirou a TV", "Mudou as medidas da tomada",
 * "Pôs a parede 1", "Girou a parede 2", "Medidas da parede".
 */
export function roomChangeLabel(before: Room | undefined, after: Room) {
  const a = before?.obstacles ?? [],
    b = after.obstacles ?? [];
  const added = b.filter((o) => !a.some((v) => v.id === o.id));
  const removed = a.filter((o) => !b.some((v) => v.id === o.id));
  const changed = b.filter((o) => {
    const old = a.find((v) => v.id === o.id);
    return old && JSON.stringify(old) !== JSON.stringify(o);
  });
  const wa = before?.walls ?? [],
    wb = after.walls ?? [];
  const wallsAdded = wb.filter((w) => !wa.some((v) => v.id === w.id));
  const wallsRemoved = wa.filter((w) => !wb.some((v) => v.id === w.id));
  const wallsChanged = wb.filter((w) => {
    const old = wa.find((v) => v.id === w.id);
    return old && JSON.stringify(old) !== JSON.stringify(w);
  });
  const one = (verb: string, list: Obstacle[]) =>
    list.length === 1 ? `${verb} ${obstacleWord(list[0])}` : `${verb} ${list.length} obstáculos`;
  const oneWall = (verb: string, list: Wall[]) => (list.length === 1 ? `${verb} ${wallWord(list[0])}` : `${verb} ${list.length} paredes`);
  if (!before) {
    if (added.length) return `Ambiente com ${one('', added).trim()}`;
    return wallsAdded.length ? `Ambiente com ${oneWall('', wallsAdded).trim()}` : 'Medidas do ambiente';
  }
  // A parede do fundo mudou de medida: é o que a pessoa fez, mesmo quando o
  // canto novo recontou os obstáculos e as paredes a partir dele.
  const main = (r: Room) => JSON.stringify([r.widthMm, r.heightMm, r.depthMm, r.baseboardMm]);
  if (main(before) !== main(after)) return 'Medidas da parede';
  const obstaclesMoved = added.length + removed.length + changed.length > 0;
  if (wallsAdded.length + wallsRemoved.length + wallsChanged.length && !obstaclesMoved) {
    if (!wallsRemoved.length && !wallsChanged.length) return oneWall('Pôs', wallsAdded);
    if (!wallsAdded.length && !wallsChanged.length) return oneWall('Tirou', wallsRemoved);
    if (wallsChanged.length === 1 && !wallsAdded.length && !wallsRemoved.length) {
      const n = wallsChanged[0],
        old = wa.find((v) => v.id === n.id)!;
      const sized = old.widthMm !== n.widthMm || old.heightMm !== n.heightMm || old.thicknessMm !== n.thicknessMm || old.label !== n.label;
      if (sized) return `Mudou ${wallWord(n)}`;
      return old.rotation !== n.rotation ? `Girou ${wallWord(n)}` : `Moveu ${wallWord(n)}`;
    }
    return 'Paredes do ambiente';
  }
  if (added.length && !removed.length && !changed.length) return one('Pôs', added);
  if (removed.length && !added.length && !changed.length) return one('Tirou', removed);
  if (changed.length && !added.length && !removed.length) {
    const moved = movedObstacle(before, after);
    if (moved) return one('Moveu', changed);
    return changed.length === 1 ? `Mudou ${obstacleWord(changed[0])}` : `Mudou ${changed.length} obstáculos`;
  }
  if (added.length || removed.length || changed.length) return 'Obstáculos da parede';
  return 'Medidas da parede';
}

/**
 * Obstáculos que a IA pode pôr, mover ou tirar da parede num turno. Não mexem
 * no móvel; a mudança entra no histórico junto com o turno.
 */
const obstacleKind = z.enum(['door', 'window', 'outlet', 'column', 'tv', 'other']);
export const obstacleEditsSchema = z
  .object({
    add: z
      .array(
        z
          .object({
            kind: obstacleKind,
            label: z.string().trim().min(1).max(80).optional(),
            xMm: z.number(),
            yMm: z.number(),
            widthMm: z.number(),
            heightMm: z.number(),
          })
          .strict(),
      )
      .max(8)
      .default([]),
    move: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            xMm: z.number().optional(),
            yMm: z.number().optional(),
            widthMm: z.number().optional(),
            heightMm: z.number().optional(),
          })
          .strict(),
      )
      .max(8)
      .default([]),
    remove: z.array(z.string().min(1).max(100)).max(8).default([]),
  })
  .strict();
export type ObstacleEdits = z.infer<typeof obstacleEditsSchema>;

/** Um móvel visto da parede: intervalo em x (mm do canto esquerdo) e faixa de altura. */
export type FurnitureSpan = { x0: number; x1: number; y0: number; y1: number; name: string };

/** Onde cada módulo do projeto está na parede do ambiente. */
export function furnitureOnWall(design: Composition, room: Room): FurnitureSpan[] {
  const g = generateComposition(design);
  const wall = wallAt(room, g.bounds);
  const boxes = moduleBoxes(g.parts);
  return design.modules.flatMap((m) => {
    const b = boxes.get(m.id);
    return b ? [{ x0: b.minX - wall.x, x1: b.maxX - wall.x, y0: b.minY, y1: b.maxY, name: m.name }] : [];
  });
}

/**
 * Aplica o pedido da IA ao ambiente. Sem ambiente informado, começa um com a
 * parede de um quarto comum e largura para caber o móvel.
 *
 * Obstáculo novo em cima de outro, fora da parede, ou janela e porta atrás
 * de um móvel (`furniture`) não é recusado: vai para o lugar livre mais
 * perto do pedido, e `moved` diz para onde e por quê. Recusado, a IA
 * tentava de novo às cegas e gastava o pedido marcando a parede. Só o que
 * não cabe em lugar nenhum volta em `skipped`, com o motivo.
 */
export function applyObstacleEdits(room: Room | undefined, edits: ObstacleEdits, furnitureWidthMm = 0, furniture: readonly FurnitureSpan[] = []) {
  const base: Room = room ?? { ...emptyRoom(), widthMm: Math.max(3000, Math.ceil((furnitureWidthMm + 1200) / 100) * 100) };
  const skipped: string[] = [];
  const moved: string[] = [];
  let list = [...(base.obstacles ?? [])].filter((o) => !edits.remove.includes(o.id));
  // Janela e porta atrás de móvel alto não fazem sentido; tomada e TV podem.
  const hiddenBy = (o: Obstacle, x0 = framed(o).x0, x1 = framed(o).x1) => {
    if (o.kind !== 'window' && o.kind !== 'door') return null;
    const f = framed(o);
    return furniture.find((m) => x0 < m.x1 && x1 > m.x0 && f.y0 < m.y1 && f.y1 > m.y0) ?? null;
  };
  /** Por que o lugar pedido não serve; null quando serve. */
  const problem = (o: Obstacle, others: readonly Obstacle[]) => {
    const f = framed(o);
    if (f.x0 < 0 || f.x1 > base.widthMm) return 'passava da parede';
    if (f.y1 > base.heightMm) return 'passava do teto';
    const hit = obstacleOverlap(o, others);
    if (hit) return `batia em ${obstacleWord(hit)}`;
    const behind = hiddenBy(o);
    return behind ? `ficava atrás de ${behind.name}` : null;
  };
  /**
   * Trechos da parede livres na faixa de altura do obstáculo (sem outro
   * obstáculo e, para janela e porta, sem móvel na frente): o que a IA
   * precisa para escolher outra medida de uma vez, em vez de tentar às cegas.
   */
  const freeStretches = (o: Obstacle, others: readonly Obstacle[]) => {
    const f = framed(o);
    const blocks = [
      ...others.map(framed).filter((b) => b.y0 < f.y1 && b.y1 > f.y0),
      ...(o.kind === 'window' || o.kind === 'door' ? furniture.filter((m) => m.y0 < f.y1 && m.y1 > f.y0) : []),
    ].sort((a, b) => a.x0 - b.x0);
    const out: string[] = [];
    let x = 0;
    for (const b of blocks) {
      if (b.x0 - x >= 200) out.push(`${Math.round(x)}–${Math.round(b.x0)}`);
      x = Math.max(x, b.x1);
    }
    if (base.widthMm - x >= 200) out.push(`${Math.round(x)}–${base.widthMm}`);
    return out;
  };
  /** O lugar pedido ou o livre mais perto dele; o motivo quando não há. */
  const place = (o: Obstacle, others: readonly Obstacle[]): Obstacle | string => {
    const why = problem(o, others);
    if (!why) return o;
    const x = freeSpot(o, { widthMm: base.widthMm, obstacles: [...others] }, (x0, x1) => !!hiddenBy(o, x0, x1), o.xMm);
    const spot = x === null ? null : { ...o, xMm: x };
    // Sem lugar de verdade (o freeSpot cai no lugar ainda atrás do móvel):
    // recusa com os trechos livres, nunca "ajusta" para outro lugar ruim.
    if (!spot || problem(spot, others)) {
      const free = freeStretches(o, others);
      return `sem trecho livre de ${Math.round(framed(o).x1 - framed(o).x0)} mm nessa altura${free.length ? `; livres: ${free.join(', ')} mm` : ''}`;
    }
    moved.push(`${o.label ?? o.kind}: pedido em x ${Math.round(o.xMm)}, ficou em x ${x} (${why})`);
    return spot;
  };
  for (const m of edits.move) {
    const i = list.findIndex((o) => o.id === m.id);
    if (i < 0) {
      skipped.push(`${m.id} (não existe)`);
      continue;
    }
    const { id: _id, ...rest } = m;
    void _id;
    const next = { ...list[i], ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) } as Obstacle;
    const spot = obstacleSchema.safeParse(next).success ? place(next, list.filter((o) => o.id !== next.id)) : 'medida fora do limite';
    if (typeof spot === 'string') skipped.push(`${m.id} (${spot})`);
    else list[i] = spot;
  }
  const taken = new Set(list.map((o) => o.id));
  for (const a of edits.add) {
    let n = 1;
    while (taken.has(`${a.kind}-${n}`)) n++;
    const next = { id: `${a.kind}-${n}`, ...a } as Obstacle;
    const valid = obstacleSchema.safeParse(next).success;
    const spot = !valid ? 'medida fora do limite' : list.length >= ROOM_LIMITS.obstacles ? `limite de ${ROOM_LIMITS.obstacles} obstáculos` : place(next, list);
    if (typeof spot === 'string') skipped.push(`${a.label ?? a.kind} (${spot})`);
    else {
      list.push(spot);
      taken.add(spot.id);
    }
  }
  list = list.map((o) => ({ ...o, xMm: Math.round(o.xMm), yMm: Math.round(o.yMm) }));
  return { room: { ...base, obstacles: list }, skipped, moved };
}

/**
 * Ambiente de partida do formulário: medidas de um quarto comum. Nada é salvo
 * sem passar pelo botão, então quem mede diferente só ajusta os campos.
 */
export function emptyRoom(): Room {
  return { schemaVersion: 1, widthMm: 3000, heightMm: 2700, obstacles: [] };
}

const KIND_WORD: Record<ObstacleKind, string> = {
  door: 'A porta',
  window: 'A janela',
  outlet: 'A tomada',
  column: 'A coluna',
  tv: 'A TV',
  other: 'O obstáculo',
};

/** Metros com duas casas: "2,87 m". */
function metres(millimetres: number) {
  return `${(millimetres / 1000).toFixed(2).replace('.', ',')} m`;
}

/** Centímetros com uma casa no máximo: "47 cm". */
function centimetres(millimetres: number) {
  return `${String(Number((millimetres / 10).toFixed(1))).replace('.', ',')} cm`;
}

/** Milímetros: "80 mm". */
function plain(millimetres: number) {
  return `${String(Number(millimetres.toFixed(2)))} mm`;
}

type Box = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

/**
 * Caixa de mundo de uma peça, a mesma conta que lib/composition faz para o
 * envelope. A rotação só existe em 0/90/180/270: o eixo girado troca largura
 * por profundidade.
 */
function partBox(part: ModularPart): Box {
  const b = worldBox(part);
  return { minX: b.min[0], maxX: b.max[0], minY: b.min[1], maxY: b.max[1], minZ: b.min[2], maxZ: b.max[2] };
}

function mergeBox(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

/**
 * Caixas das peças de cada módulo. O encaixe confere peça por peça: pela
 * união, a moldura no topo de uma torre (4 cm para o lado, lá em cima)
 * alargava a torre inteira e ela "tapava" a TV ao lado, na altura da tela.
 */
function partBoxesOf(parts: readonly ModularPart[]) {
  const out = new Map<string, Box[]>();
  for (const part of parts)
    for (const owner of part.owners) {
      const list = out.get(owner);
      if (list) list.push(partBox(part));
      else out.set(owner, [partBox(part)]);
    }
  return out;
}
const asMinMax = (b: Box) => ({ min: [b.minX, b.minY, b.minZ] as const, max: [b.maxX, b.maxY, b.maxZ] as const });

/** Caixa de cada módulo (x ao longo da parede, y do piso): a união das peças dele. */
export function moduleBoxes(parts: readonly ModularPart[]) {
  const modules = new Map<string, Box>();
  for (const part of parts)
    for (const owner of part.owners) {
      const box = partBox(part);
      const current = modules.get(owner);
      modules.set(owner, current ? mergeBox(current, box) : box);
    }
  return modules;
}

/** O que a parede vê: cruzar em x (ao longo dela) e em y (do piso para cima). */
/** Área na parede (x e altura), sem profundidade. */
type Area = Pick<Box, 'minX' | 'maxX' | 'minY' | 'maxY'>;
function crosses(a: Area, b: Area) {
  return (
    Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > TOUCH &&
    Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > TOUCH
  );
}

/** Veredito de encaixe. A ordem dos problemas é a ordem de importância. */
export function fitReport(design: Composition, room: Room): FitReport {
  const g = generateComposition(design);
  const width = g.bounds.max[0] - g.bounds.min[0];
  const height = g.bounds.max[1];
  const depth = g.bounds.max[2] - g.bounds.min[2];
  const base = g.bounds.min[1];
  const issues: FitIssue[] = [];
  // O envelope é a união das caixas das peças; a caixa de cada módulo é a união
  // das peças dele (um painel compartilhado pertence aos dois).
  const modules = moduleBoxes(g.parts);
  const pieces = partBoxesOf(g.parts);
  const obstacles = room.obstacles ?? [];
  const crossed = new Set<string>();
  const obstacleIssues: FitIssue[] = [];
  // Tomada atrás do móvel é comum e tem solução de obra (recorte no fundo ou
  // mudar a tomada): vira nota, não problema de encaixe. Como problema, a IA
  // gastava o pedido inteiro mudando tomada de lugar.
  const behind: string[] = [];
  const offset = roomOffset(room, g.bounds);
  const gap = wallGap(room, g.bounds);
  // TV: o painel atrás dela é o lugar dela; o que avança na frente da tela
  // (ou encosta nela, dentro da folga) tapa. Antes a TV era pulada inteira e
  // um nicho alto na frente da tela passava como "cabe".
  const tvIssues: FitIssue[] = [];
  for (const tv of tvPlacements(design, room, g))
    for (const movel of design.modules) {
      const box = pieces.get(movel.id)?.find((b) => blocksTv(tv.rect, tv.mountZ, asMinMax(b)));
      if (!box) continue;
      const who = tv.obstacle.label ?? 'TV';
      const inFront =
        Math.min(box.maxX, tv.rect.x1) - Math.max(box.minX, tv.rect.x0) > 0.5 && Math.min(box.maxY, tv.rect.y1) - Math.max(box.minY, tv.rect.y0) > 0.5;
      crossed.add(tv.obstacle.id);
      tvIssues.push({
        code: 'tv-blocked',
        key: `tv-blocked:${tv.obstacle.id}:${movel.id}`,
        message: inFront
          ? `O módulo ${movel.name} fica na frente da ${who}`
          : `O módulo ${movel.name} encosta na ${who}: deixe ${centimetres(TV_CLEARANCE_MM)} livres em volta da tela`,
        detail: `A tela vai de ${plain(tv.obstacle.xMm)} a ${plain(tv.obstacle.xMm + tv.obstacle.widthMm)} na parede e de ${plain(tv.rect.y0)} a ${plain(tv.rect.y1)} do piso.`,
      });
    }
  for (const obstacle of obstacles) {
    // TV conferida acima, pelo plano da tela.
    if (obstacle.kind === 'tv') continue;
    // O ambiente conta x do canto esquerdo; a composição começa no afastamento.
    const minX = obstacle.xMm - offset + g.bounds.min[0];
    const maxX = minX + obstacle.widthMm;
    const area: Area = {
      minX,
      maxX,
      minY: obstacle.yMm,
      maxY: obstacle.yMm + obstacle.heightMm,
    };
    // `module` é palavra reservada na regra do Next: usar outro nome.
    for (const movel of design.modules) {
      const box = modules.get(movel.id);
      if (!box || !pieces.get(movel.id)?.some((b) => crosses(area, b))) continue;
      const who = obstacle.label ?? KIND_WORD[obstacle.kind];
      if (obstacle.kind === 'outlet') {
        behind.push(`${who} fica atrás do módulo ${movel.name}: recorte no fundo ou mude a tomada de lugar na obra.`);
        continue;
      }
      crossed.add(obstacle.id);
      obstacleIssues.push({
        code: 'obstacle-overlap',
        key: `obstacle-overlap:${obstacle.id}:${movel.id}`,
        message: `${who} (x de ${plain(obstacle.xMm)} a ${plain(obstacle.xMm + obstacle.widthMm)} na parede) cruza o módulo ${movel.name}`,
        detail: `O obstáculo vai de ${plain(area.minY)} a ${plain(area.maxY)} do piso; o módulo ocupa de ${plain(box.minY)} a ${plain(box.maxY)}.`,
      });
    }
  }
  // Paredes do ambiente: é alvenaria, então qualquer volume em comum com um
  // módulo não cabe. Encostar (face com face) cabe.
  const wallIssues: FitIssue[] = [];
  const crossedWalls = new Set<string>();
  const origin = wallAt(room, g.bounds);
  for (const w of room.walls ?? []) {
    const f = wallFootprint(w);
    const solid = wallBox(w, origin, room.heightMm);
    for (const movel of design.modules) {
      if (!pieces.get(movel.id)?.some((b) => boxesCross(solid, asMinMax(b)))) continue;
      crossedWalls.add(w.id);
      wallIssues.push({
        code: 'wall-overlap',
        key: `wall-overlap:${w.id}:${movel.id}`,
        message: `${wallWord(w).replace(/^a/, 'A')} cruza o módulo ${movel.name}`,
        detail: `A parede ocupa x de ${plain(f.x0)} a ${plain(f.x1)} e vai de ${plain(f.z0)} a ${plain(f.z1)} da parede do fundo.`,
      });
    }
  }
  // Um veredito é uma frase só: o primeiro problema é o que o resumo conta.
  if (height > room.heightMm)
    issues.push({
      code: 'too-tall',
      message: `O móvel tem ${metres(height)} de altura e o pé-direito é ${metres(room.heightMm)}`,
      detail: `Passa ${centimetres(height - room.heightMm)} do teto.`,
    });
  if (offset < 0)
    issues.push({
      code: 'too-wide',
      message: `O móvel passa ${centimetres(-offset)} do canto esquerdo da parede`,
      detail: 'Arraste o móvel para a direita ou informe uma parede maior.',
    });
  else if (offset + width > room.widthMm)
    issues.push({
      code: 'too-wide',
      message: offset
        ? `O móvel começa a ${metres(offset)} do canto e tem ${metres(width)} de largura; a parede tem ${metres(room.widthMm)}`
        : `O móvel tem ${metres(width)} de largura e a parede tem ${metres(room.widthMm)}`,
      detail: `Passa ${centimetres(offset + width - room.widthMm)} da parede.`,
    });
  if (gap < -1)
    issues.push({
      code: 'too-deep',
      message: `O móvel atravessa a parede em ${centimetres(-gap)}`,
      detail: 'Arraste o móvel para a frente até encostar na parede.',
    });
  else if (room.depthMm !== undefined && depth + Math.max(gap, 0) > room.depthMm)
    issues.push({
      code: 'too-deep',
      message: gap > 1
        ? `O móvel está a ${centimetres(gap)} da parede e tem ${metres(depth)} de profundidade; o ambiente permite ${metres(room.depthMm)}`
        : `O móvel tem ${metres(depth)} de profundidade e o ambiente permite ${metres(room.depthMm)}`,
      detail: `Passa ${centimetres(depth + Math.max(gap, 0) - room.depthMm)} do limite do ambiente.`,
    });
  issues.push(...tvIssues, ...obstacleIssues, ...wallIssues);
  // Painel e módulo suspenso vão presos na parede: não precisam tocar o piso.
  const hung = design.modules.every((m) => m.kind === 'panel' || m.kind === 'ledge' || m.wall);
  if (base > ON_FLOOR && !hung)
    issues.push({
      code: 'floor-gap',
      message: `Nenhuma peça apoia no chão: o móvel começa a ${centimetres(base)} do piso`,
      detail: `O vão livre embaixo é de ${centimetres(base)}, sem apoio no piso.`,
    });
  const notes: string[] = [];
  if (room.depthMm === undefined)
    notes.push(
      'Profundidade do ambiente não informada: o avanço do móvel não foi conferido.',
    );
  if (room.baseboardMm !== undefined && room.baseboardMm > ON_FLOOR && base <= ON_FLOOR)
    notes.push(
      `Rodapé de ${plain(room.baseboardMm)}: recue a base do móvel para encostar na parede.`,
    );
  notes.push(...behind);
  const checked = obstacles.filter((o) => o.kind !== 'tv' && o.kind !== 'outlet');
  if (checked.length && !crossed.size)
    notes.push(
      `${checked.length === 1 ? 'Obstáculo conferido' : `${checked.length} obstáculos conferidos`}: nenhum cruza o móvel, contado do canto esquerdo da parede.`,
    );
  if (base > ON_FLOOR && hung)
    notes.push('Móvel suspenso: confira a fixação na parede e o que passa por dentro dela (fios e canos).');
  for (const obstacle of obstacles) {
    if (obstacle.kind !== 'door' || !obstacle.swingMm || crossed.has(obstacle.id))
      continue;
    // Sem saber o lado da dobradiça, o giro é conferido para os dois lados.
    const minX = obstacle.xMm - offset + g.bounds.min[0];
    const maxX = minX + obstacle.widthMm;
    if (
      minX - obstacle.swingMm <= g.bounds.max[0] &&
      maxX + obstacle.swingMm >= g.bounds.min[0]
    )
      notes.push(
        `${obstacle.label ?? KIND_WORD[obstacle.kind]} com giro de ${plain(obstacle.swingMm)}: confira se a folha abre sem bater no móvel.`,
      );
  }
  return { fits: issues.length === 0, issues, notes, crossed: [...crossed], crossedWalls: [...crossedWalls] };
}

/**
 * Uma linha para o resumo e para o cabeçalho. Aproveite o relatório já
 * calculado quando ele existir: a conferência percorre todas as peças.
 */
export function fitSummary(
  design: Composition,
  room: Room,
  report: FitReport = fitReport(design, room),
): string {
  const first = report.issues[0];
  if (first)
    return `Não cabe: ${first.message.charAt(0).toLowerCase()}${first.message.slice(1)}`;
  const g = generateComposition(design);
  const height = g.bounds.max[1];
  const width = g.bounds.max[0] - g.bounds.min[0];
  // A folga contada é a menor das duas: é ela que aperta o encaixe.
  const vertical = room.heightMm - height;
  const horizontal = room.widthMm - roomOffset(room, g.bounds) - width;
  if (vertical <= horizontal)
    return `Cabe: ${metres(room.heightMm)} de parede por ${metres(height)} de móvel, folga de ${centimetres(vertical)}`;
  return `Cabe: ${metres(room.widthMm)} de parede por ${metres(width)} de móvel, folga de ${centimetres(horizontal)}`;
}
