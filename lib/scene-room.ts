import * as THREE from 'three';
import type { Foot } from './composition';
import { blocksTv, boxesCross, MAIN_WALL, tvMountZ, wallAt, wallBox, wallFootprint, type Obstacle, type Room, type Wall } from './room';
import { buildObstacle, FRAME_COLOR } from './scene-obstacles';
import { buildWall, layoutWall } from './scene-walls';

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

/** Onde a parede começa no mundo: presa, ou a `offsetMm` do móvel. */
export function wallStart(room: Room, bounds: SceneBounds) {
  return wallAt(room, bounds).x;
}

/**
 * Parede de referência quando o projeto não tem ambiente: pé-direito comum e
 * um metro de parede de cada lado do móvel. Dá escala e o "encostar" na
 * parede sem fingir que é a medida do cliente (não entra no veredito).
 *
 * Com `homeZ` (onde fica o fundo de um módulo no lugar de origem), a parede
 * fica presa no mundo: arrastar o móvel para a frente abre a folga em vez de
 * a parede ir junto, e para o lado a parede só cresce para caber.
 */
export function referenceRoom(bounds: SceneBounds, homeZ?: number): Room {
  const heightMm = Math.max(2700, Math.ceil((bounds.max[1] + 200) / 100) * 100);
  if (homeZ !== undefined) {
    const left = Math.floor(Math.min(bounds.min[0] - 1000, -1600) / 100) * 100;
    const right = Math.ceil(Math.max(bounds.max[0] + 1000, 1600) / 100) * 100;
    return {
      schemaVersion: 1,
      widthMm: right - left,
      heightMm,
      depthMm: 3000,
      anchor: { x: left, z: Math.min(bounds.min[2], homeZ) },
      obstacles: [],
    };
  }
  const width = bounds.max[0] - bounds.min[0];
  const wall = Math.max(3200, Math.ceil((width + 2000) / 100) * 100);
  return {
    schemaVersion: 1,
    widthMm: wall,
    heightMm,
    depthMm: 3000,
    offsetMm: Math.round((wall - width) / 2),
    obstacles: [],
  };
}

/** Obstáculo cruza o envelope do móvel na parede (x ao longo, y do piso). */
/**
 * O obstáculo cruza algum módulo, em x e em altura? Por módulo: pela caixa do
 * conjunto inteiro, uma janela alta sobre um rack baixo ficava vermelha só
 * porque a estante ao lado era alta.
 */
export function obstacleCrosses(
  o: Obstacle,
  modules: readonly SceneBounds[],
  wallX0: number,
  /** Para a TV: painéis de parede e a face da parede, para achar onde ela encosta. */
  tv?: { panels: readonly SceneBounds[]; wallZ: number },
) {
  const minX = wallX0 + o.xMm;
  if (o.kind === 'tv') {
    // A mesma conta do veredito: o painel atrás é o lugar da TV; o que
    // avança na frente da tela (ou encosta nela) tapa.
    if (!tv) return false;
    const rect = { x0: minX, x1: minX + o.widthMm, y0: o.yMm, y1: o.yMm + o.heightMm };
    const mount = tvMountZ(rect, tv.panels, tv.wallZ);
    return modules.some((b) => blocksTv(rect, mount, b));
  }
  return modules.some(
    (b) =>
      Math.min(minX + o.widthMm, b.max[0]) - Math.max(minX, b.min[0]) > 1e-6 &&
      Math.min(o.yMm + o.heightMm, b.max[1]) - Math.max(o.yMm, b.min[1]) > 1e-6,
  );
}

