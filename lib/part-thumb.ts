import * as THREE from 'three';

export const THUMB_WIDTH = 288;
export const THUMB_HEIGHT = 216;

/** Camera fit for a part thumbnail. Pure: the whole part always fits the frame. */
export function framePart(size: readonly [number, number, number]) {
  const dist = Math.max(...size) * 2.1;
  return {
    dist,
    eye: [dist * 0.85, dist * 0.62, dist * 1.7] as const,
    near: dist / 100,
    far: dist * 20,
  };
}

export function thumbKey(size: [number, number, number], color: string) {
  return `${size.join('x')}:${color}`;
}

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let shown: THREE.Object3D | null = null;

/** Renders one part to a PNG data URL. Null when WebGL is unavailable. */
export function renderPartThumb(
  size: [number, number, number],
  color: string,
): string | null {
  try {
    renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(1);
    renderer.setSize(THUMB_WIDTH, THUMB_HEIGHT, false);
    if (!scene) {
      scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x828794, 2.2));
      const sun = new THREE.DirectionalLight(0xffffff, 2.5);
      sun.position.set(1, 2, 1.5);
      scene.add(sun);
      camera = new THREE.PerspectiveCamera(30, THUMB_WIDTH / THUMB_HEIGHT, 1, 100000);
    }
    if (shown) {
      scene.remove(shown);
      shown.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        }
      });
    }
    const { eye, near, far } = framePart(size);
    camera!.near = near;
    camera!.far = far;
    camera!.position.set(...eye);
    camera!.lookAt(0, 0, 0);
    camera!.updateProjectionMatrix();
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial({ color, roughness: 0.72 }),
    );
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: '#302b24', transparent: true, opacity: 0.3 }),
    );
    group.add(mesh, edge);
    scene.add(group);
    shown = group;
    renderer.render(scene, camera!);
    return renderer.domElement.toDataURL('image/png');
  } catch {
    return null;
  }
}
