import { applyModularOp, type Composition, type ModularOp, type ModularPart } from './composition';
import { drawingParts } from './fittings';

/**
 * Mover um móvel à mão, na cena: o conjunto que se move, o encaixe nas bordas
 * dos vizinhos e a checagem de colisão antes de gravar. Um módulo conectado
 * anda com o conjunto inteiro (a raiz e tudo que está preso nela), porque a
 * posição de um filho vem da conexão, não dele mesmo.
 */
export type Vec3 = [number, number, number];
export type Box = { min: Vec3; max: Vec3 };
export type MoveGroup = {
  /** Módulo raiz: é a posição dele que muda. */
  root: string;
  /** Raiz e descendentes, na ordem da composição. */
  members: string[];
  /** Nome curto para a interface: "Estante" ou "Estante + 2". */
  label: string;
};

/** Passo da grade ao arrastar e do toque numa seta, em mm. */
export const MOVE_GRID = 10;
/** Distância em que a borda gruda na borda do vizinho, em mm. */
export const MOVE_SNAP = 60;

/**
 * Como o arrasto anda: `lockHeight` segura a altura (o móvel desliza no
 * piso, o comum) e `axis` deixa só a direção dominante (esquerda/direita,
 * frente/fundo ou, destravada, altura), para alinhar sem tremer.
 */
export type DragMode = { lockHeight: boolean; axis: boolean };
export const DEFAULT_DRAG_MODE: DragMode = { lockHeight: true, axis: false };

/** Aplica o modo ao deslocamento cru do arrasto. */
export function constrainDrag(raw: Vec3, mode: DragMode): Vec3 {
  const out: Vec3 = [raw[0], mode.lockHeight ? 0 : raw[1], raw[2]];
  if (!mode.axis) return out;
  let keep = 0;
  for (const i of [1, 2]) if (Math.abs(out[i]) > Math.abs(out[keep])) keep = i;
  return out.map((v, i) => (i === keep ? v : 0)) as Vec3;
}

/** Depois do encaixe: o que o modo travou continua parado. */
export function lockedAxes(raw: Vec3, mode: DragMode): boolean[] {
  const c = constrainDrag(raw, mode);
  return [0, 1, 2].map((i) => (i === 1 && mode.lockHeight) || (mode.axis && c[i] === 0));
}

export function rootOf(d: Composition, moduleId: string) {
  let id = moduleId;
  for (let guard = 0; guard < d.modules.length; guard++) {
    const parent = d.connections.find((c) => c.child === id)?.parent;
    if (!parent) break;
    id = parent;
  }
  return id;
}

export function moveGroup(d: Composition, moduleId: string): MoveGroup | null {
  if (!d.modules.some((m) => m.id === moduleId)) return null;
  const root = rootOf(d, moduleId);
  const members = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of d.connections)
      if (members.has(c.parent) && !members.has(c.child)) {
        members.add(c.child);
        grew = true;
      }
  }
  const ordered = d.modules.filter((m) => members.has(m.id)).map((m) => m.id);
  const name = d.modules.find((m) => m.id === root)!.name;
  return { root, members: ordered, label: ordered.length > 1 ? `${name} + ${ordered.length - 1}` : name };
}

/**
 * O conjunto que a seleção aponta: só quando todas as peças selecionadas são
 * de um mesmo conjunto. Seleção espalhada por dois móveis não move nada.
 */
export function selectedGroup(d: Composition, parts: readonly { id: string; owners?: string[] }[], selected: readonly string[]) {
  if (!selected.length) return null;
  const byId = new Map(parts.map((p) => [p.id, p]));
  let group: MoveGroup | null = null;
  for (const id of selected) {
    const owner = byId.get(id)?.owners?.[0] ?? (d.modules.some((m) => m.id === id) ? id : undefined);
    if (!owner) continue;
    const g = moveGroup(d, owner);
    if (!g) continue;
    if (group && group.root !== g.root) return null;
    group = g;
  }
  return group;
}

function partBox(p: ModularPart): Box {
  const c = Math.abs(Math.cos(p.rotation ?? 0)),
    s = Math.abs(Math.sin(p.rotation ?? 0));
  const half: Vec3 = [(c * p.size[0] + s * p.size[2]) / 2, p.size[1] / 2, (s * p.size[0] + c * p.size[2]) / 2];
  return {
    min: [p.position[0] - half[0], p.position[1] - half[1], p.position[2] - half[2]],
    max: [p.position[0] + half[0], p.position[1] + half[1], p.position[2] + half[2]],
  };
}
function merge(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  return {
    min: [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i]))) as Vec3,
    max: [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.max[i]))) as Vec3,
  };
}

