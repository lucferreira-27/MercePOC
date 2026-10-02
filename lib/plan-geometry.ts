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

type Bounds = { min: number[]; max: number[] };
const EPS = 0.5;
/**
 * -1: `a` fica atrás de `b` (pinta antes); 1: na frente; 0: sem plano que
 * separe as duas caixas. Olho no +x/+y/+z (isométrica) ou no +z (frontal):
 * um plano de eixo que separa as duas caixas decide quem tapa quem, seja
 * qual for o tamanho de cada uma.
 */
function compare(a: Bounds, b: Bounds, view: ViewKind) {
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
  const key = parts.map((p) => depthOf(p, view));
  const after: number[][] = Array.from({ length: n }, () => []);
  const pending: number[] = Array.from({ length: n }, () => 0);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const [a, b] = [screen[i], screen[j]];
      if (a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]) continue;
      const c = compare(bounds[i], bounds[j], view);
      if (!c) continue;
      const [back, fore] = c < 0 ? [i, j] : [j, i];
      after[back].push(fore);
      pending[fore]++;
    }
  const out: ModularPart[] = [];
  const done: boolean[] = Array.from({ length: n }, () => false);
  for (let k = 0; k < n; k++) {
    let pick = -1;
    for (let i = 0; i < n; i++) if (!done[i] && !pending[i] && (pick < 0 || key[i] < key[pick])) pick = i;
    if (pick < 0) for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || key[i] < key[pick])) pick = i;
    done[pick] = true;
    out.push(parts[pick]);
    for (const f of after[pick]) pending[f]--;
  }
  return out;
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

