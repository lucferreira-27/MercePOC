import type { ModularPart } from './composition';

/**
 * Desenho do projeto em SVG puro (frontal e isométrica), sem dependência de
 * servidor: o `plan-render` rasteriza para a IA e a interface usa o mesmo
 * desenho como miniatura de projeto e de modelo.
 */
export type ViewKind = 'front' | 'iso';
type Vec3 = readonly [number, number, number];

export type Panel = {
  /** Polígono em coordenadas da imagem, já projetado e enquadrado. */
  points: [number, number][];
  kind: ModularPart['kind'];
  tone: string;
  /** Quanto maior, mais perto do olho: a ordem de pintura é crescente. */
  depth: number;
};

export type PlanGeometry = {
  width: number;
  height: number;
  panels: Panel[];
  /** Silhueta no chão, para o desenho não flutuar. */
  ground: [number, number][];
};

const PANEL_WIDTH = 460;
const PANEL_HEIGHT = 620;
const MARGIN = 26;
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

/** Material do corpo e tom das frentes, do fundo e das prateleiras. */
function tones(part: ModularPart) {
  const base = part.color || '#c9a06a';
  if (part.kind === 'back') return { face: shade(base, 0.9), edge: '#b9b2a5' };
  if (part.kind === 'door') return { face: shade(base, 1.12), edge: '#8d7a5c' };
  if (part.kind === 'drawer') return { face: shade(base, 1.04), edge: '#8d7a5c' };
  if (part.kind === 'shelf' || part.kind === 'divider')
    return { face: shade(base, 0.97), edge: '#a9998a' };
  return { face: base, edge: '#8d7a5c' };
}

function shade(hex: string, factor: number) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(value)) return hex;
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const r = clamp(((value >> 16) & 255) * factor);
  const g = clamp(((value >> 8) & 255) * factor);
  const b = clamp((value & 255) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Os oito cantos da peça no mundo, já girados em torno do eixo vertical. */
export function cornersOf(part: ModularPart): Vec3[] {
  const a = part.rotation ?? 0;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const [w, h, d] = part.size;
  const [px, py, pz] = part.position;
  const [ox, oz] = part.slant ?? [0, 0];
  const out: Vec3[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        // Pé inclinado e cônico: a base anda `slant` e afina `taper`.
        const k = sy < 0 ? (part.taper ?? 1) : 1;
        const x = (sx * w * k) / 2 + (sy < 0 ? ox / 2 : -ox / 2);
        const z = (sz * d * k) / 2 + (sy < 0 ? oz / 2 : -oz / 2);
        out.push([
          px + x * cos + z * sin,
          py + (sy * h) / 2,
          pz - x * sin + z * cos,
        ]);
      }
  return out;
}

/**
 * Projeção de cada vista. A frontal olha pelo eixo da profundidade (x para a
 * direita, y para cima); a isométrica é a mesma do cartão de mudança, com o
 * olho no octante +x/+y/+z, de onde se vê o tampo e as duas faces de frente.
 */
export function project(p: Vec3, view: ViewKind): [number, number] {
  if (view === 'front') return [p[0], -p[1]];
  return [(p[0] - p[2]) * COS30, (p[0] + p[2]) * SIN30 - p[1]];
}

/**
 * As faces visíveis de uma caixa, cada uma com o seu tom: tampo mais claro,
 * lateral direita no meio, frente mais escura. Desenhar uma face por polígono
 * é o que faz o volume aparecer: com uma só, a isométrica mostrava apenas os
 * painéis horizontais e as laterais sumiam.
 */
function visibleFaces(
  corners: Vec3[],
  view: ViewKind,
  base: string,
): { points: [number, number][]; tone: string; order: number }[] {
  const index = (sx: number, sy: number, sz: number) =>
    corners[(sx > 0 ? 1 : 0) * 4 + (sy > 0 ? 1 : 0) * 2 + (sz > 0 ? 1 : 0)];
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) =>
    [a, b, c, d].map((v) => project(v, view));
  if (view === 'front') {
    // Sem profundidade na imagem: a face de frente (+z) é a única que importa.
    return [
      {
        points: quad(index(-1, -1, 1), index(1, -1, 1), index(1, 1, 1), index(-1, 1, 1)),
        tone: shade(base, 1),
        order: 0,
      },
    ];
  }
  return [
    {
      points: quad(index(-1, 1, -1), index(1, 1, -1), index(1, 1, 1), index(-1, 1, 1)),
      tone: shade(base, 1.06),
      order: 0,
    },
    {
      points: quad(index(1, -1, -1), index(1, 1, -1), index(1, 1, 1), index(1, -1, 1)),
      tone: shade(base, 0.86),
      order: 1,
    },
    {
      points: quad(index(-1, -1, 1), index(1, -1, 1), index(1, 1, 1), index(-1, 1, 1)),
      tone: shade(base, 0.71),
      order: 2,
    },
  ];
}

