'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Params, Part } from '@/lib/furniture';
import { FurnitureMotion, ease, SCRUB_MS, TRANSITION_MS } from '@/lib/furniture-motion';
type CameraMove = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  targetFrom: THREE.Vector3;
  targetTo: THREE.Vector3;
  started: number;
};
export type ViewMode = 'perspective' | 'front' | 'side' | 'top';
type Runtime = {
  motion: FurnitureMotion;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  reduced: MediaQueryList;
  move?: CameraMove;
  view?: { height: number; width: number; mode: ViewMode };
};
export default function FurnitureView({
  params,
  parts,
  selected,
  onSelect,
  exploded,
  view,
  spin = false,
  scrub = false,
}: {
  params: Params;
  parts: Part[];
  selected: string[];
  onSelect: (id: string | null) => void;
  exploded: boolean;
  view: ViewMode;
  spin?: boolean;
  scrub?: boolean;
}) {
  const [hover, setHover] = useState<{ id: string; x: number; y: number; flip: boolean } | null>(null);
  const host = useRef<HTMLDivElement>(null),
    callback = useRef(onSelect),
    runtime = useRef<Runtime | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    callback.current = onSelect;
  }, [onSelect]);
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
      camera = new THREE.PerspectiveCamera(34, 1, 1, 20000),
      controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 400;
    controls.maxDistance = 8000;
    controls.maxPolarAngle = Math.PI * 0.88;
    const motion = new FurnitureMotion(scene);
    const state: Runtime = {
      motion,
      camera,
      controls,
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)'),
    };
    runtime.current = state;
    controls.addEventListener('start', () => {
      state.move = undefined;
    });
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
        ray.intersectObjects(motion.pickable(), false)[0]?.object.userData.id ??
          null,
      );
    };
    renderer.domElement.addEventListener('pointerdown', start);
    renderer.domElement.addEventListener('pointerup', pick);
    const hover = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.buttons !== 0) {
        setHover(null);
        return;
      }
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const id =
        ray.intersectObjects(motion.pickable(), false)[0]?.object.userData.id ??
        null;
      if (!id) {
        setHover(null);
        return;
      }
      const box = el.getBoundingClientRect();
      const x = e.clientX - box.left;
      setHover({ id, x, y: e.clientY - box.top, flip: x > box.width - 230 });
    };
    renderer.domElement.addEventListener('pointermove', hover);
    renderer.domElement.addEventListener('pointerleave', () => setHover(null));
    const resize = new ResizeObserver(() => {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    });
    resize.observe(el);
    let frame = 0;
    const draw = (now: number) => {
      motion.tick(now, state.reduced.matches);
      if (state.move) {
        const m = state.move,
          t = state.reduced.matches
            ? 1
            : ease((now - m.started) / TRANSITION_MS);
        camera.position.lerpVectors(m.from, m.to, t);
        controls.target.lerpVectors(m.targetFrom, m.targetTo, t);
        if (t === 1) state.move = undefined;
      }
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      motion.dispose();
      floor.geometry.dispose();
      floor.material.dispose();
      grid.geometry.dispose();
      const mats = Array.isArray(grid.material)
        ? grid.material
        : [grid.material];
      mats.forEach((m) => m.dispose());
      sun.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, []);
  useEffect(() => {
    const state = runtime.current;
    if (state)
      state.motion.update(
        parts,
        params,
        exploded,
        selected,
        performance.now(),
        state.reduced.matches,
        scrub ? SCRUB_MS : TRANSITION_MS,
      );
  }, [parts, params, exploded, selected, scrub]);
  useEffect(() => {
    const state = runtime.current;
    if (state) state.motion.setHover(hover?.id ?? null);
    if (host.current) host.current.style.cursor = hover ? 'pointer' : '';
  }, [hover]);
  useEffect(() => {
    const state = runtime.current;
    if (state) state.controls.autoRotate = spin && !state.reduced.matches;
  }, [spin]);
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    const scale = Math.max(params.height, params.width * 1.5),
      target = new THREE.Vector3(0, params.height / 2, 0);
    let to: THREE.Vector3;
    if (!s.view || s.view.mode !== view) {
      if (view === 'front')
        to = new THREE.Vector3(0, params.height * 0.7, scale * 2.15);
      else if (view === 'side')
        to = new THREE.Vector3(scale * 2.15, params.height * 0.7, 0);
      else if (view === 'top')
        to = new THREE.Vector3(0, params.height / 2 + scale * 2.2, 0.02);
      else
        to = new THREE.Vector3(
          scale * 1.05,
          params.height * 0.7,
          scale * 2.15,
        );
    } else {
      const previousScale = Math.max(s.view.height, s.view.width * 1.5);
      to = s.camera.position
        .clone()
        .sub(s.controls.target)
        .multiplyScalar(scale / previousScale)
        .add(target);
    }
    if (!s.view || s.reduced.matches || scrub) {
      s.camera.position.copy(to);
      s.controls.target.copy(target);
      s.controls.update();
      s.move = undefined;
    } else {
      s.move = {
        from: s.camera.position.clone(),
        to,
        targetFrom: s.controls.target.clone(),
        targetTo: target,
        started: performance.now(),
      };
    }
    s.view = { height: params.height, width: params.width, mode: view };
  }, [params.height, params.width, view, scrub]);
  const hoveredPart = hover ? parts.find((v) => v.id === hover.id) : undefined;
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
      {hoveredPart && hover && (
        <div
          className={'part-tip' + (hover.flip ? ' flip' : '')}
          style={{ left: hover.x, top: hover.y }}
        >
          <strong>{hoveredPart.name}</strong>
          <span>
            {hoveredPart.c} × {hoveredPart.l} × {hoveredPart.thickness} mm
          </span>
          <small>{hoveredPart.material}</small>
        </div>
      )}
    </div>
  );
}
