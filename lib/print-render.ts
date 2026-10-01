import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Part } from './furniture';
import { FurnitureMotion } from './furniture-motion';
import type { Fitting } from './fittings';
import { buildFittings } from './scene-fittings';

/** Tamanho da foto do PDF: a largura útil do A4 em ~250 dpi, na proporção do quadro. */
export const PRINT_SHOT = { width: 1920, height: 1100 } as const;

/**
 * Direção da câmera da foto: três quartos pela direita, um pouco acima.
 * Mostra a frente inteira, a lateral e um fio do tampo, que é como um
 * catálogo apresenta um móvel. Ângulos em graus.
 */
export const PRINT_VIEW = { azimuth: 34, elevation: 18, fov: 28, margin: 0.86 } as const;

export function printDirection() {
  const az = THREE.MathUtils.degToRad(PRINT_VIEW.azimuth),
    el = THREE.MathUtils.degToRad(PRINT_VIEW.elevation);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

/**
 * Enquadra a caixa na câmera: centra a projeção dos oito cantos e ajusta a
 * distância até o lado mais justo ocupar `margin` do quadro. Iterativo porque
 * a perspectiva não é linear; quatro passos bastam para ficar abaixo de 1%.
 */
export function framePrint(camera: THREE.PerspectiveCamera, box: THREE.Box3, margin: number = PRINT_VIEW.margin) {
  const dir = printDirection();
  const target = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  let dist = Math.max(size.length(), 1) * 1.6;
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) =>
      new THREE.Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      ),
  );
  const v = new THREE.Vector3();
  const right = new THREE.Vector3(),
    up = new THREE.Vector3();
  for (let step = 0; step < 6; step++) {
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const c of corners) {
      v.copy(c).project(camera);
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
    const halfW = halfH * camera.aspect;
    camera.matrixWorld.extractBasis(right, up, v);
    target.addScaledVector(right, ((minX + maxX) / 2) * halfW).addScaledVector(up, ((minY + maxY) / 2) * halfH);
    dist *= Math.max((maxX - minX) / 2, (maxY - minY) / 2) / margin;
  }
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return { target, dist };
}

/**
 * Foto do móvel para o PDF, feita fora da tela: portas fechadas, sem
 * seleção, sem parede nem grade, sempre do mesmo ângulo e enquadrada pela
 * caixa do móvel. Não depende de onde a pessoa deixou a câmera. PNG com fundo
 * transparente (a folha é branca) ou `null` sem WebGL.
 */
export function renderPrintShot(
  parts: readonly Part[],
  params: Parameters<FurnitureMotion['update']>[1],
  size: { width: number; height: number } = PRINT_SHOT,
  fittings: readonly Fitting[] = [],
): string | null {
  if (typeof document === 'undefined' || !parts.length) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(size.width, size.height, false);
    renderer.setClearColor(0xffffff, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.6;
    scene.add(new THREE.HemisphereLight(0xfffaf2, 0xcabfae, 0.95));
    const motion = new FurnitureMotion(scene);
    // Ferragens com a forma de verdade (pé inclinado, estrutura de aço), não
    // a caixa que o desenho usa: a caixa delas sai das peças.
    const fitted = new Set(fittings.map((f) => f.id));
    motion.update(parts.filter((p) => !fitted.has(p.id)), params, false, [], 0, true, 0);
    const box = new THREE.Box3();
    for (const e of motion.entries.values()) box.expandByObject(e.mesh);
    if (fittings.length) {
      const hardware = buildFittings(fittings.filter((f) => !f.hidden && f.kind !== 'handle'));
      scene.add(hardware.group);
      box.expandByObject(hardware.group);
    }
    const center = box.getCenter(new THREE.Vector3());
    const extent = box.getSize(new THREE.Vector3());
    const reach = Math.max(extent.x, extent.y, extent.z) * 0.9 + 600;
    // Luz principal alta, à esquerda e à frente: a frente fica clara, a
    // lateral à direita ganha meio-tom e a sombra cai junto da base.
    const sun = new THREE.DirectionalLight(0xfff4e6, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 10, far: reach * 6 });
    sun.shadow.normalBias = ((reach * 2) / 2048) * 0.8;
    sun.shadow.camera.updateProjectionMatrix();
    sun.position.copy(center).add(new THREE.Vector3(-reach * 0.6, reach * 2.2, reach * 1.1));
    sun.target.position.copy(center);
    scene.add(sun, sun.target);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(reach * 8, reach * 8),
      new THREE.ShadowMaterial({ opacity: 0.2 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(center.x, box.min.y - 0.5, center.z);
    floor.receiveShadow = true;
    scene.add(floor);
    const camera = new THREE.PerspectiveCamera(PRINT_VIEW.fov, size.width / size.height, 10, 100000);
    framePrint(camera, box);
    const dist = camera.position.distanceTo(center);
    camera.near = Math.max(dist / 50, 1);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      // Texturas de acabamento ficam no cache compartilhado com a cena.
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    scene.environment?.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