/** Extensão do ambiente no mundo: serve para enquadrar a câmera. */
export function roomExtent(room: Room, bounds: SceneBounds): SceneBounds {
  const wallZ = wallAt(room, bounds).z;
  const depth = room.depthMm ?? Math.max(1800, (bounds.max[2] - wallAt(room, bounds).z) * 3);
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
  const min = [bounds.min[0] - 350, 0, Math.min(bounds.min[2], wallAt(room, bounds).z)];
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
 * `panels` são as caixas dos painéis de parede: a TV encosta na frente do
 * painel que tem o centro da tela (a conta do veredito), não atrás dele nem
 * na frente de um painel decorativo que só passa perto.
 */
/** Folga das paredes laterais para fora do canto, em mm. */
const SIDE_CLEARANCE = 4;

export function buildRoom(
  room: Room,
  bounds: SceneBounds,
  theme: 'light' | 'dark',
  panels: readonly SceneBounds[] = [],
  /** Caixa de cada módulo: o obstáculo só fica vermelho se cruzar uma delas. */
  modules: readonly SceneBounds[] = [bounds],
  /** Obstáculo escolhido: ganha a moldura de destaque. */
  selectedId: string | null = null,
  /** Parede escolhida (a do fundo é `MAIN_WALL`): ganha o destaque. */
  selectedWall: string | null = null,
) {
  const c = ROOM_PALETTE[theme];
  const group = new THREE.Group();
  group.name = 'ambiente';
  const x0 = wallStart(room, bounds);
  const wallZ = wallAt(room, bounds).z - 1;
  const W = room.widthMm;
  const H = room.heightMm;
  const depth = room.depthMm ?? Math.max(1800, (bounds.max[2] - wallAt(room, bounds).z) * 3);
  const disposables: { dispose: () => void }[] = [];
  const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.95, ...extra });
    disposables.push(m);
    return m;
  };
  // Tudo que acompanha a largura e o pé-direito é geometria de 1 mm escalada:
  // a alça da parede do fundo estica o ambiente ao vivo, sem refazer nada.
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  disposables.push(unitBox, unitPlane);
  const box = (material: THREE.Material) => {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  // Parede do fundo: recebe a sombra do móvel, que é o que faz ele "encostar".
  const wall = box(
    mat(c.wall, selectedWall === MAIN_WALL ? { emissive: new THREE.Color(FRAME_COLOR.ok), emissiveIntensity: 0.035 } : {}),
  );
  wall.castShadow = false;
  wall.userData.mainWall = true;
  // Escolhida: contorno na face, por cima do móvel, como a moldura dos obstáculos.
  let outline: THREE.LineLoop | null = null;
  if (selectedWall === MAIN_WALL) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(1, 1, 0),
      new THREE.Vector3(0, 1, 0),
    ]);
    const line = new THREE.LineBasicMaterial({ color: FRAME_COLOR.ok, transparent: true, opacity: 0.9, depthTest: false });
    disposables.push(geo, line);
    outline = new THREE.LineLoop(geo, line);
    outline.renderOrder = 20;
    group.add(outline);
  }
  // Paredes laterais translúcidas e curtas: dão o canto sem ficar entre a
  // câmera e o móvel (inteiras, cobriam a TV e o rack com um véu cinza). Uma
  // parede de verdade no canto toma o lugar dela.
  const sideDepth = Math.min(depth, 1000);
  const extra = room.walls ?? [];
  const cornerTaken = (x: number) =>
    extra.some((w) => {
      const f = wallFootprint(w);
      return w.rotation === 90 && f.z0 < 100 && f.x0 <= x + 10 && f.x1 >= x - 10;
    });
  const sides = [0, 1].map((side) => {
    const m = mat(c.side, { transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
    const plane = new THREE.Mesh(unitPlane, m);
    plane.rotation.y = Math.PI / 2;
    plane.renderOrder = 2;
    plane.visible = !cornerTaken(side ? W : 0);
    group.add(plane);
    return plane;
  });
  // Piso do ambiente, um pouco acima da grade para não piscar.
  const floor = new THREE.Mesh(unitPlane, mat(c.floor, { roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  // Linha do teto e rodapé.
  const ceiling = box(mat(c.trim));
  const baseboard = room.baseboardMm && room.baseboardMm > 0 ? box(mat(c.trim)) : null;
  const shell = (left: number, width: number, height: number) => {
    wall.scale.set(width, height, 20);
    wall.position.set(left + width / 2, height / 2, wallZ - 10);
    outline?.scale.set(width, height, 1);
    outline?.position.set(left, 0, wallZ + 2);
    for (const [i, plane] of sides.entries()) {
      plane.scale.set(sideDepth, height, 1);
      // Um pouco para fora do canto: com o móvel encostado (a partir do canto
      // = 0) a lateral dele ficava no mesmo plano da parede translúcida e as
      // duas brigavam pelos mesmos pixels, num pontilhado que mudava ao girar.
      plane.position.set(left + (i ? width + SIDE_CLEARANCE : -SIDE_CLEARANCE), height / 2, wallZ + sideDepth / 2);
    }
    floor.scale.set(width, depth, 1);
    floor.position.set(left + width / 2, -0.5, wallZ + depth / 2);
    ceiling.scale.set(width, 12, 30);
    ceiling.position.set(left + width / 2, height - 6, wallZ + 15);
    if (baseboard && room.baseboardMm) {
      baseboard.scale.set(width, room.baseboardMm, 14);
      baseboard.position.set(left + width / 2, room.baseboardMm / 2, wallZ + 7);
    }
  };
  shell(x0, W, H);
  // Paredes do ambiente, cada uma no próprio grupo com o id: a cena pega,
  // arrasta e estica pelas alças. Vermelha quando cruza um módulo.
  const face = wallAt(room, bounds).z;
  const walls: { id: string; group: THREE.Group; wall: Wall }[] = [];
  for (const w of extra) {
    const solid = wallBox(w, { x: x0, z: face }, H);
    const bad = modules.some((b) => boxesCross(solid, b));
    const wg = buildWall(w, { palette: c, theme, bad, selected: w.id === selectedWall, track: (d) => disposables.push(d) });
    layoutWall(wg, w, { x0, z: face, height: H });
    group.add(wg);
    walls.push({ id: w.id, group: wg, wall: w });
  }
  // Obstáculos: cada um num grupo próprio, com o id, para a cena poder
  // pegar e arrastar. Vermelho só quando cruza um módulo de verdade.
  const obstacles: { id: string; group: THREE.Group; obstacle: Obstacle }[] = [];
  for (const o of room.obstacles ?? []) {
    const og = buildObstacle(o, {
      palette: c,
      theme,
      bad: obstacleCrosses(o, modules, x0, { panels, wallZ: wallAt(room, bounds).z }),
      selected: o.id === selectedId,
      track: (d) => disposables.push(d),
    });
    const mount =
      o.kind === 'tv'
        ? tvMountZ({ x0: x0 + o.xMm, x1: x0 + o.xMm + o.widthMm, y0: o.yMm, y1: o.yMm + o.heightMm }, panels, wallAt(room, bounds).z)
        : wallZ;
    og.position.set(x0 + o.xMm, o.yMm, Math.max(wallZ, mount));
    group.add(og);
    obstacles.push({ id: o.id, group: og, obstacle: o });
  }
  return {
    group,
    obstacles,
    walls,
    /** Onde a parede está no mundo: o arrasto de obstáculo anda nela. */
    wall: { x0, z: wallZ, width: W, height: H },
    /** Face da parede do fundo no mundo: as outras paredes contam z dela. */
    face,
    /** Parede do fundo (o bloco): clique nela escolhe a parede. */
    mainWall: wall,
    /**
     * Estica o ambiente ao vivo, durante o arrasto de uma alça da parede do
     * fundo: canto esquerdo, largura e pé-direito no mundo.
     */
    resize: shell,
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
