import * as THREE from 'three';
import type { Obstacle, Room } from './room';

/**
 * O ambiente desenhado na cena 3D, com a mesma convenção do veredito de
 * encaixe (`fitReport`): o x da parede começa no lado esquerdo da composição,
 * a parede encosta no fundo do móvel e o piso é y = 0. O que a pessoa vê é o
 * que o veredito conferiu.
 */
export type SceneBounds = { min: number[]; max: number[] };
export type RoomPalette = {
  wall: string;
  side: string;
  floor: string;
  trim: string;
  glass: string;
  bad: string;
};
export const ROOM_PALETTE: Record<'light' | 'dark', RoomPalette> = {
  light: { wall: '#f1ede6', side: '#e9e4db', floor: '#ddd5c8', trim: '#fbfaf7', glass: '#b9d3df', bad: '#d9534f' },
  dark: { wall: '#2b2d31', side: '#26282b', floor: '#1f2023', trim: '#3a3c41', glass: '#3f5f6d', bad: '#e0605b' },
};

/** Obstáculo cruza o envelope do móvel na parede (x ao longo, y do piso). */
export function obstacleCrosses(o: Obstacle, bounds: SceneBounds) {
  const minX = bounds.min[0] + o.xMm;
  return (
    Math.min(minX + o.widthMm, bounds.max[0]) - Math.max(minX, bounds.min[0]) > 1e-6 &&
    Math.min(o.yMm + o.heightMm, bounds.max[1]) - Math.max(o.yMm, bounds.min[1]) > 1e-6
  );
}

/** Extensão do ambiente no mundo: serve para enquadrar a câmera. */
export function roomExtent(room: Room, bounds: SceneBounds): SceneBounds {
  const wallZ = bounds.min[2];
  const depth = room.depthMm ?? Math.max(1800, (bounds.max[2] - bounds.min[2]) * 3);
  return {
    min: [bounds.min[0], 0, wallZ],
    max: [bounds.min[0] + room.widthMm, room.heightMm, wallZ + Math.min(depth, 2600)],
  };
}

export function buildRoom(room: Room, bounds: SceneBounds, theme: 'light' | 'dark') {
  const c = ROOM_PALETTE[theme];
  const group = new THREE.Group();
  group.name = 'ambiente';
  const x0 = bounds.min[0];
  const wallZ = bounds.min[2] - 1;
  const W = room.widthMm;
  const H = room.heightMm;
  const depth = room.depthMm ?? Math.max(1800, (bounds.max[2] - bounds.min[2]) * 3);
  const disposables: { dispose: () => void }[] = [];
  const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.95, ...extra });
    disposables.push(m);
    return m;
  };
  const box = (size: [number, number, number], at: [number, number, number], material: THREE.Material) => {
    const geo = new THREE.BoxGeometry(...size);
    disposables.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(...at);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  // Parede do fundo: recebe a sombra do móvel, que é o que faz ele "encostar".
  const wall = box([W, H, 20], [x0 + W / 2, H / 2, wallZ - 10], mat(c.wall));
  wall.castShadow = false;
  // Paredes laterais translúcidas: dão o canto sem esconder o móvel da câmera.
  for (const side of [0, 1]) {
    const m = mat(c.side, { transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const geo = new THREE.PlaneGeometry(depth, H);
    disposables.push(geo);
    const plane = new THREE.Mesh(geo, m);
    plane.rotation.y = Math.PI / 2;
    plane.position.set(x0 + (side ? W : 0), H / 2, wallZ + depth / 2);
    plane.renderOrder = 2;
    group.add(plane);
  }
  // Piso do ambiente, um pouco acima da grade para não piscar.
  const floorGeo = new THREE.PlaneGeometry(W, depth);
  disposables.push(floorGeo);
  const floor = new THREE.Mesh(floorGeo, mat(c.floor, { roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(x0 + W / 2, -0.5, wallZ + depth / 2);
  floor.receiveShadow = true;
  group.add(floor);
  // Linha do teto e rodapé.
  box([W, 12, 30], [x0 + W / 2, H - 6, wallZ + 15], mat(c.trim));
  if (room.baseboardMm && room.baseboardMm > 0)
    box([W, room.baseboardMm, 14], [x0 + W / 2, room.baseboardMm / 2, wallZ + 7], mat(c.trim));
  for (const o of room.obstacles ?? []) {
    const bad = obstacleCrosses(o, bounds);
    const ox = x0 + o.xMm + o.widthMm / 2;
    const oy = o.yMm + o.heightMm / 2;
    if (o.kind === 'door') {
      // Vão escuro com batente: a porta é uma abertura na parede.
      box([o.widthMm, o.heightMm, 4], [ox, oy, wallZ + 2], mat(bad ? c.bad : theme === 'dark' ? '#151618' : '#cfc6b8'));
      const frame = mat(c.trim);
      box([50, o.heightMm, 40], [ox - o.widthMm / 2 - 25, oy, wallZ + 20], frame);
      box([50, o.heightMm, 40], [ox + o.widthMm / 2 + 25, oy, wallZ + 20], frame);
      box([o.widthMm + 100, 50, 40], [ox, o.yMm + o.heightMm + 25, wallZ + 20], frame);
    } else if (o.kind === 'window') {
      box([o.widthMm, o.heightMm, 6], [ox, oy, wallZ + 3], mat(bad ? c.bad : c.glass, { roughness: 0.15, metalness: 0.1 }));
      const frame = mat(c.trim);
      box([o.widthMm + 60, 40, 60], [ox, o.yMm - 20, wallZ + 30], frame);
      box([o.widthMm + 60, 30, 30], [ox, o.yMm + o.heightMm + 15, wallZ + 15], frame);
      box([30, o.heightMm, 30], [ox, oy, wallZ + 15], frame);
    } else if (o.kind === 'outlet') {
      box([Math.max(o.widthMm, 60), Math.max(o.heightMm, 60), 12], [ox, oy, wallZ + 6], mat(bad ? c.bad : '#fbfbf8', { roughness: 0.5 }));
    } else if (o.kind === 'column') {
      box([o.widthMm, o.heightMm, 300], [ox, oy, wallZ + 150], mat(bad ? c.bad : c.side));
    } else {
      box([o.widthMm, o.heightMm, 40], [ox, oy, wallZ + 20], mat(bad ? c.bad : c.side, { transparent: true, opacity: 0.8 }));
    }
  }
  return {
    group,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
