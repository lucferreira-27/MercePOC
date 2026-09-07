'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { materials, type Params, type Part } from '@/lib/furniture';
export default function FurnitureView({
  params,
  parts,
  selected,
  onSelect,
  exploded,
  front,
}: {
  params: Params;
  parts: Part[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  exploded: boolean;
  front: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    callback = useRef(onSelect);
  const meshList = useRef<THREE.Mesh[]>([]);
  useEffect(() => {
    callback.current = onSelect;
  }, [onSelect]);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const el = host.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      queueMicrotask(() => setError(true));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(34, 1, 1, 20000);
    const scale = Math.max(params.height, params.width * 1.5);
    camera.position.set(
      front ? 0 : scale * 1.05,
      params.height * 0.7,
      scale * 2.15,
    );
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, params.height / 2, 0);
    controls.enableDamping = true;
    controls.minDistance = 400;
    controls.maxDistance = 8000;
    controls.maxPolarAngle = Math.PI * 0.88;
    controls.update();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x828794, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 3.4);
    sun.position.set(-1600, 3200, 2200);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -2500,
      right: 2500,
      top: 3000,
      bottom: -2500,
      far: 9000,
    });
    sun.shadow.bias = -0.0003;
    scene.add(sun);
    const meshes: THREE.Mesh[] = [];
    meshList.current = meshes;
    const color = materials.find((m) => m.id === params.materialId)!.color;
    for (const p of parts) {
      const geo = new THREE.BoxGeometry(...p.size),
        mat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.72,
          metalness: 0,
        });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...p.position);
      if (exploded) {
        mesh.position.x *= 1.35;
        mesh.position.y =
          (mesh.position.y - params.height / 2) * 1.3 + params.height / 2;
        if (p.id === 'back') mesh.position.z -= 280;
        else if (p.id.startsWith('shelf')) mesh.position.z += 180;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.id = p.id;
      meshes.push(mesh);
      scene.add(mesh);
      mesh.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({
            color: '#302b24',
            transparent: true,
            opacity: 0.25,
          }),
        ),
      );
    }
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20000, 20000),
      new THREE.ShadowMaterial({ opacity: 0.14 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(8000, 80, 0xc6cbd2, 0xe0e4e8);
    grid.position.y = -3;
    scene.add(grid);
    const ray = new THREE.Raycaster();
    let down = [0, 0];
    const start = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
    };
    const pick = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      callback.current(
        ray.intersectObjects(meshes)[0]?.object.userData.id ?? null,
      );
    };
    renderer.domElement.addEventListener('pointerdown', start);
    renderer.domElement.addEventListener('pointerup', pick);
    const resize = new ResizeObserver(() => {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    });
    resize.observe(el);
    let frame = 0;
    const draw = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [params, parts, exploded, front]);
  useEffect(() => {
    const color = materials.find((m) => m.id === params.materialId)!.color;
    for (const mesh of meshList.current) {
      (mesh.material as THREE.MeshStandardMaterial).color.set(
        mesh.userData.id === selected ? '#c8f57c' : color,
      );
    }
  }, [selected, params, parts, exploded, front]);
  return (
    <div
      ref={host}
      className="scene"
      role="application"
      aria-label="Modelo 3D interativo da estante. Arraste para girar e clique para selecionar peças."
    >
      {error && (
        <p className="scene-error">
          Seu navegador não disponibilizou WebGL. Você pode continuar pelo chat
          e pela lista de peças.
        </p>
      )}
    </div>
  );
}
