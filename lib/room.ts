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
  obstacles?: Obstacle[];
};

export type ObstacleKind = 'door' | 'window' | 'outlet' | 'column' | 'other';

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
    kind: z.enum(['door', 'window', 'outlet', 'column', 'other']),
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
    obstacles: z.array(obstacleSchema).max(ROOM_LIMITS.obstacles).optional(),
  })
  .strict();

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
  for (const obstacle of obstacles) {
    // O ambiente conta x do canto esquerdo; a composição, do módulo inicial.
    const minX = obstacle.xMm + g.bounds.min[0];
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
  if (width > room.widthMm)
    issues.push({
      code: 'too-wide',
      message: `O móvel tem ${metres(width)} de largura e a parede tem ${metres(room.widthMm)}`,
      detail: `Passa ${centimetres(width - room.widthMm)} da parede.`,
    });
  if (room.depthMm !== undefined && depth > room.depthMm)
    issues.push({
      code: 'too-deep',
      message: `O móvel tem ${metres(depth)} de profundidade e o ambiente permite ${metres(room.depthMm)}`,
      detail: `Passa ${centimetres(depth - room.depthMm)} do limite do ambiente.`,
    });
  issues.push(...obstacleIssues);
  if (base > ON_FLOOR)
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
  if (obstacles.length && !crossed.size)
    notes.push(
      `${obstacles.length === 1 ? 'Obstáculo conferido' : `${obstacles.length} obstáculos conferidos`}: nenhum cruza o móvel, contado do canto esquerdo da parede.`,
    );
  for (const obstacle of obstacles) {
    if (obstacle.kind !== 'door' || !obstacle.swingMm || crossed.has(obstacle.id))
      continue;
    // Sem saber o lado da dobradiça, o giro é conferido para os dois lados.
    const minX = obstacle.xMm + g.bounds.min[0];
    const maxX = minX + obstacle.widthMm;
    if (
      minX - obstacle.swingMm <= g.bounds.max[0] &&
      maxX + obstacle.swingMm >= g.bounds.min[0]
    )
      notes.push(
        `${obstacle.label ?? KIND_WORD[obstacle.kind]} com giro de ${plain(obstacle.swingMm)}: confira se a folha abre sem bater no móvel.`,
      );
  }
  return { fits: issues.length === 0, issues, notes };
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
  const horizontal = room.widthMm - width;
  if (vertical <= horizontal)
    return `Cabe: ${metres(room.heightMm)} de parede por ${metres(height)} de móvel, folga de ${centimetres(vertical)}`;
  return `Cabe: ${metres(room.widthMm)} de parede por ${metres(width)} de móvel, folga de ${centimetres(horizontal)}`;
}
