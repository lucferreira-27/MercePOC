import * as THREE from 'three';
import { wallFootprint, type MainWallEdge, type Wall } from './room';
import type { RoomPalette } from './scene-room';
import { FRAME_COLOR } from './scene-obstacles';
import { cmLabel } from './scene-dims';

/**
 * Paredes do ambiente no 3D. Cada parede é um bloco de 1 mm escalado para a
 * medida: arrastar uma alça só muda escala e posição, sem refazer geometria
 * a cada movimento do ponteiro.
 */

/** Onde a parede do fundo está no mundo: canto esquerdo, face, largura e pé-direito. */
export type WallFrame = { x0: number; z: number; width: number; height: number };

type Kit = {
  palette: RoomPalette;
  theme: 'light' | 'dark';
  /** Cruza um módulo do móvel: tinge de vermelho. */
  bad: boolean;
  selected?: boolean;
  /** Prévia de onde vai entrar: translúcida, sem sombra. */
  ghost?: boolean;
  track: (d: { dispose: () => void }) => void;
};

const EDGE = { light: '#a79f90', dark: '#6b7078' };

export function buildWall(w: Wall, kit: Kit) {
  const { palette: c, theme, track } = kit;
  const group = new THREE.Group();
  group.name = `parede ${w.id}`;
  group.userData.wallId = w.id;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  track(geo);
  const color = new THREE.Color(theme === 'dark' ? '#34373c' : '#ece6dc');
  if (kit.bad) color.lerp(new THREE.Color(c.bad), 0.6);
  // Sempre transparente, com opacidade 1: a cena só baixa a opacidade quando a
  // parede fica entre a câmera e o móvel, sem recompilar o material.
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.95,
    transparent: true,
    opacity: kit.ghost ? 0.5 : 1,
    depthWrite: !kit.ghost,
    ...(kit.selected ? { emissive: new THREE.Color(FRAME_COLOR.ok), emissiveIntensity: 0.14 } : {}),
  });
  track(material);
  const body = new THREE.Mesh(geo, material);
  body.castShadow = !kit.ghost;
  body.receiveShadow = true;
  group.add(body);
  // Contorno: dá a espessura e o canto, que no mesmo tom da parede do fundo sumiam.
  const edges = new THREE.EdgesGeometry(geo);
  track(edges);
  const line = new THREE.LineBasicMaterial({
    color: kit.selected || kit.ghost ? FRAME_COLOR.ok : EDGE[theme],
    transparent: true,
    opacity: kit.selected || kit.ghost ? 0.95 : 0.7,
    depthTest: !(kit.selected || kit.ghost),
  });
  track(line);
  const outline = new THREE.LineSegments(edges, line);
  outline.renderOrder = kit.selected ? 20 : 0;
  body.add(outline);
  group.userData.body = body;
  group.userData.material = material;
  return group;
}

/** Leva o bloco à medida e ao lugar da parede. A altura não passa do teto. */
export function layoutWall(group: THREE.Object3D, w: Wall, frame: Pick<WallFrame, 'x0' | 'z' | 'height'>) {
  const f = wallFootprint(w);
  const h = Math.min(w.heightMm, frame.height);
  const body = group.userData.body as THREE.Mesh;
  body.scale.set(f.x1 - f.x0, h, f.z1 - f.z0);
  body.position.set(frame.x0 + (f.x0 + f.x1) / 2, h / 2, frame.z + (f.z0 + f.z1) / 2);
  group.userData.box = new THREE.Box3(
    new THREE.Vector3(frame.x0 + f.x0, 0, frame.z + f.z0),
    new THREE.Vector3(frame.x0 + f.x1, h, frame.z + f.z1),
  );
}

/** Alça de uma parede: as pontas mudam o comprimento, o topo a altura, o pé leva a parede. */
export type WallHandle = MainWallEdge | 'move';

/**
 * Pontos das alças no mundo. Pontas no meio da altura, topo no meio de cima e
 * a alça de mover no pé, no meio da base: nenhuma cai sobre a outra.
 */
export function wallHandlePoints(w: Wall, frame: Pick<WallFrame, 'x0' | 'z' | 'height'>) {
  const f = wallFootprint(w);
  const h = Math.min(w.heightMm, frame.height);
  const X0 = frame.x0 + f.x0,
    X1 = frame.x0 + f.x1,
    Z0 = frame.z + f.z0,
    Z1 = frame.z + f.z1;
  const xc = (X0 + X1) / 2,
    zc = (Z0 + Z1) / 2;
  const along = w.rotation === 0;
  return {
    start: along ? new THREE.Vector3(X0, h / 2, zc) : new THREE.Vector3(xc, h / 2, Z0),
    end: along ? new THREE.Vector3(X1, h / 2, zc) : new THREE.Vector3(xc, h / 2, Z1),
    top: new THREE.Vector3(xc, h, zc),
    move: new THREE.Vector3(xc, 0, zc),
    axis: along ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1),
  };
}

