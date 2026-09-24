import * as THREE from 'three';
import type { Foot } from './composition';
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

/** Onde a parede começa no mundo: o móvel fica a `offsetMm` do canto esquerdo. */
export function wallStart(room: Room, bounds: SceneBounds) {
  return bounds.min[0] - (room.offsetMm ?? 0);
}

/**
 * Parede de referência quando o projeto não tem ambiente: pé-direito comum e
 * um metro de parede de cada lado do móvel. Dá escala e o "encostar" na
 * parede sem fingir que é a medida do cliente (não entra no veredito).
 */
export function referenceRoom(bounds: SceneBounds): Room {
  const width = bounds.max[0] - bounds.min[0];
  const wall = Math.max(3200, Math.ceil((width + 2000) / 100) * 100);
  return {
    schemaVersion: 1,
    widthMm: wall,
    heightMm: Math.max(2700, Math.ceil((bounds.max[1] + 200) / 100) * 100),
    depthMm: 3000,
    offsetMm: Math.round((wall - width) / 2),
    obstacles: [],
  };
}

/** Obstáculo cruza o envelope do móvel na parede (x ao longo, y do piso). */
export function obstacleCrosses(o: Obstacle, bounds: SceneBounds, offset = 0) {
  if (o.kind === 'tv') return false;
  const minX = bounds.min[0] - offset + o.xMm;
  return (
    Math.min(minX + o.widthMm, bounds.max[0]) - Math.max(minX, bounds.min[0]) > 1e-6 &&
    Math.min(o.yMm + o.heightMm, bounds.max[1]) - Math.max(o.yMm, bounds.min[1]) > 1e-6
  );
}

/** Extensão do ambiente no mundo: serve para enquadrar a câmera. */
export function roomExtent(room: Room, bounds: SceneBounds): SceneBounds {
  const wallZ = bounds.min[2];
  const depth = room.depthMm ?? Math.max(1800, (bounds.max[2] - bounds.min[2]) * 3);
  const x0 = wallStart(room, bounds);
  return {
    min: [x0, 0, wallZ],
    max: [x0 + room.widthMm, room.heightMm, wallZ + Math.min(depth, 2600)],
  };
}

/**
 * O que a câmera enquadra com o ambiente à vista: o móvel com uma margem e o
 * que está na parede perto dele (porta, janela, TV, tomada). O ambiente
 * inteiro deixava o móvel pequeno no meio de um quarto vazio.
 */
export function roomFocus(room: Room, bounds: SceneBounds): SceneBounds {
  const x0 = wallStart(room, bounds);
  const min = [bounds.min[0] - 350, 0, bounds.min[2]];
  const max = [bounds.max[0] + 350, bounds.max[1] + 150, bounds.max[2]];
  for (const o of room.obstacles ?? []) {
    min[0] = Math.min(min[0], x0 + o.xMm - 150);
    max[0] = Math.max(max[0], x0 + o.xMm + o.widthMm + 150);
    max[1] = Math.max(max[1], o.yMm + o.heightMm + 150);
  }
  // Nunca além da parede: a margem para no canto.
  min[0] = Math.max(min[0], x0);
  max[0] = Math.min(max[0], x0 + room.widthMm);
  max[1] = Math.min(max[1], room.heightMm);
  return { min, max };
}

/**
 * `mountZ` é a face da frente do que está preso na parede (painel de TV): a
 * TV vai na frente dele, não atrás.
 */
export function buildRoom(room: Room, bounds: SceneBounds, theme: 'light' | 'dark', mountZ = -Infinity) {
  const c = ROOM_PALETTE[theme];
  const group = new THREE.Group();
  group.name = 'ambiente';
  const offset = room.offsetMm ?? 0;
  const x0 = wallStart(room, bounds);
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
  // Paredes laterais translúcidas e curtas: dão o canto sem ficar entre a
  // câmera e o móvel (inteiras, cobriam a TV e o rack com um véu cinza).
  const sideDepth = Math.min(depth, 1000);
  for (const side of [0, 1]) {
    const m = mat(c.side, { transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
    const geo = new THREE.PlaneGeometry(sideDepth, H);
    disposables.push(geo);
    const plane = new THREE.Mesh(geo, m);
    plane.rotation.y = Math.PI / 2;
    plane.position.set(x0 + (side ? W : 0), H / 2, wallZ + sideDepth / 2);
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
    const bad = obstacleCrosses(o, bounds, offset);
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
    } else if (o.kind === 'tv') {
      // TV de tela plana: caixa escura fina e a tela um pouco mais clara,
      // quase espelhada, na frente do painel quando houver um.
      const z = Math.max(wallZ, mountZ) + 18;
      const body = box([o.widthMm, o.heightMm, 30], [ox, oy, z + 15], mat(theme === 'dark' ? '#0c0d0f' : '#17191c', { roughness: 0.4, metalness: 0.2 }));
      body.castShadow = true;
      box([o.widthMm - 16, o.heightMm - 16, 2], [ox, oy + 3, z + 31], mat(theme === 'dark' ? '#1b2129' : '#262c35', { roughness: 0.08, metalness: 0.35 }));
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

/** Pés dos módulos: cilindro que afina para o piso, na cor do corpo. */
export function buildFeet(feet: readonly Foot[], colorOf: (moduleId: string) => string) {
  const group = new THREE.Group();
  group.name = 'pés';
  const disposables: { dispose: () => void }[] = [];
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  for (const f of feet) {
    const color = colorOf(f.moduleId);
    let m = mats.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.8), roughness: 0.55 });
      mats.set(color, m);
      disposables.push(m);
    }
    const geo = new THREE.CylinderGeometry(f.radius[0], f.radius[1], f.height, 20);
    disposables.push(geo);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(...f.position);
    mesh.castShadow = true;
    // O arrasto de um móvel leva os pés dele junto, a partir desta posição.
    mesh.userData = { moduleId: f.moduleId, home: mesh.position.clone() };
    group.add(mesh);
  }
  return {
    group,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
