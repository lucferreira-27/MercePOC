import * as THREE from 'three';
import { materials, type Params, type Part } from './furniture';
export const TRANSITION_MS = 750;
export const SCRUB_MS = 140;
export const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
type Pose = {
  position: THREE.Vector3;
  size: THREE.Vector3;
  color: THREE.Color;
  opacity: number;
};
type AnimatedPart = {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  edge: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  from: Pose;
  to: Pose;
  started: number;
  duration: number;
  exiting: boolean;
};
export function visualPosition(part: Part, height: number, exploded: boolean) {
  const p = new THREE.Vector3(...part.position);
  if (exploded) {
    p.x *= 1.35;
    p.y = (p.y - height / 2) * 1.3 + height / 2;
    if (part.id === 'back') p.z -= 280;
    else if (part.id.startsWith('shelf')) p.z += 180;
  }
  return p;
}
export class FurnitureMotion {
  readonly entries = new Map<string, AnimatedPart>();
  private initialized = false;
  constructor(private scene: THREE.Scene) {}
  private read(entry: AnimatedPart): Pose {
    return {
      position: entry.mesh.position.clone(),
      size: entry.mesh.scale.clone(),
      color: entry.mesh.material.color.clone(),
      opacity: entry.mesh.material.opacity,
    };
  }
  update(
    parts: Part[],
    params: Params,
    exploded: boolean,
    selected: readonly string[],
    now: number,
    reduced = false,
    duration: number = TRANSITION_MS,
  ) {
    this.tick(now, reduced);
    const present = new Set(parts.map((p) => p.id));
    const color = materials.find((m) => m.id === params.materialId)!.color;
    for (const part of parts) {
      const target: Pose = {
        position: visualPosition(part, params.height, exploded),
        size: new THREE.Vector3(...part.size),
        color: new THREE.Color(selected.includes(part.id) ? '#c8f57c' : color),
        opacity: 1,
      };
      let entry = this.entries.get(part.id);
      if (!entry) {
        const geo = new THREE.BoxGeometry(1, 1, 1),
          material = new THREE.MeshStandardMaterial({
            color: target.color,
            roughness: 0.72,
          });
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.copy(target.position);
        mesh.scale.copy(target.size);
        mesh.userData.id = part.id;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const edge = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({
            color: '#302b24',
            transparent: true,
            opacity: 0.25,
          }),
        );
        mesh.add(edge);
        this.scene.add(mesh);
        entry = {
          mesh,
          edge,
          from: target,
          to: target,
          started: now,
          duration: 0,
          exiting: false,
        };
        if (this.initialized && !reduced) {
          mesh.material.opacity = 0;
          mesh.position.y -= 20;
          mesh.scale.multiplyScalar(0.96);
        }
        this.entries.set(part.id, entry);
      }
      entry.from = this.read(entry);
      entry.to = target;
      entry.started = now;
      entry.duration = this.initialized && !reduced ? duration : 0;
      entry.exiting = false;
    }
    for (const [id, entry] of this.entries) {
      if (present.has(id) || entry.exiting) continue;
      entry.from = this.read(entry);
      entry.to = {
        ...entry.from,
        position: entry.from.position.clone().add(new THREE.Vector3(0, -20, 0)),
        size: entry.from.size.clone().multiplyScalar(0.96),
        opacity: 0,
      };
      entry.started = now;
      entry.duration = reduced ? 0 : duration;
      entry.exiting = true;
    }
    this.initialized = true;
    this.tick(now, reduced);
  }
  tick(now: number, reduced = false) {
    for (const [id, e] of this.entries) {
      const t =
        reduced || !e.duration ? 1 : ease((now - e.started) / e.duration);
      e.mesh.position.lerpVectors(e.from.position, e.to.position, t);
      e.mesh.scale.lerpVectors(e.from.size, e.to.size, t);
      e.mesh.material.color.copy(e.from.color).lerp(e.to.color, t);
      e.mesh.material.opacity = THREE.MathUtils.lerp(
        e.from.opacity,
        e.to.opacity,
        t,
      );
      const transparent = e.mesh.material.opacity < 0.999;
      if (e.mesh.material.transparent !== transparent) {
        e.mesh.material.transparent = transparent;
        e.mesh.material.needsUpdate = true;
      }
      e.mesh.material.depthWrite = !transparent;
      e.edge.material.opacity = 0.25 * e.mesh.material.opacity;
      if (t === 1 && e.exiting) {
        this.disposeEntry(e);
        this.entries.delete(id);
      }
    }
  }
  pickable() {
    return [...this.entries.values()]
      .filter((e) => !e.exiting && e.mesh.material.opacity > 0.2)
      .map((e) => e.mesh);
  }
  private disposeEntry(e: AnimatedPart) {
    this.scene.remove(e.mesh);
    e.mesh.geometry.dispose();
    e.mesh.material.dispose();
    e.edge.geometry.dispose();
    e.edge.material.dispose();
  }
  dispose() {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
  }
}
