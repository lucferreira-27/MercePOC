import { generateComposition, type ModularPart } from './composition';
import { drawingParts } from './fittings';
import { canonical, type Design } from './studio';
import { tvPlacements, wallAt, type ObstacleKind, type Room } from './room';

/**
 * O desenho que a IA confere (render_look) com o que está em volta do móvel:
 * a parede, a TV no plano em que ela encosta, janela, porta, coluna e tomada.
 * Antes ia só o móvel, e um nicho na frente da TV parecia um desenho bom.
 * A TV usa a mesma conta do veredito e da cena 3D (`tvPlacements`).
 */
const LOOK: Record<ObstacleKind, { color: string; depth: number; kind: ModularPart['kind'] }> = {
  tv: { color: '#22262b', depth: 40, kind: 'panel' },
  window: { color: '#b9d3df', depth: 6, kind: 'back' },
  door: { color: '#c9b596', depth: 6, kind: 'back' },
  column: { color: '#d6d0c6', depth: 300, kind: 'side' },
  outlet: { color: '#fbfaf7', depth: 4, kind: 'back' },
  other: { color: '#d9d2c6', depth: 6, kind: 'back' },
};

function flat(id: string, name: string, kind: ModularPart['kind'], color: string, size: [number, number, number], position: [number, number, number]): ModularPart {
  return {
    id,
    name,
    kind,
    size,
    position,
    rotation: 0,
    c: size[0],
    l: size[1],
    thickness: size[2],
    material: name,
    color,
    owners: [],
    edges: { c1: null, c2: null, l1: null, l2: null },
  };
}

export function sceneDrawingParts(design: Design, room: Room | undefined): ModularPart[] {
  const parts = drawingParts(canonical(design));
  if (!room) return parts;
  const g = generateComposition(canonical(design), false);
  const wall = wallAt(room, g.bounds);
  // Recorte: o móvel com margem e o que está na parede perto dele.
  let x0 = g.bounds.min[0] - 350,
    x1 = g.bounds.max[0] + 350,
    y1 = g.bounds.max[1] + 150;
  for (const o of room.obstacles ?? []) {
    const a = wall.x + o.xMm,
      b = a + o.widthMm;
    if (b < x0 - 600 || a > x1 + 600) continue;
    x0 = Math.min(x0, a - 150);
    x1 = Math.max(x1, b + 150);
    y1 = Math.max(y1, o.yMm + o.heightMm + 150);
  }
  x0 = Math.max(x0, wall.x);
  x1 = Math.min(x1, wall.x + room.widthMm);
  y1 = Math.min(y1, room.heightMm);
  const out: ModularPart[] = [flat('scene:wall', 'Parede', 'back', '#ece8e1', [x1 - x0, y1, 4], [(x0 + x1) / 2, y1 / 2, wall.z - 2])];
  const tvs = new Map(tvPlacements(canonical(design), room, g).map((t) => [t.obstacle.id, t.mountZ]));
  for (const o of room.obstacles ?? []) {
    const a = Math.max(x0, wall.x + o.xMm),
      b = Math.min(x1, wall.x + o.xMm + o.widthMm);
    const c = o.yMm,
      d = Math.min(y1, o.yMm + o.heightMm);
    if (b - a < 1 || d - c < 1) continue;
    const look = LOOK[o.kind];
    const back = o.kind === 'tv' ? (tvs.get(o.id) ?? wall.z) : wall.z;
    out.push(flat(`scene:${o.id}`, o.label ?? o.kind, look.kind, look.color, [b - a, d - c, look.depth], [(a + b) / 2, (c + d) / 2, back + look.depth / 2]));
  }
  return [...out, ...parts];
}
