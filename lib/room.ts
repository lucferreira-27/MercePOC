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
  | 'obstacle-overlap';

export type FitIssue = {
  code: FitCode;
  message: string;
  detail?: string;
};

export type FitReport = {
  fits: boolean;
  issues: FitIssue[];
  notes: string[];
  /** Ids dos obstáculos que cruzam algum módulo: a lista do painel marca. */
  crossed?: string[];
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
} as const;

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

/**
 * Rótulo da versão para uma mudança no ambiente, pelo que mudou: "Pôs a
 * porta", "Moveu a janela", "Tirou a TV", "Mudou as medidas da tomada",
 * "Medidas da parede".
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
  const one = (verb: string, list: Obstacle[]) =>
    list.length === 1 ? `${verb} ${obstacleWord(list[0])}` : `${verb} ${list.length} obstáculos`;
  if (!before) return added.length ? `Ambiente com ${one('', added).trim()}` : 'Medidas do ambiente';
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

/**
 * Aplica o pedido da IA ao ambiente. Sem ambiente informado, começa um com a
 * parede de um quarto comum e largura para caber o móvel. Obstáculo fora dos
 * limites é recusado sem derrubar o turno: volta a lista do que não entrou.
 */
export function applyObstacleEdits(room: Room | undefined, edits: ObstacleEdits, furnitureWidthMm = 0) {
  const base: Room = room ?? { ...emptyRoom(), widthMm: Math.max(3000, Math.ceil((furnitureWidthMm + 1200) / 100) * 100) };
  const skipped: string[] = [];
  let list = [...(base.obstacles ?? [])].filter((o) => !edits.remove.includes(o.id));
  for (const m of edits.move) {
    const i = list.findIndex((o) => o.id === m.id);
    if (i < 0) {
      skipped.push(m.id);
      continue;
    }
    const { id: _id, ...rest } = m;
    void _id;
    const next = { ...list[i], ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
    if (obstacleSchema.safeParse(next).success && !obstacleOverlap(next, list)) list[i] = next;
    else skipped.push(m.id);
  }
  const taken = new Set(list.map((o) => o.id));
  for (const a of edits.add) {
    let n = 1;
    while (taken.has(`${a.kind}-${n}`)) n++;
    const next = { id: `${a.kind}-${n}`, ...a };
    // Em cima de outro obstáculo não entra: volta como "não coube".
    if (obstacleSchema.safeParse(next).success && list.length < ROOM_LIMITS.obstacles && !obstacleOverlap(next, list)) {
      list.push(next);
      taken.add(next.id);
    } else skipped.push(a.label ?? a.kind);
  }
  list = list.map((o) => ({ ...o, xMm: Math.round(o.xMm), yMm: Math.round(o.yMm) }));
  return { room: { ...base, obstacles: list }, skipped };
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
};

/**
 * Caixa de mundo de uma peça, a mesma conta que lib/composition faz para o
 * envelope. A rotação só existe em 0/90/180/270: o eixo girado troca largura
 * por profundidade.
 */
function partBox(part: ModularPart): Box {
  const turned = Math.round((part.rotation * 180) / Math.PI) % 180 !== 0;
  const width = turned ? part.size[2] : part.size[0];
  return {
    minX: part.position[0] - width / 2,
    maxX: part.position[0] + width / 2,
    minY: part.position[1] - part.size[1] / 2,
    maxY: part.position[1] + part.size[1] / 2,
  };
}

function mergeBox(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** O que a parede vê: cruzar em x (ao longo dela) e em y (do piso para cima). */
function crosses(a: Box, b: Box) {
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
  const modules = new Map<string, Box>();
  for (const part of g.parts)
    for (const owner of part.owners) {
      const box = partBox(part);
      const current = modules.get(owner);
      modules.set(owner, current ? mergeBox(current, box) : box);
    }
  const obstacles = room.obstacles ?? [];
  const crossed = new Set<string>();
  const obstacleIssues: FitIssue[] = [];
  const offset = roomOffset(room, g.bounds);
  const gap = wallGap(room, g.bounds);
  for (const obstacle of obstacles) {
    // A TV é da parede, não do móvel: fica na frente do painel e acima do
    // rack de propósito, então não conta como obstáculo.
    if (obstacle.kind === 'tv') continue;
    // O ambiente conta x do canto esquerdo; a composição começa no afastamento.
    const minX = obstacle.xMm - offset + g.bounds.min[0];
    const maxX = minX + obstacle.widthMm;
    const area: Box = {
      minX,
      maxX,
      minY: obstacle.yMm,
      maxY: obstacle.yMm + obstacle.heightMm,
    };
    // `module` é palavra reservada na regra do Next: usar outro nome.
    for (const movel of design.modules) {
      const box = modules.get(movel.id);
      if (!box || !crosses(area, box)) continue;
      crossed.add(obstacle.id);
      const who = obstacle.label ?? KIND_WORD[obstacle.kind];
      obstacleIssues.push({
        code: 'obstacle-overlap',
        message: `${who} (x de ${plain(obstacle.xMm)} a ${plain(obstacle.xMm + obstacle.widthMm)} na parede) cruza o módulo ${movel.name}`,
        detail: `O obstáculo vai de ${plain(area.minY)} a ${plain(area.maxY)} do piso; o módulo ocupa de ${plain(box.minY)} a ${plain(box.maxY)}.`,
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
  issues.push(...obstacleIssues);
  // Painel e módulo suspenso vão presos na parede: não precisam tocar o piso.
  const hung = design.modules.every((m) => m.kind === 'panel' || m.wall);
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
  const checked = obstacles.filter((o) => o.kind !== 'tv');
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
  return { fits: issues.length === 0, issues, notes, crossed: [...crossed] };
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
