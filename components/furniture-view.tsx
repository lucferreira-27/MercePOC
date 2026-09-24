'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Part } from '@/lib/furniture';
import type { Design } from '@/lib/studio';
import type { Room } from '@/lib/room';
import { generateComposition } from '@/lib/composition';
import { buildRoom, roomExtent, type SceneBounds } from '@/lib/scene-room';
import { buildDims, type DimLabel } from '@/lib/scene-dims';
import {
  FurnitureMotion,
  SPREAD_MM,
  ease,
  SCRUB_MS,
  TRANSITION_MS,
} from '@/lib/furniture-motion';
type CameraMove = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  targetFrom: THREE.Vector3;
  targetTo: THREE.Vector3;
  started: number;
};
export type ViewMode = 'perspective' | 'front' | 'side' | 'top';
export type SceneTheme = 'light' | 'dark';
type Runtime = {
  motion: FurnitureMotion;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  sun: THREE.DirectionalLight;
  grid: THREE.GridHelper;
  ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  reduced: MediaQueryList;
  move?: CameraMove;
  view?: { height: number; width: number; depth: number; mode: ViewMode; frameRequest: number };
  room?: { group: THREE.Group; dispose: () => void };
  dims?: { lines: THREE.LineSegments; labels: DimLabel[]; dispose: () => void };
  labelEls: HTMLSpanElement[];
};
const PALETTE = {
  light: { grid: [0xcfc8bb, 0xe4dfd6], ground: '#dcd3c5', dim: '#3c4a3f', groundOpacity: 0.75 },
  dark: { grid: [0x3b3e44, 0x2c2e33], ground: '#2a2d31', dim: '#b9d7bf', groundOpacity: 0.9 },
} as const;