function depthOf(part: ModularPart, view: ViewKind) {
  const [x, , z] = part.position;
  return view === 'front' ? z : x + z + part.position[1] / 1000;
}

export type Bounds = { min: number[]; max: number[] };
const EPS = 0.5;
/**
 * -1: `a` fica atrás de `b` (pinta antes); 1: na frente; 0: sem plano que
 * separe as duas caixas. Olho no +x/+y/+z (isométrica) ou no +z (frontal):
 * um plano de eixo que separa as duas caixas decide quem tapa quem, seja
 * qual for o tamanho de cada uma.
 */
export function compare(a: Bounds, b: Bounds, view: ViewKind) {
  // Separadas em dois eixos com sentidos opostos (uma à esquerda e acima da
  // outra), nenhum raio do olho passa pelas duas: não se tapam, e a caixa
  // envolvente da imagem que se cruzava criava um ciclo falso.
  let sign = 0;
  for (const axis of view === 'front' ? [2] : [0, 2, 1]) {
    const s = a.max[axis] <= b.min[axis] + EPS ? -1 : b.max[axis] <= a.min[axis] + EPS ? 1 : 0;
    if (!s) continue;
    if (sign && s !== sign) return 0;
    sign = s;
  }
  return sign;
}

/**
 * Os dois contornos convexos se cobrem na imagem (eixo separador, com folga
 * de `m`): pela caixa envolvente da imagem, o nível e o travessão lá no alto
 * do fundo "se cruzavam" e fechavam um ciclo falso.
 */
function hullsOverlap(a: [number, number][], b: [number, number][], m = 0.5) {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const [p, q] = [poly[i], poly[(i + 1) % poly.length]];
      const n = [q[1] - p[1], p[0] - q[0]];
      const len = Math.hypot(n[0], n[1]);
      if (!len) continue;
      const proj = (v: [number, number]) => (v[0] * n[0] + v[1] * n[1]) / len;
      const [a0, a1] = [Math.min(...a.map(proj)), Math.max(...a.map(proj))];
      const [b0, b1] = [Math.min(...b.map(proj)), Math.max(...b.map(proj))];
      if (a1 <= b0 + m || b1 <= a0 + m) return false;
    }
  return true;
}