/** Caixa de cada módulo no mundo, pelas peças de desenho (com os pés). */
export function moduleBoxes(d: Composition) {
  const parts = drawingParts(d);
  const boxes = new Map<string, Box>();
  for (const m of d.modules) {
    const box = merge(parts.filter((p) => p.owners[0] === m.id).map(partBox));
    if (box) boxes.set(m.id, box);
  }
  return boxes;
}

/**
 * Arrasto cru → deslocamento final: grade de 10 mm, depois a borda gruda na
 * borda de um vizinho (encostar lado a lado, alinhar frente, fundo, topo) ou
 * volta ao lugar de origem quando passa perto. O piso é o limite de baixo.
 */
export function snapDelta(d: Composition, group: MoveGroup, raw: Vec3, boxes = moduleBoxes(d), wallZ?: number): Vec3 {
  const members = new Set(group.members);
  const mine = merge(group.members.map((id) => boxes.get(id)).filter((b): b is Box => !!b));
  const delta = raw.map((v) => Math.round(v / MOVE_GRID) * MOVE_GRID || 0) as Vec3;
  if (!mine) return delta;
  const others = [...boxes].filter(([id]) => !members.has(id)).map(([, b]) => b);
  const pick = (axis: 0 | 1 | 2, candidates: number[]) => {
    let best = delta[axis],
      gap = MOVE_SNAP;
    for (const c of candidates) {
      const g = Math.abs(c - raw[axis]);
      if (g < gap) [best, gap] = [c, g];
    }
    delta[axis] = best;
  };
  pick(0, [0, ...others.flatMap((o) => [o.max[0] - mine.min[0], o.min[0] - mine.max[0], o.min[0] - mine.min[0], o.max[0] - mine.max[0]])]);
  pick(2, [0, ...(wallZ === undefined ? [] : [wallZ - mine.min[2]]), ...others.flatMap((o) => [o.min[2] - mine.min[2], o.max[2] - mine.max[2]])]);
  // A parede é o limite de trás: o fundo do móvel encosta, não atravessa.
  if (wallZ !== undefined) delta[2] = Math.max(delta[2], Math.min(0, wallZ - mine.min[2]));
  pick(1, [0, -mine.min[1], ...others.flatMap((o) => [o.max[1] - mine.max[1], o.min[1] - mine.min[1]])]);
  // Nada abaixo do piso: a raiz guarda o chão do conjunto em position[1].
  const root = d.modules.find((m) => m.id === group.root)!;
  delta[1] = Math.max(delta[1], -root.position[1], -mine.min[1]);
  return delta.map((v) => v || 0) as Vec3;
}

/**
 * Conferência rápida durante o arrasto: a caixa do conjunto deslocado contra a
 * de cada vizinho. A regra completa (peça por peça) roda ao soltar.
 */
export function quickBlock(d: Composition, group: MoveGroup, delta: Vec3, boxes = moduleBoxes(d)): string | null {
  const members = new Set(group.members);
  const TOUCH = 1;
  for (const id of group.members) {
    const a = boxes.get(id);
    if (!a) continue;
    for (const [other, b] of boxes) {
      if (members.has(other)) continue;
      const hit = [0, 1, 2].every((i) => Math.min(a.max[i] + delta[i], b.max[i]) - Math.max(a.min[i] + delta[i], b.min[i]) > TOUCH);
      if (hit) return d.modules.find((m) => m.id === other)?.name ?? other;
    }
  }
  return null;
}

export function moveOp(d: Composition, group: MoveGroup, delta: Vec3): ModularOp {
  const root = d.modules.find((m) => m.id === group.root)!;
  return {
    kind: 'module.edit',
    id: root.id,
    position: root.position.map((v, i) => Math.round(v + delta[i])) as Vec3,
  };
}

export function rotateOp(d: Composition, group: MoveGroup, turn: 90 | -90 = 90): ModularOp {
  const root = d.modules.find((m) => m.id === group.root)!;
  return { kind: 'module.edit', id: root.id, rotation: (((root.rotation + turn) % 360) + 360) % 360 as 0 | 90 | 180 | 270 };
}

/**
 * Aplica a operação sem gravar, com as mesmas regras do servidor: devolve o
 * projeto ou o motivo em uma frase ("Módulos sobrepostos: ...").
 */
export function tryOp(d: Composition, op: ModularOp): { ok: true; design: Composition } | { ok: false; reason: string } {
  try {
    return { ok: true, design: applyModularOp(d, op) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Distância em texto curto para a etiqueta do arrasto: "12 cm", "1,25 m". */
export function shortMm(mm: number) {
  const a = Math.abs(mm);
  if (a >= 1000) return `${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m`;
  if (a >= 10) return `${Math.round(a / 10)} cm`;
  return `${Math.round(a)} mm`;
}