/** Alças da parede do fundo, na face dela: as duas pontas e o topo. */
export function mainHandlePoints(frame: WallFrame) {
  return {
    start: new THREE.Vector3(frame.x0, frame.height / 2, frame.z),
    end: new THREE.Vector3(frame.x0 + frame.width, frame.height / 2, frame.z),
    top: new THREE.Vector3(frame.x0 + frame.width / 2, frame.height, frame.z),
    axis: new THREE.Vector3(1, 0, 0),
  };
}

/** Cota ao vivo do arrasto: a linha no mundo e o rótulo no meio dela. */
export type LiveDim = { a: THREE.Vector3; b: THREE.Vector3; text: string };

/**
 * Cotas do que a alça está mudando: o comprimento em cima da parede, a altura
 * ao lado da ponta, ou, levando a parede, a distância ao canto e à parede do
 * fundo, no piso.
 */
export function wallLiveDims(w: Wall, frame: Pick<WallFrame, 'x0' | 'z' | 'height'>, handle: WallHandle): LiveDim[] {
  const f = wallFootprint(w);
  const h = Math.min(w.heightMm, frame.height);
  const X0 = frame.x0 + f.x0,
    X1 = frame.x0 + f.x1,
    Z0 = frame.z + f.z0,
    Z1 = frame.z + f.z1;
  const xc = (X0 + X1) / 2,
    zc = (Z0 + Z1) / 2;
  const along = w.rotation === 0;
  if (handle === 'start' || handle === 'end') {
    const y = h + 90;
    return [
      along
        ? { a: new THREE.Vector3(X0, y, zc), b: new THREE.Vector3(X1, y, zc), text: cmLabel(w.widthMm) }
        : { a: new THREE.Vector3(xc, y, Z0), b: new THREE.Vector3(xc, y, Z1), text: cmLabel(w.widthMm) },
    ];
  }
  if (handle === 'top') {
    const at = along ? new THREE.Vector3(X1 + 160, 0, zc) : new THREE.Vector3(xc, 0, Z1 + 160);
    return [{ a: at, b: at.clone().setY(h), text: cmLabel(h) }];
  }
  const out: LiveDim[] = [];
  const y = 4;
  if (Math.abs(f.x0) >= 5) out.push({ a: new THREE.Vector3(frame.x0, y, zc), b: new THREE.Vector3(X0, y, zc), text: cmLabel(Math.abs(f.x0)) });
  if (f.z0 >= 5) out.push({ a: new THREE.Vector3(xc, y, frame.z), b: new THREE.Vector3(xc, y, Z0), text: cmLabel(f.z0) });
  return out;
}

/** Cota ao vivo da parede do fundo: a largura em cima ou o pé-direito ao lado. */
export function mainLiveDims(frame: WallFrame, handle: MainWallEdge): LiveDim[] {
  if (handle === 'top') {
    const at = new THREE.Vector3(frame.x0 + frame.width + 160, 0, frame.z + 10);
    return [{ a: at, b: at.clone().setY(frame.height), text: cmLabel(frame.height) }];
  }
  const y = frame.height + 90;
  return [{ a: new THREE.Vector3(frame.x0, y, frame.z + 10), b: new THREE.Vector3(frame.x0 + frame.width, y, frame.z + 10), text: cmLabel(frame.width) }];
}

/** Linhas das cotas ao vivo, por cima de tudo, com traços nas pontas. */
export function liveDimLines(dims: readonly LiveDim[], color = FRAME_COLOR.ok) {
  const points: number[] = [];
  const tick = 50;
  for (const d of dims) {
    points.push(d.a.x, d.a.y, d.a.z, d.b.x, d.b.y, d.b.z);
    // Traço de chamada perpendicular à linha, no plano mais legível.
    const dir = d.b.clone().sub(d.a).normalize();
    const side = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    for (const p of [d.a, d.b]) points.push(p.x - side.x * tick, p.y - side.y * tick, p.z, p.x + side.x * tick, p.y + side.y * tick, p.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false });
  const lines = new THREE.LineSegments(geometry, material);
  lines.renderOrder = 30;
  return {
    lines,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