/** Componentes fortemente conexas (Tarjan, sem recursão): o mesmo número para as peças de um ciclo. */
function components(next: readonly number[][]): number[] {
  const n = next.length;
  const index = Array<number>(n).fill(-1), low = Array<number>(n).fill(0), comp = Array<number>(n).fill(-1);
  const stack: number[] = [], on = Array<boolean>(n).fill(false);
  let counter = 0, groups = 0;
  for (let root = 0; root < n; root++) {
    if (index[root] >= 0) continue;
    const work: [number, number][] = [[root, 0]];
    while (work.length) {
      const top = work[work.length - 1];
      const [v, e] = top;
      if (e === 0) { index[v] = low[v] = counter++; stack.push(v); on[v] = true; }
      if (e < next[v].length) {
        top[1]++;
        const w = next[v][e];
        if (index[w] < 0) work.push([w, 0]);
        else if (on[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      work.pop();
      if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
      if (low[v] === index[v]) {
        let w: number;
        do { w = stack.pop()!; on[w] = false; comp[w] = groups; } while (w !== v);
        groups++;
      }
    }
  }
  return comp;
}

/**
 * Ordem dentro de um ciclo: a cada passo, a peça que fura menos restrições
 * (menos peças do ciclo ainda por pintar que deviam vir antes dela); empate
 * pelo centro. Só pelo centro, um travessão embaixo do nível era pintado por
 * cima dele, porque o pé que fechava o ciclo puxava tudo.
 */
function breakCycle(members: number[], after: readonly number[][], key: readonly number[]): number[] {
  if (members.length === 1) return members;
  const inside = new Set(members);
  const pending = new Map(members.map((i) => [i, 0]));
  for (const i of members) for (const f of after[i]) if (inside.has(f)) pending.set(f, pending.get(f)! + 1);
  const out: number[] = [];
  const left = new Set(members);
  while (left.size) {
    let pick = -1;
    for (const i of left) if (pick < 0 || pending.get(i)! < pending.get(pick)! || (pending.get(i) === pending.get(pick) && key[i] < key[pick])) pick = i;
    left.delete(pick);
    out.push(pick);
    for (const f of after[pick]) if (left.has(f)) pending.set(f, pending.get(f)! - 1);
  }
  return out;
}

/**
 * Ordem de pintura do fundo para a frente. Pelo centro só, um tampo comprido
 * que cobre três módulos tinha o centro no do meio e o tampo do último
 * módulo, embaixo dele, era pintado por cima. Aqui cada par que se cruza na
 * imagem é ordenado pelo plano que separa as caixas; sem plano (caixas que se
 * encostam por dentro), vale o centro. Ciclo raro se desfaz pelo centro.
 */
export function paintOrder(parts: readonly ModularPart[], view: ViewKind): ModularPart[] {
  const n = parts.length;
  const corners = parts.map(cornersOf);
  const bounds: Bounds[] = corners.map((c) => ({
    min: [0, 1, 2].map((i) => Math.min(...c.map((v) => v[i]))),
    max: [0, 1, 2].map((i) => Math.max(...c.map((v) => v[i]))),
  }));
  const screen = corners.map((c) => {
    const pts = c.map((v) => project(v, view));
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  });
  const hulls = corners.map((c) => hullOf(c.map((v) => project(v, view))));
  const key = parts.map((p) => depthOf(p, view));
  const after: number[][] = Array.from({ length: n }, () => []);
  const pending: number[] = Array.from({ length: n }, () => 0);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const [a, b] = [screen[i], screen[j]];
      if (a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1] || !hullsOverlap(hulls[i], hulls[j])) continue;
      const c = compare(bounds[i], bounds[j], view);
      if (!c) continue;
      const [back, fore] = c < 0 ? [i, j] : [j, i];
      after[back].push(fore);
      pending[fore]++;
    }
  // Ciclo (caixas que se cruzam por dentro) se desfaz só entre as peças dele:
  // antes a saída pegava a peça mais ao fundo de todas as que esperavam, e o
  // tampo, fora do ciclo, era pintado antes das laterais e ficava por baixo.
  const comp = components(after);
  const groups = Math.max(-1, ...comp) + 1;
  const gAfter: Set<number>[] = Array.from({ length: groups }, () => new Set());
  const gPending: number[] = Array.from({ length: groups }, () => 0);
  for (let i = 0; i < n; i++) for (const f of after[i]) if (comp[i] !== comp[f] && !gAfter[comp[i]].has(comp[f])) { gAfter[comp[i]].add(comp[f]); gPending[comp[f]]++; }
  const members: number[][] = Array.from({ length: groups }, () => []);
  for (let i = 0; i < n; i++) members[comp[i]].push(i);
  const depth = members.map((m) => Math.min(...m.map((i) => key[i])));
  const out: ModularPart[] = [];
  const done: boolean[] = Array.from({ length: groups }, () => false);
  for (let k = 0; k < groups; k++) {
    let pick = -1;
    for (let g = 0; g < groups; g++) if (!done[g] && !gPending[g] && (pick < 0 || depth[g] < depth[pick])) pick = g;
    done[pick] = true;
    out.push(...breakCycle(members[pick], after, key).map((i) => parts[i]));
    for (const f of gAfter[pick]) gPending[f]--;
  }
  return out;
}

/**
 * Pares pintados na ordem errada: as duas peças se cruzam na imagem, um plano
 * separa as caixas e a de trás saiu pintada por cima. Acontece quando um
 * ciclo se desfaz pelo centro, e no desenho aparece como lateral cobrindo o
 * tampo do vizinho ou puxador sumido atrás da frente.
 */
export function paintConflicts(parts: readonly ModularPart[], view: ViewKind): [ModularPart, ModularPart][] {
  const ordered = paintOrder(parts, view);
  const rank = new Map(ordered.map((p, i) => [p, i]));
  const corners = parts.map(cornersOf);
  const bounds: Bounds[] = corners.map((c) => ({ min: [0, 1, 2].map((i) => Math.min(...c.map((v) => v[i]))), max: [0, 1, 2].map((i) => Math.max(...c.map((v) => v[i]))) }));
  const screen = corners.map((c) => {
    const pts = c.map((v) => project(v, view));
    return [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
  });
  const out: [ModularPart, ModularPart][] = [];
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const [a, b] = [screen[i], screen[j]];
      if (a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]) continue;
      if (!hullsOverlap(hullOf(corners[i].map((v) => project(v, view))), hullOf(corners[j].map((v) => project(v, view))))) continue;
      const c = compare(bounds[i], bounds[j], view);
      if (!c) continue;
      const [back, fore] = c < 0 ? [parts[i], parts[j]] : [parts[j], parts[i]];
      if (rank.get(back)! > rank.get(fore)!) out.push([back, fore]);
    }
  return out;
}

