import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/**
 * Linha de "corte aqui" na cena: tracejado escuro no contorno da face grande
 * da peça, como o pontilhado de recortar com a tesoura. Vem do plano de
 * corte: a peça sob o cursor ganha o tracejado e a tesoura (posta pela vista,
 * em HTML); a chapa sob o cursor, o tracejado mais fino em todas as peças.
 * Nada anima nem brilha: é desenho parado, que respeita a profundidade.
 */
export type CutMarkMode = 'sheet' | 'piece';
export type CutMarkTarget = { mesh: THREE.Mesh; size: readonly number[] };

export const CUT_MARK = { color: '#1d1a16', dash: 26, gap: 16 } as const;
/** Espessura do tracejado em px: mais firme na peça, leve na chapa inteira. */
const WIDTH = { piece: 2.6, sheet: 1.6 } as const;
/** Quanto o tracejado sai da face (mm), para não brigar com a própria face. */
const LIFT_MM = 1;

/** Eixos da peça: a espessura (`thin`) e os dois da face grande. */
export function faceAxes(size: readonly number[]) {
  const thin = size.indexOf(Math.min(...size));
  const [a, b] = [0, 1, 2].filter((i) => i !== thin);
  return { thin, a, b };
}

/**
 * Tracejado nas duas faces grandes de cada peça. O tracejado mora num grupo
 * que desfaz a escala da caixa unitária: as posições e os traços ficam em mm,
 * sem esticar numa lateral de 1,8 m.
 */
export function buildCutMarks(targets: CutMarkTarget[], mode: CutMarkMode, resolution: THREE.Vector2) {
  const material = new LineMaterial({
    color: CUT_MARK.color,
    linewidth: WIDTH[mode],
    dashed: true,
    dashSize: CUT_MARK.dash,
    gapSize: CUT_MARK.gap,
    resolution,
  });
  const holders: { mesh: THREE.Mesh; group: THREE.Group; geometries: LineGeometry[] }[] = [];
  for (const { mesh, size } of targets) {
    const { thin, a, b } = faceAxes(size);
    const group = new THREE.Group();
    group.scale.set(1 / Math.max(size[0], 1), 1 / Math.max(size[1], 1), 1 / Math.max(size[2], 1));
    const geometries: LineGeometry[] = [];
    for (const side of [1, -1]) {
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
        [-1, -1],
      ];
      const positions = corners.flatMap(([u, v]) => {
        const p = [0, 0, 0];
        p[a] = (u * size[a]) / 2;
        p[b] = (v * size[b]) / 2;
        p[thin] = side * (size[thin] / 2 + LIFT_MM);
        return p;
      });
      const geo = new LineGeometry();
      geo.setPositions(positions);
      const line = new Line2(geo, material);
      line.computeLineDistances();
      line.renderOrder = 2;
      group.add(line);
      geometries.push(geo);
    }
    mesh.add(group);
    holders.push({ mesh, group, geometries });
  }
  return {
    /** A tela mudou de tamanho: a espessura em px acompanha. */
    resize(width: number, height: number) {
      material.resolution.set(width, height);
    },
    dispose() {
      for (const h of holders) {
        h.mesh.remove(h.group);
        h.geometries.forEach((g) => g.dispose());
      }
      material.dispose();
    },
  };
}

const corner = new THREE.Vector3(),
  normal = new THREE.Vector3(),
  centre = new THREE.Vector3(),
  toCamera = new THREE.Vector3();

/**
 * Onde a tesoura fica na tela: no começo da aresta de cima da face que olha
 * para a câmera, virada ao longo dela, como no "corte aqui". `null` quando a
 * face está de perfil ou atrás da câmera.
 */
export function scissorsPose(
  mesh: THREE.Mesh,
  size: readonly number[],
  camera: THREE.Camera,
  width: number,
  height: number,
) {
  const { thin, a, b } = faceAxes(size);
  mesh.updateWorldMatrix(true, false);
  normal.set(0, 0, 0).setComponent(thin, 1).transformDirection(mesh.matrixWorld);
  mesh.getWorldPosition(centre);
  const side = normal.dot(toCamera.copy(camera.position).sub(centre)) >= 0 ? 1 : -1;
  const screen = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => {
    corner.set(0, 0, 0).setComponent(a, u / 2).setComponent(b, v / 2).setComponent(thin, side / 2);
    mesh.localToWorld(corner).project(camera);
    return { x: ((corner.x + 1) / 2) * width, y: ((1 - corner.y) / 2) * height, behind: corner.z > 1 };
  });
  if (screen.some((p) => p.behind)) return null;
  let best: { from: (typeof screen)[number]; to: (typeof screen)[number] } | null = null;
  for (let i = 0; i < 4; i++) {
    const p = screen[i],
      q = screen[(i + 1) % 4];
    if (Math.hypot(q.x - p.x, q.y - p.y) < 28) continue;
    const [from, to] = p.x <= q.x ? [p, q] : [q, p];
    if (!best || (p.y + q.y) / 2 < (best.from.y + best.to.y) / 2) best = { from, to };
  }
  if (!best) return null;
  const angle = Math.atan2(best.to.y - best.from.y, best.to.x - best.from.x);
  // As lâminas encostam no começo do tracejado; o cabo fica para fora.
  return {
    x: best.from.x - Math.cos(angle) * 11,
    y: best.from.y - Math.sin(angle) * 11,
    angle: (angle * 180) / Math.PI,
  };
}
