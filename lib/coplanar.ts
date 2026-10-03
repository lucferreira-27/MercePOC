import type { ModularPart } from './composition';

type Vec = [number, number, number];

/**
 * Faces que a placa de vídeo não separa: duas caixas de cores diferentes com
 * uma face no mesmo plano, virada para o mesmo lado, cobrindo a mesma área.
 * A profundidade empata e a cena pisca em dente de serra ao girar
 * (z-fighting), como o contorno de aço rente à lateral no industrial.
 */
export type SceneBox = { id: string; color: string; min: Vec; max: Vec };
export type CoplanarFace = { a: string; b: string; axis: 0 | 1 | 2; side: -1 | 1; at: number; area: number };

const norm = (c: string) => c.replace('#', '').toLowerCase();

/** Caixa alinhada aos eixos de uma peça girada no eixo vertical (graus ou radianos, múltiplos de 90°). */
function aabb(size: readonly number[], position: readonly number[], rotation = 0): { min: Vec; max: Vec } {
  const rad = Math.abs(rotation) > 2 * Math.PI + 1e-6 ? (rotation * Math.PI) / 180 : rotation;
  const c = Math.abs(Math.cos(rad)),
    s = Math.abs(Math.sin(rad));
  const hx = (size[0] * c + size[2] * s) / 2,
    hz = (size[0] * s + size[2] * c) / 2,
    hy = size[1] / 2;
  return { min: [position[0] - hx, position[1] - hy, position[2] - hz], max: [position[0] + hx, position[1] + hy, position[2] + hz] };
}

/**
 * As peças como a cena 3D as desenha: uma caixa por peça de corte. Ficam de
 * fora o desenho de superfície (`decal`), o pé inclinado (`slant`, a cena tem
 * a forma de verdade) e a basculante aberta (`tilt`).
 */
export function partBoxes(parts: readonly ModularPart[]): SceneBox[] {
  return parts.filter((p) => !p.decal && !p.slant && !p.tilt).map((p) => ({ id: p.id, color: norm(p.color), ...aabb(p.size, p.position, p.rotation) }));
}

/**
 * Pares de caixas de cores diferentes com uma face no mesmo plano, para o
 * mesmo lado, sobrepostas em mais de `minArea` mm². Faces encostadas de
 * costas (o pé sob a caixa) não contam: uma esconde a outra.
 */
export function coplanarFaces(boxes: readonly SceneBox[], tol = 0.05, minArea = 4): CoplanarFace[] {
  const out: CoplanarFace[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!,
        b = boxes[j]!;
      if (a.color === b.color) continue;
      for (const axis of [0, 1, 2] as const) {
        const [u, v] = [0, 1, 2].filter((k) => k !== axis) as [number, number];
        const area = Math.max(0, Math.min(a.max[u]!, b.max[u]!) - Math.max(a.min[u]!, b.min[u]!)) * Math.max(0, Math.min(a.max[v]!, b.max[v]!) - Math.max(a.min[v]!, b.min[v]!));
        if (area <= minArea) continue;
        if (Math.abs(a.max[axis]! - b.max[axis]!) <= tol) out.push({ a: a.id, b: b.id, axis, side: 1, at: a.max[axis]!, area });
        if (Math.abs(a.min[axis]! - b.min[axis]!) <= tol) out.push({ a: a.id, b: b.id, axis, side: -1, at: a.min[axis]!, area });
      }
    }
  return out;
}