/** Ponto dentro do polígono convexo (casca), com folga `m` para não contar a borda. */
function insideHull(hull: [number, number][], u: number, v: number, m: number) {
  let sign = 0;
  for (let i = 0; i < hull.length; i++) {
    const [a, b] = [hull[i], hull[(i + 1) % hull.length]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const c = ((b[0] - a[0]) * (v - a[1]) - (b[1] - a[1]) * (u - a[0])) / len;
    if (Math.abs(c) < m) return false;
    const s = Math.sign(c);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}
function hullOf(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Até onde o raio do olho atravessa a caixa da peça (o parâmetro da saída,
 * maior é mais perto do olho), ou -Infinity se não passa por ela. O raio sai
 * do ponto `o` no sentido `d` (o olho fica no infinito desse sentido).
 */
function rayExit(part: ModularPart, o: Vec3, d: Vec3) {
  const a = part.rotation ?? 0;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  // Para o referencial da peça (giro só em y).
  const rel = [o[0] - part.position[0], o[1] - part.position[1], o[2] - part.position[2]];
  const lo = [rel[0] * c - rel[2] * s, rel[1], rel[0] * s + rel[2] * c];
  const ld = [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c];
  let t0 = -Infinity, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    const h = part.size[i] / 2;
    if (Math.abs(ld[i]) < 1e-9) {
      if (Math.abs(lo[i]) > h) return -Infinity;
      continue;
    }
    let [ta, tb] = [(-h - lo[i]) / ld[i], (h - lo[i]) / ld[i]];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  return t0 <= t1 ? t1 : -Infinity;
}

export type DrawingFault = { hidden: ModularPart; over: ModularPart; samples: number };

/**
 * Desenho errado, conferido contra a verdade: em pontos da imagem (a cada
 * `step` mm), a peça que o pintor deixa por cima tem de ser a que o raio do
 * olho encontra primeiro. Pega peça de trás pintada por cima da da frente
 * (lateral cobrindo o tampo do vizinho, puxador sumido atrás da frente),
 * venha de ciclo, de caixa que se cruza ou de erro na ordem. Pé inclinado,
 * que não é caixa, fica de fora.
 */
export function drawingFaults(parts: readonly ModularPart[], view: ViewKind, step = 12, paint: (parts: ModularPart[]) => ModularPart[] = (v) => paintOrder(v, view)): DrawingFault[] {
  const solid = parts.filter((p) => !p.slant && p.size.every((v) => v > 0));
  const ordered = paint(solid);
  const rank = new Map(ordered.map((p, i) => [p, i]));
  const hulls = solid.map((p) => hullOf(cornersOf(p).map((v) => project(v, view))));
  const d: Vec3 = view === 'front' ? [0, 0, 1] : [1, 1, 1];
  // O ponto da imagem (u, v) de volta para o mundo, no plano y = 0 (isométrica) ou z = 0 (frontal).
  const origin = (u: number, v: number): Vec3 => (view === 'front' ? [u, -v, 0] : [(u / COS30 + v / SIN30) / 2, 0, (v / SIN30 - u / COS30) / 2]);
  const box = hulls.flat();
  const [u0, u1] = [Math.min(...box.map((q) => q[0])), Math.max(...box.map((q) => q[0]))];
  const [v0, v1] = [Math.min(...box.map((q) => q[1])), Math.max(...box.map((q) => q[1]))];
  const bounds = hulls.map((h) => [Math.min(...h.map((q) => q[0])), Math.min(...h.map((q) => q[1])), Math.max(...h.map((q) => q[0])), Math.max(...h.map((q) => q[1]))]);
  const world: Bounds[] = solid.map((p) => { const c = cornersOf(p); return { min: [0, 1, 2].map((i) => Math.min(...c.map((q) => q[i]))), max: [0, 1, 2].map((i) => Math.max(...c.map((q) => q[i]))) }; });
  const faults = new Map<string, DrawingFault>();
  for (let u = u0 + step / 2; u < u1; u += step)
    for (let v = v0 + step / 2; v < v1; v += step) {
      let top = -1, near = -1, best = -Infinity;
      const o = origin(u, v);
      for (let i = 0; i < solid.length; i++) {
        const b = bounds[i];
        if (u < b[0] || u > b[2] || v < b[1] || v > b[3] || !insideHull(hulls[i], u, v, 1)) continue;
        if (top < 0 || rank.get(solid[i])! > rank.get(solid[top])!) top = i;
        const t = rayExit(solid[i], o, d);
        if (t > best) [best, near] = [t, i];
      }
      if (top < 0 || near < 0 || top === near) continue;
      // Só conta se a peça pintada por cima está mesmo atrás (não é face encostada).
      if (rayExit(solid[top], o, d) > best - 1) continue;
      // Caixas que se cruzam de propósito (vidro na porta, nível entalhado no pé,
      // contorno rente às faces) não têm uma de trás: fica de fora.
      const [a, c] = [world[top], world[near]];
      if ([0, 1, 2].every((i) => Math.min(a.max[i], c.max[i]) - Math.max(a.min[i], c.min[i]) > 0.5)) continue;
      const k = `${solid[top].id}|${solid[near].id}`;
      const f = faults.get(k) ?? { hidden: solid[near], over: solid[top], samples: 0 };
      f.samples++;
      faults.set(k, f);
    }
  return [...faults.values()];
}

/**
 * Geometria de uma vista: projeta, ordena do fundo para a frente e enquadra na
 * caixa do painel. Separado do SVG para o teste poder conferir o desenho sem
 * depender do texto do arquivo.
 */
export function planView(
  parts: readonly ModularPart[],
  view: ViewKind,
  box: { width: number; height: number } = { width: PANEL_WIDTH, height: PANEL_HEIGHT },
): PlanGeometry {
  // O fundo da cena (a parede atrás do móvel) vem sempre primeiro: pelo
  // centro, uma parede larga passava na frente do painel na isométrica.
  const wall = parts.filter((p) => p.id === 'scene:wall');
  const ordered = [...wall, ...paintOrder(parts.filter((p) => p.id !== 'scene:wall'), view)];
  const raw: { points: [number, number][]; kind: ModularPart['kind']; tone: string; edge: string; depth: number; order: number }[] = [];
  const all: [number, number][] = [];
  for (const part of ordered) {
    const { face, edge } = tones(part);
    const depth = depthOf(part, view);
    for (const item of visibleFaces(cornersOf(part), view, face)) {
      raw.push({ ...item, kind: part.kind, edge, depth });
      all.push(...item.points);
    }
  }
  if (!all.length) return { width: box.width, height: box.height, panels: [], ground: [] };
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const scale = Math.min(
    (box.width - 2 * MARGIN) / Math.max(maxX - minX, 1),
    (box.height - 2 * MARGIN) / Math.max(maxY - minY, 1),
  );
  const offsetX = (box.width - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (box.height - (maxY - minY) * scale) / 2 - minY * scale;
  const fit = (p: [number, number]): [number, number] => [
    Math.round((p[0] * scale + offsetX) * 10) / 10,
    Math.round((p[1] * scale + offsetY) * 10) / 10,
  ];
  const panels: Panel[] = raw.map((item) => ({
    points: item.points.map(fit),
    kind: item.kind,
    tone: item.tone,
    depth: item.depth,
  }));
  const ground = groundOutline(parts, view).map(fit);
  return { width: box.width, height: box.height, panels, ground };
}

/** Silhueta do conjunto no chão: o retângulo externo projetado em y = 0. */
function groundOutline(parts: readonly ModularPart[], view: ViewKind): [number, number][] {
  const corners = parts.flatMap(cornersOf);
  if (!corners.length) return [];
  const minX = Math.min(...corners.map((c) => c[0]));
  const maxX = Math.max(...corners.map((c) => c[0]));
  const minZ = Math.min(...corners.map((c) => c[2]));
  const maxZ = Math.max(...corners.map((c) => c[2]));
  const floor: Vec3[] = [
    [minX, 0, minZ],
    [maxX, 0, minZ],
    [maxX, 0, maxZ],
    [minX, 0, maxZ],
  ];
  return floor.map((p) => project(p, view));
}

function polygon(points: [number, number][], fill: string, stroke: string, width: number) {
  const path = points.map((p) => `${p[0]},${p[1]}`).join(' ');
  return `<polygon points="${path}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`;
}

/**
 * A imagem que vai para a IA: frontal à esquerda, isométrica à direita.
 * Fundo branco de propósito: contraste previsível depois da rasterização.
 */
export function planSvg(parts: readonly ModularPart[]): string {
  const front = planView(parts, 'front');
  const iso = planView(parts, 'iso');
  const width = PANEL_WIDTH * 2;
  const height = PANEL_HEIGHT;
  const draw = (geometry: PlanGeometry, offsetX: number) =>
    [
      `<g transform="translate(${offsetX},0)">`,
      `<rect x="0" y="0" width="${PANEL_WIDTH}" height="${PANEL_HEIGHT}" fill="#ffffff"/>`,
      geometry.ground.length
        ? polygon(geometry.ground, '#00000010', '#00000022', 1)
        : '',
      // A ordem do array já é a de pintura: fundo primeiro, frente por último.
      ...geometry.panels.map((panel) => polygon(panel.points, panel.tone, '#6b6257', 1)),
      `<rect x="0.5" y="0.5" width="${PANEL_WIDTH - 1}" height="${PANEL_HEIGHT - 1}" fill="none" stroke="#e2ded6"/>`,
      '</g>',
    ].join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    draw(front, 0),
    draw(iso, PANEL_WIDTH),
    `</svg>`,
  ].join('');
}