/** Chão que some nas bordas: a peça pousa numa mancha clara, não num tabuleiro. */
function groundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default function FurnitureView({
  params,
  parts,
  selected,
  onSelect,
  exploded,
  view,
  spin = false,
  scrub = false,
  frameRequest = 0,
  zoomRequest,
  room,
  showRoom = false,
  showDims = false,
  theme = 'light',
  snapshotRequest = 0,
  caption = '',
  onSnapshot,
  onSpinSuppressed,
}: {
  params: Design;
  parts: Part[];
  selected: string[];
  /** `extend` é o shift+clique: o chamador expande para o conjunto. */
  onSelect: (id: string | null, extend?: boolean) => void;
  exploded: boolean;
  view: ViewMode;
  spin?: boolean;
  scrub?: boolean;
  /** Muda para reenquadrar o móvel inteiro na vista atual. */
  frameRequest?: number;
  zoomRequest?: { id: number; direction: 'in' | 'out' };
  room?: Room;
  showRoom?: boolean;
  showDims?: boolean;
  theme?: SceneTheme;
  /** Muda para gerar um PNG da vista atual, com as cotas e a legenda. */
  snapshotRequest?: number;
  caption?: string;
  onSnapshot?: (dataUrl: string) => void;
  /**
   * Avisa o painel quando o sistema pede menos movimento. Nesse caso a
   * rotação automática é suprimida e o botão Girar não tem efeito nenhum.
   */
  onSpinSuppressed?: (suppressed: boolean) => void;
}) {
  const [hover, setHover] = useState<{
    id: string;
    x: number;
    y: number;
    flip: boolean;
  } | null>(null);
  const host = useRef<HTMLDivElement>(null),
    labelHost = useRef<HTMLDivElement>(null),
    callback = useRef(onSelect),
    runtime = useRef<Runtime | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    callback.current = onSelect;
  }, [onSelect]);
  const spinNotice = useRef(onSpinSuppressed);
  useEffect(() => {
    spinNotice.current = onSpinSuppressed;
  }, [onSpinSuppressed]);
  const snapshotSink = useRef(onSnapshot);
  useEffect(() => {
    snapshotSink.current = onSnapshot;
  }, [onSnapshot]);
  // O botão Girar precisa saber que a rotação está suprimida, inclusive se a
  // preferência mudar com a página aberta.
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const notify = () => {
      spinNotice.current?.(query.matches);
    };
    notify();
    query.addEventListener('change', notify);
    return () => {
      query.removeEventListener('change', notify);
    };
  }, []);
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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    el.insertBefore(renderer.domElement, el.firstChild);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(34, 1, 10, 60000),
      controls = new OrbitControls(camera, renderer.domElement);
    // Luz de ambiente de estúdio: reflexos suaves no laminado e no veio, que a
    // luz direcional sozinha não dá.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    scene.environmentIntensity = 0.55;
    controls.enableDamping = true;
    controls.minDistance = 400;
    controls.maxDistance = 8000;
    controls.maxPolarAngle = Math.PI * 0.49;
    const motion = new FurnitureMotion(scene);
    scene.add(new THREE.HemisphereLight(0xfffaf2, 0xcabfae, 0.9));
    const sun = new THREE.DirectionalLight(0xfff4e6, 2.6);
    sun.position.set(-1800, 3600, 2600);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 6;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0xe8f0ff, 0.55);
    fill.position.set(2600, 1400, 1800);
    scene.add(fill);
    const shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(40000, 40000),
      new THREE.ShadowMaterial({ opacity: 0.16 }),
    );
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.position.y = 0.2;
    shadowFloor.receiveShadow = true;
    scene.add(shadowFloor);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: groundTexture(), transparent: true, depthWrite: false }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1;
    ground.renderOrder = -1;
    scene.add(ground);
    const grid = new THREE.GridHelper(12000, 24, 0xcfc8bb, 0xe4dfd6);
    grid.position.y = -2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    scene.add(grid);
    const state: Runtime = {
      motion,
      renderer,
      scene,
      camera,
      controls,
      sun,
      grid,
      ground,
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)'),
      labelEls: [],
    };
    runtime.current = state;
    controls.addEventListener('start', () => {
      state.move = undefined;
    });
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
        e.shiftKey,
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
      setHover({ id, x, y: Math.min(e.clientY - box.top, box.height - 100), flip: x > box.width - 230 });
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
    const projected = new THREE.Vector3();
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
      // Rótulos das cotas: HTML nítido em qualquer zoom, reposicionado a cada
      // quadro direto no DOM, sem passar pelo React.
      if (state.dims && state.labelEls.length) {
        const w = el.clientWidth,
          h = el.clientHeight;
        state.dims.labels.forEach((label, i) => {
          const node = state.labelEls[i];
          if (!node) return;
          projected.copy(label.at).project(camera);
          const hidden = projected.z > 1 || Math.abs(projected.x) > 1.2 || Math.abs(projected.y) > 1.2;
          node.style.opacity = hidden ? '0' : '1';
          node.style.transform = `translate(${((projected.x + 1) / 2) * w}px, ${((1 - projected.y) / 2) * h}px) translate(-50%, -50%)`;
        });
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      motion.dispose();
      state.room?.dispose();
      state.dims?.dispose();
      shadowFloor.geometry.dispose();
      shadowFloor.material.dispose();
      ground.geometry.dispose();
      ground.material.map?.dispose();
      ground.material.dispose();
      grid.geometry.dispose();
      const mats = Array.isArray(grid.material)
        ? grid.material
        : [grid.material];
      mats.forEach((m) => m.dispose());
      sun.shadow.dispose();
      environment.dispose();
      pmrem.dispose();
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
  // Cor do chão e da grade acompanham o tema da página.
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    const c = PALETTE[theme];
    const [major, minor] = c.grid;
    const colors = s.grid.geometry.getAttribute('color');
    // GridHelper grava a cor por vértice: repintar em vez de recriar.
    for (let i = 0; i < colors.count; i++) {
      const isCenter = i < 4;
      const color = new THREE.Color(isCenter ? major : minor);
      colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
    s.ground.material.color.set(c.ground);
    s.ground.material.opacity = c.groundOpacity;
  }, [theme]);
  const bounds: SceneBounds = useMemo(() => generateComposition(params).bounds, [params]);
  const sceneRoom = showRoom ? room : undefined;
  // Ambiente: reconstruído quando o móvel muda de envelope, o ambiente muda
  // ou o tema troca. É pouca geometria; recriar é mais simples que ajustar.
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    s.room?.dispose();
    if (s.room) s.scene.remove(s.room.group);
    s.room = undefined;
    if (sceneRoom) {
      s.room = buildRoom(sceneRoom, bounds, theme);
      s.scene.add(s.room.group);
    }
    s.grid.visible = !sceneRoom;
  }, [sceneRoom, bounds, theme]);
  // Cotas: some no explodido, onde as peças não estão na medida real.
  const [dimLabels, setDimLabels] = useState<DimLabel[]>([]);
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    if (s.dims) {
      s.scene.remove(s.dims.lines);
      s.dims.dispose();
      s.dims = undefined;
    }
    if (showDims && !exploded) {
      s.dims = buildDims(parts, bounds, sceneRoom, PALETTE[theme].dim);
      s.scene.add(s.dims.lines);
      setDimLabels(s.dims.labels);
    } else setDimLabels([]);
  }, [showDims, exploded, parts, bounds, sceneRoom, theme]);
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    s.labelEls = labelHost.current
      ? (Array.from(labelHost.current.children) as HTMLSpanElement[])
      : [];
  }, [dimLabels]);
  useEffect(() => {
    const state = runtime.current;
    if (!state || !zoomRequest) return;
    const offset = state.camera.position.clone().sub(state.controls.target);
    const factor = zoomRequest.direction === 'in' ? 0.8 : 1.25;
    const distance = THREE.MathUtils.clamp(offset.length() * factor, state.controls.minDistance, state.controls.maxDistance);
    state.move = {
      from: state.camera.position.clone(),
      to: state.controls.target.clone().add(offset.setLength(distance)),
      targetFrom: state.controls.target.clone(),
      targetTo: state.controls.target.clone(),
      started: performance.now(),
    };
  }, [zoomRequest]);
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    // Com o ambiente à vista, o quadro inclui a parede inteira.
    const box = sceneRoom ? union(bounds, roomExtent(sceneRoom, bounds)) : bounds;
    // O explodido afasta cada peça do centro do seu módulo: enquadrar pelo
    // tamanho canônico deixava o tampo fora do quadro e sob o selo de medidas.
    const growth = exploded ? SPREAD_MM * 2 : 0;
    const width = box.max[0] - box.min[0];
    const height = box.max[1] - box.min[1];
    const depth = box.max[2] - box.min[2];
    const scale = Math.max(
        height + growth * 1.5,
        (width + growth) * 1.5,
        (depth + growth) * 1.5,
      ),
      target = new THREE.Vector3(
        (box.min[0] + box.max[0]) / 2,
        (box.min[1] + box.max[1]) / 2,
        (box.min[2] + box.max[2]) / 2,
      );
    // A distância permitida precisa crescer com uma composição larga. O
    // limite fixo de 8 m cortava projetos com vários módulos.
    s.controls.maxDistance = Math.max(8000, scale * 5);
    // A sombra acompanha o tamanho da cena: numa fileira de 4 m a câmera de
    // sombra fixa cortava a sombra dos módulos da ponta.
    const reach = Math.max(width, depth, height) * 0.9 + 600;
    Object.assign(s.sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 10, far: reach * 6 });
    s.sun.shadow.camera.updateProjectionMatrix();
    s.sun.target.position.copy(target);
    // Sol alto e pouco à frente: a sombra fica junto da base, como luz de
    // ambiente interno, em vez de uma cunha comprida atrás do móvel.
    s.sun.position.copy(target).add(new THREE.Vector3(-reach * 0.35, reach * 2.2, reach * 0.75));
    s.ground.scale.set(Math.max(width, 1200) * 3.2, Math.max(depth, 1200) * 5, 1);
    s.ground.position.set(target.x, -1, target.z);
    s.grid.position.set(target.x, -2, target.z);
    let to: THREE.Vector3;
    const resetDirection = !s.view || s.view.mode !== view || s.view.frameRequest !== frameRequest;
    if (resetDirection || !s.view) {
      if (view === 'front')
        to = new THREE.Vector3(0, height * 0.2, scale * 2.15);
      else if (view === 'side')
        to = new THREE.Vector3(scale * 2.15, height * 0.2, 0);
      else if (view === 'top')
        to = new THREE.Vector3(0, scale * 2.2, 0.02);
      else
        to = new THREE.Vector3(scale * 1.05, height * 0.25, scale * 2.15);
      to.add(target);
    } else {
      const previousScale = Math.max(
        s.view.height,
        s.view.width * 1.5,
        s.view.depth * 1.5,
      );
      to = s.camera.position
        .clone()
        .sub(s.controls.target)
        .multiplyScalar(scale / previousScale)
        .add(target);
    }
    // Vista de topo precisa passar do limite polar; as outras ficam acima do piso.
    s.controls.maxPolarAngle = view === 'top' ? Math.PI : Math.PI * 0.49;
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
    s.view = {
      height,
      width,
      depth,
      mode: view,
      frameRequest,
    };
  }, [bounds, view, scrub, exploded, frameRequest, sceneRoom]);
  // Foto da vista: a cena renderizada agora (o buffer WebGL não é preservado)
  // composta com as cotas e uma legenda, num PNG do tamanho da tela.
  // A foto sai uma vez por pedido: legenda ou tema mudando depois não geram
  // outro download.
  const handledSnapshot = useRef(0);
  useEffect(() => {
    const s = runtime.current;
    const el = host.current;
    if (!s || !el || !snapshotRequest || handledSnapshot.current === snapshotRequest) return;
    handledSnapshot.current = snapshotRequest;
    s.renderer.render(s.scene, s.camera);
    const source = s.renderer.domElement;
    const out = document.createElement('canvas');
    out.width = source.width;
    out.height = source.height;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    const ratio = source.width / Math.max(el.clientWidth, 1);
    const bg = ctx.createLinearGradient(0, 0, 0, out.height);
    const css = getComputedStyle(el);
    bg.addColorStop(0, css.getPropertyValue('--stage-top').trim() || '#f6f3ee');
    bg.addColorStop(1, css.getPropertyValue('--stage-bottom').trim() || '#ebe6de');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(source, 0, 0);
    const ink = css.getPropertyValue('--ink').trim() || '#1f2a22';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${12 * ratio}px Inter, "Segoe UI", sans-serif`;
    const projected = new THREE.Vector3();
    for (const label of s.dims?.labels ?? []) {
      projected.copy(label.at).project(s.camera);
      if (projected.z > 1) continue;
      const x = ((projected.x + 1) / 2) * out.width,
        y = ((1 - projected.y) / 2) * out.height;
      const w = ctx.measureText(label.text).width + 14 * ratio;
      ctx.fillStyle = theme === 'dark' ? 'rgba(24,26,28,0.92)' : 'rgba(255,255,255,0.94)';
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - 11 * ratio, w, 22 * ratio, 11 * ratio);
      ctx.fill();
      ctx.fillStyle = label.tone === 'free' ? '#3f8f5a' : ink;
      ctx.fillText(label.text, x, y);
    }
    if (caption) {
      ctx.textAlign = 'left';
      ctx.fillStyle = ink;
      ctx.font = `700 ${15 * ratio}px Inter, "Segoe UI", sans-serif`;
      ctx.fillText(caption, 22 * ratio, out.height - 26 * ratio);
      ctx.textAlign = 'right';
      ctx.font = `600 ${12 * ratio}px Inter, "Segoe UI", sans-serif`;
      ctx.globalAlpha = 0.6;
      ctx.fillText('merce · estúdio de móveis', out.width - 22 * ratio, out.height - 26 * ratio);
      ctx.globalAlpha = 1;
    }
    snapshotSink.current?.(out.toDataURL('image/png'));
  }, [snapshotRequest, caption, theme]);
  const hoveredPart = hover ? parts.find((v) => v.id === hover.id) : undefined;
  return (
    <div
      ref={host}
      className="scene"
      role="application"
      aria-label="Modelo 3D interativo. Arraste para girar, use a roda para aproximar, arraste com o botão direito para mover e clique para selecionar peças."
    >
      <div className="scene-dims" ref={labelHost} aria-hidden="true">
        {dimLabels.map((label, i) => (
          <span key={i + label.text} className={'dim-label ' + label.tone}>
            {label.text}
          </span>
        ))}
      </div>
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

function union(a: SceneBounds, b: SceneBounds): SceneBounds {
  return {
    min: a.min.map((v, i) => Math.min(v, b.min[i])),
    max: a.max.map((v, i) => Math.max(v, b.max[i])),
  };
}
