'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { materials, type Part } from '@/lib/furniture';
import type { Design } from '@/lib/studio';
import type { Room } from '@/lib/room';
import { feetOf, generateComposition } from '@/lib/composition';
import { buildFeet, buildRoom, referenceRoom, roomFocus, type SceneBounds } from '@/lib/scene-room';
import { buildDims, type DimLabel } from '@/lib/scene-dims';
import {
  FurnitureMotion,
  SPREAD_MM,
  ease,
  SCRUB_MS,
  TRANSITION_MS,
} from '@/lib/furniture-motion';
import { DIFF_GLOW } from '@/lib/scene-materials';
import type { ModularOp } from '@/lib/composition';
import { MOVE_GRID, moduleBoxes, moveGroup, moveOp, quickBlock, rotateOp, selectedGroup, shortMm, snapDelta, tryOp, type MoveGroup, type Vec3 } from '@/lib/move';
import { wallAt } from '@/lib/room';
import { MovePad, type NudgeDir } from './move-pad';
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
  feet?: { group: THREE.Group; dispose: () => void };
  ghosts?: { group: THREE.Group; dispose: () => void };
  dims?: { lines: THREE.LineSegments; labels: DimLabel[]; dispose: () => void };
  labelEls: HTMLSpanElement[];
  /** Móvel em movimento (arrasto ou setas), ainda não gravado. */
  preview?: { group: MoveGroup; delta: Vec3; blocked: boolean };
  showPreview?: () => void;
  commitPreview?: () => void;
  /** Prévia enviada para gravar: o projeto que volta já traz este lugar. */
  committing?: { group: MoveGroup; delta: Vec3 };
  /** Até quando a câmera fica parada: mover à mão não reenquadra a cena. */
  holdFrame?: number;
  /**
   * Algo fora das peças mudou (câmera, ambiente, cotas, tema, tamanho): o
   * próximo quadro redesenha. Parada, a cena não gasta GPU nenhuma.
   */
  dirty: boolean;
};
/** Setas do teclado e a direção de cada uma no controle. */
const ARROW_KEYS: Record<string, NudgeDir> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'back',
  ArrowDown: 'front',
  PageUp: 'up',
  PageDown: 'down',
};
/** Onde as setas já têm dono: campos, sliders, listas e menus. */
const OWNS_ARROWS =
  'input, textarea, select, [contenteditable="true"], [role="slider"], [role="listbox"], [role="menu"], [role="tablist"], [role="radiogroup"], [role="dialog"], [role="combobox"]';
/** Depois do último toque numa seta, grava o lugar novo. */
const NUDGE_COMMIT_MS = 450;

/** Frase curta do motivo do bloqueio: "Bate em Estante", o outro móvel. */
function blockedText(reason: string, d?: { modules: { id: string; name: string }[] }, group?: MoveGroup) {
  const overlap = /Módulos sobrepostos: (.+?) e (.+?)\./.exec(reason);
  if (overlap) {
    const mine = new Set(group?.members.map((id) => d?.modules.find((m) => m.id === id)?.name));
    return `Bate em ${[overlap[1], overlap[2]].find((n) => !mine.has(n)) ?? overlap[2]}`;
  }
  if (/Interpenetração/.test(reason)) return 'Encosta em outra peça';
  return reason.replace(/ Ajuste o posicionamento\.?$/, '');
}
/** "35 cm à direita · 10 cm para a frente", no eixo do mundo. */
function deltaText(delta: Vec3) {
  const out: string[] = [];
  if (delta[0]) out.push(`${shortMm(delta[0])} ${delta[0] > 0 ? 'à direita' : 'à esquerda'}`);
  if (delta[2]) out.push(`${shortMm(delta[2])} ${delta[2] > 0 ? 'para a frente' : 'para o fundo'}`);
  if (delta[1]) out.push(`${shortMm(delta[1])} ${delta[1] > 0 ? 'acima' : 'abaixo'}`);
  return out.join(' · ') || 'No lugar de origem';
}
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

export default memo(FurnitureView);

function FurnitureView({
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
  diff = null,
  movable = false,
  onMove,
  keyboard = true,
}: {
  /** Pode mover o móvel selecionado (fora do explodido, sem turno em curso). */
  movable?: boolean;
  /**
   * Grava o móvel no lugar novo. `shiftX` é quanto a borda esquerda do
   * projeto andou: com ambiente real, a parede fica onde está.
   */
  onMove?: (op: ModularOp, label: string, shiftX: number) => Promise<unknown>;
  /** Setas movem o móvel selecionado. Desligado com diálogos abertos. */
  keyboard?: boolean;
  /**
   * Diff do turno na cena: o que entrou e mudou brilha, o que saiu aparece
   * como fantasma vermelho, e `focus` acende só as peças da linha da conversa.
   */
  diff?: { added: string[]; changed: string[]; removed: Part[]; focus?: string[] | null } | null;
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
  // O arrasto vive nos ouvintes da montagem: lê o projeto e a seleção do
  // render atual por aqui.
  const bounds: SceneBounds = useMemo(() => generateComposition(params).bounds, [params]);
  // Onde o fundo de um módulo fica no lugar de origem (centro em z = 0): a
  // parede de referência se prende ali, e o móvel afasta dela sem levá-la.
  const homeZ = useMemo(
    () =>
      -Math.max(
        0,
        ...params.modules.filter((m) => m.kind !== 'panel').map((m) => (m.rotation % 180 ? m.width : m.depth)),
      ) / 2,
    [params],
  );
  // A parede limita o arrasto para trás: a real, ou a de referência.
  const wallZ = room ? wallAt(room, bounds).z : Math.min(bounds.min[2], homeZ);
  const latest = useRef({ params, parts, selected, movable, onMove, wallZ });
  useEffect(() => {
    latest.current = { params, parts, selected, movable, onMove, wallZ };
  }, [params, parts, selected, movable, onMove, wallZ]);
  const lastParams = useRef(params);
  const [moveTip, setMoveTip] = useState<{ x: number; y: number; text: string; bad: boolean } | null>(null);
  const [moveStatus, setMoveStatus] = useState<{ text: string; bad?: boolean } | null>(null);
  const dragging = useRef(false);
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
      dirty: true,
    };
    runtime.current = state;
    /**
     * Passa a prévia ao controlador de peças, que desliza o conjunto até lá.
     * Sem prévia, o conjunto desliza de volta ao lugar gravado.
     */
    const showPreview = () => {
      const p = state.preview;
      if (!p) {
        motion.setDrag(null);
        return;
      }
      const modules = new Set(p.group.members);
      const ids = new Set(
        latest.current.parts.filter((v) => (v as { owners?: string[] }).owners?.some((o) => modules.has(o))).map((v) => v.id),
      );
      motion.setDrag({ ids, modules, offset: new THREE.Vector3(...p.delta), blocked: p.blocked });
    };
    state.showPreview = showPreview;
    /** Grava a prévia; bloqueada ou parada, o móvel volta ao lugar. */
    const commitPreview = () => {
      const p = state.preview;
      if (!p) return;
      const now = latest.current;
      if (p.blocked || !p.delta.some((v) => v !== 0) || !now.onMove) {
        state.preview = undefined;
        showPreview();
        if (p.blocked) setMoveStatus({ text: 'Não coube ali: voltou ao lugar', bad: true });
        return;
      }
      const op = moveOp(now.params, p.group, p.delta);
      const check = tryOp(now.params, op);
      if (!check.ok) {
        state.preview = undefined;
        showPreview();
        setMoveStatus({ text: blockedText(check.reason, now.params, p.group), bad: true });
        return;
      }
      const shiftX = generateComposition(check.design).bounds.min[0] - generateComposition(now.params).bounds.min[0];
      setMoveStatus({ text: deltaText(p.delta) });
      state.holdFrame = performance.now() + 5000;
      state.committing = { group: p.group, delta: p.delta };
      void now
        .onMove(op, `Moveu ${p.group.label}`, shiftX)
        .catch(() => setMoveStatus({ text: 'Não foi possível gravar: voltou ao lugar', bad: true }))
        .finally(() => {
          // Com o projeto novo a prévia já saiu; se não gravou, desliza de volta.
          if (state.preview === p) {
            state.preview = undefined;
            state.committing = undefined;
            showPreview();
          }
        });
    };
    state.commitPreview = commitPreview;
    controls.addEventListener('start', () => {
      state.move = undefined;
    });
    // Girar, aproximar e o amortecimento mexem na câmera: redesenha.
    controls.addEventListener('change', () => {
      state.dirty = true;
    });
    const ray = new THREE.Raycaster();
    let down = [0, 0];
    const aim = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, (-(e.clientY - r.top) / r.height) * 2 + 1),
        camera,
      );
    };
    // Arrasto do móvel: começa numa peça já selecionada. O plano segue a
    // câmera: de cima, o piso (x e z); de frente, a parede (x e altura).
    let drag: {
      group: MoveGroup;
      plane: THREE.Plane;
      from: THREE.Vector3;
      vertical: boolean;
      boxes: ReturnType<typeof moduleBoxes>;
      key: string;
    } | null = null;
    const hit = new THREE.Vector3();
    const start = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
      const now = latest.current;
      if (e.button !== 0 || !now.movable || !e.isPrimary) return;
      aim(e);
      const first = ray.intersectObjects(motion.pickable(), false)[0];
      const id = first?.object.userData.id as string | undefined;
      if (!first || !id || !now.selected.includes(id)) return;
      const owner = (now.parts.find((p) => p.id === id) as { owners?: string[] } | undefined)?.owners?.[0];
      const group = owner ? moveGroup(now.params, owner) : null;
      if (!group) return;
      const view = camera.getWorldDirection(new THREE.Vector3());
      const floorView = Math.abs(view.y) > 0.35;
      const normal = floorView ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(-view.x, 0, -view.z).normalize();
      // Painel, aéreo e o que já está no alto também sobem e descem.
      const lifts = group.members.some((mid) => {
        const m = now.params.modules.find((v) => v.id === mid);
        return !!m && (m.kind === 'panel' || !!m.wall || m.position[1] > 0);
      });
      drag = {
        group,
        plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, first.point),
        from: first.point.clone(),
        vertical: !floorView && lifts,
        boxes: moduleBoxes(now.params),
        key: '0,0,0',
      };
      // Antes do OrbitControls (ouvinte de captura): o arrasto não gira a câmera.
      controls.enabled = false;
      dragging.current = true;
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // Sem captura o arrasto termina quando o ponteiro sai da cena.
      }
      el.style.cursor = 'grabbing';
      state.move = undefined;
      setHover(null);
    };
    const dragMove = (e: PointerEvent) => {
      if (!drag) return;
      aim(e);
      if (!ray.ray.intersectPlane(drag.plane, hit)) return;
      const raw = hit.clone().sub(drag.from);
      if (!drag.vertical) raw.y = 0;
      const now = latest.current;
      const delta = snapDelta(now.params, drag.group, [raw.x, raw.y, raw.z], drag.boxes, now.wallZ);
      const key = delta.join(',');
      const box = el.getBoundingClientRect();
      const x = e.clientX - box.left,
        y = e.clientY - box.top;
      if (key !== drag.key) {
        drag.key = key;
        // Durante o arrasto só as caixas dos módulos: rápido a cada passo. A
        // regra completa, peça por peça, confere ao soltar.
        const hitName = delta.some((v) => v !== 0) ? quickBlock(now.params, drag.group, delta, drag.boxes) : null;
        state.preview = { group: drag.group, delta, blocked: !!hitName };
        showPreview();
        setMoveTip({ x, y, text: hitName ? `Bate em ${hitName}` : deltaText(delta), bad: !!hitName });
      } else setMoveTip((tip) => (tip ? { ...tip, x, y } : tip));
    };
    const dragEnd = () => {
      if (!drag) return;
      drag = null;
      controls.enabled = true;
      dragging.current = false;
      el.style.cursor = '';
      setMoveTip(null);
      commitPreview();
    };
    const pick = (e: PointerEvent) => {
      if (drag) {
        dragEnd();
        return;
      }
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
    renderer.domElement.addEventListener('pointerdown', start, { capture: true });
    renderer.domElement.addEventListener('pointerup', pick);
    renderer.domElement.addEventListener('pointercancel', dragEnd);
    renderer.domElement.addEventListener('pointermove', dragMove);
    const hover = (e: PointerEvent) => {
      if (drag) return;
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
      state.dirty = true;
    });
    resize.observe(el);
    const projected = new THREE.Vector3();
    let frame = 0,
      dimsShown = true;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      motion.tick(now, state.reduced.matches);
      if (state.move) {
        state.dirty = true;
        const m = state.move,
          t = state.reduced.matches
            ? 1
            : ease((now - m.started) / TRANSITION_MS);
        camera.position.lerpVectors(m.from, m.to, t);
        controls.target.lerpVectors(m.targetFrom, m.targetTo, t);
        if (t === 1) state.move = undefined;
      }
      controls.update();
      // Nada mudou desde o último quadro: a imagem na tela continua certa.
      if (!motion.takeChanged() && !state.dirty) return;
      state.dirty = false;
      // Pés andam com o móvel; cotas são do lugar gravado e esperam parar.
      if (state.feet)
        for (const foot of state.feet.group.children) {
          const { moduleId, home } = foot.userData as { moduleId?: string; home?: THREE.Vector3 };
          if (!home) continue;
          const offset = moduleId ? motion.dragOffset(moduleId) : null;
          foot.position.copy(home);
          if (offset) foot.position.add(offset);
        }
      const settled = !motion.moving && !state.preview;
      if (state.dims) state.dims.lines.visible = settled;
      if (labelHost.current && dimsShown !== settled) {
        dimsShown = settled;
        labelHost.current.style.visibility = settled ? '' : 'hidden';
      }
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
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      motion.dispose();
      state.room?.dispose();
      state.feet?.dispose();
      state.ghosts?.dispose();
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
    // Projeto novo com o móvel gravado no lugar: o que já andou na tela vira
    // a diferença, que desliza até zero. Sem voltar ao lugar antigo.
    if (state && lastParams.current !== params) {
      lastParams.current = params;
      if (state.committing && state.preview && !dragging.current) {
        state.motion.rebaseDrag(new THREE.Vector3(...state.committing.delta));
        state.preview = undefined;
        state.committing = undefined;
      } else if (state.preview && !dragging.current) {
        state.preview = undefined;
        state.showPreview?.();
      }
    }
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
  // Diff: as marcas vão para o controlador de peças; o que saiu vira um
  // fantasma translúcido na pose de antes, para a pessoa ver o que foi embora.
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    s.motion.setDiff(
      diff
        ? {
            added: new Set(diff.added),
            changed: new Set(diff.changed),
            focus: diff.focus?.length ? new Set(diff.focus) : null,
          }
        : null,
    );
    if (s.ghosts) {
      s.scene.remove(s.ghosts.group);
      s.ghosts.dispose();
      s.ghosts = undefined;
      s.dirty = true;
    }
    if (!diff?.removed.length) return;
    const group = new THREE.Group();
    group.name = 'removidas';
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const edgesGeo = new THREE.EdgesGeometry(geo);
    const fill = new THREE.MeshBasicMaterial({ color: DIFF_GLOW.removed, transparent: true, opacity: 0.14, depthWrite: false });
    const line = new THREE.LineBasicMaterial({ color: DIFF_GLOW.removed, transparent: true, opacity: 0.85 });
    for (const part of diff.removed) {
      const mesh = new THREE.Mesh(geo, fill);
      mesh.position.set(...part.position);
      mesh.rotation.y = part.rotation ?? 0;
      mesh.scale.set(...part.size);
      mesh.renderOrder = 3;
      mesh.add(new THREE.LineSegments(edgesGeo, line));
      group.add(mesh);
    }
    s.scene.add(group);
    s.dirty = true;
    s.ghosts = {
      group,
      dispose() {
        geo.dispose();
        edgesGeo.dispose();
        fill.dispose();
        line.dispose();
      },
    };
  }, [diff]);
  useEffect(() => {
    const state = runtime.current;
    if (state) state.motion.setHover(hover?.id ?? null);
    // Sobre uma peça já selecionada, a mão avisa que dá para arrastar.
    if (host.current && !dragging.current)
      host.current.style.cursor = hover ? (movable && selected.includes(hover.id) ? 'grab' : 'pointer') : '';
  }, [hover, movable, selected]);
  // Mover pelo controle e pelas setas: cada toque anda um passo na prévia e,
  // parado um instante, o lugar novo é gravado numa versão só.
  const target = useMemo(() => selectedGroup(params, parts, selected), [params, parts, selected]);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
  }, []);
  // Trocou a seleção com um movimento pendente: grava o que já andou.
  useEffect(() => {
    const s = runtime.current;
    if (s?.preview && s.preview.group.root !== target?.root && !dragging.current) {
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
      s.commitPreview?.();
    }
  }, [target]);
  useEffect(() => {
    if (!moveStatus) return;
    const t = setTimeout(() => setMoveStatus(null), 2800);
    return () => clearTimeout(t);
  }, [moveStatus]);
  const nudge = (dir: NudgeDir, big: boolean) => {
    const s = runtime.current;
    if (!s || !target || !movable || dragging.current) return;
    const step = big ? 100 : MOVE_GRID;
    const move: Vec3 = [0, 0, 0];
    if (dir === 'up' || dir === 'down') move[1] = dir === 'up' ? step : -step;
    else {
      // As setas seguem a tela: direita de quem olha e "para o fundo" é
      // se afastar da câmera, cada uma no eixo do piso mais próximo.
      const right = new THREE.Vector3().setFromMatrixColumn(s.camera.matrixWorld, 0);
      const away = new THREE.Vector3().setFromMatrixColumn(s.camera.matrixWorld, 1);
      away.y = 0;
      if (away.lengthSq() < 0.04) away.copy(s.camera.getWorldDirection(new THREE.Vector3())).setY(0);
      const ax = Math.abs(right.x) >= Math.abs(right.z) ? 0 : 2;
      const fax = ax === 0 ? 2 : 0;
      const sign = Math.sign(ax === 0 ? right.x : right.z) || 1;
      const fsign = Math.sign(fax === 0 ? away.x : away.z) || -1;
      if (dir === 'right') move[ax] = sign * step;
      if (dir === 'left') move[ax] = -sign * step;
      if (dir === 'back') move[fax] = fsign * step;
      if (dir === 'front') move[fax] = -fsign * step;
    }
    const current: Vec3 = s.preview?.group.root === target.root ? s.preview.delta : [0, 0, 0];
    const root = params.modules.find((m) => m.id === target.root);
    const next = current.map((v, i) => v + move[i]) as Vec3;
    if (root) next[1] = Math.max(next[1], -root.position[1]);
    if (next.every((v, i) => v === current[i])) {
      setMoveStatus({ text: 'Já está no piso', bad: true });
      return;
    }
    const boxes = moduleBoxes(params);
    const mine = target.members.map((id) => boxes.get(id)).filter((b) => !!b);
    const back = Math.min(...mine.map((b) => b!.min[2]));
    if (next[2] < current[2] && back + next[2] < wallZ - 0.5) {
      setMoveStatus({ text: 'Encostado na parede', bad: true });
      return;
    }
    const hitName = next.some((v) => v !== 0) ? quickBlock(params, target, next, boxes) : null;
    if (hitName) {
      setMoveStatus({ text: `Bate em ${hitName}`, bad: true });
      return;
    }
    s.preview = { group: target, delta: next, blocked: false };
    s.showPreview?.();
    setMoveStatus({ text: deltaText(next) });
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(() => runtime.current?.commitPreview?.(), NUDGE_COMMIT_MS);
  };
  const rotate = () => {
    if (!target || !movable || !onMove) return;
    if (runtime.current?.preview) {
      setMoveStatus({ text: 'Gravando o movimento: gire em seguida' });
      return;
    }
    const op = rotateOp(params, target);
    const check = tryOp(params, op);
    if (!check.ok) {
      setMoveStatus({ text: `Não gira aqui: ${blockedText(check.reason, params, target)}`, bad: true });
      return;
    }
    const shiftX = generateComposition(check.design).bounds.min[0] - generateComposition(params).bounds.min[0];
    setMoveStatus({ text: 'Girou 90°' });
    if (runtime.current) runtime.current.holdFrame = performance.now() + 5000;
    void onMove(op, `Girou ${target.label}`, shiftX).catch(() => setMoveStatus({ text: 'Não foi possível gravar o giro', bad: true }));
  };
  const nudgeKey = useRef(nudge);
  useEffect(() => {
    nudgeKey.current = nudge;
  });
  // Setas do teclado movem o móvel selecionado (PageUp e PageDown, a altura).
  useEffect(() => {
    if (!keyboard) return;
    const down = (e: KeyboardEvent) => {
      const dir = ARROW_KEYS[e.key];
      if (!dir || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.(OWNS_ARROWS)) return;
      if (!latest.current.movable || !latest.current.selected.length) return;
      e.preventDefault();
      nudgeKey.current(dir, e.shiftKey);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [keyboard]);
  useEffect(() => {
    const state = runtime.current;
    if (state) state.controls.autoRotate = spin && !state.reduced.matches;
    if (state) state.dirty = true;
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
    s.dirty = true;
  }, [theme]);
  // Sem ambiente informado, uma parede de referência dá escala e fundo; ela
  // não aparece nas cotas de espaço livre nem no enquadramento.
  const sceneRoom = useMemo(
    () => (showRoom ? (room ?? referenceRoom(bounds, homeZ)) : undefined),
    [showRoom, room, bounds, homeZ],
  );
  const measuredRoom = showRoom ? room : undefined;
  // Frente do que está preso na parede (painel): a TV fica na frente dele.
  const mountZ = useMemo(
    () => Math.max(-Infinity, ...parts.filter((p) => p.kind === 'panel').map((p) => p.position[2] + p.size[2] / 2)),
    [parts],
  );
  // Ambiente: reconstruído quando o móvel muda de envelope, o ambiente muda
  // ou o tema troca. É pouca geometria; recriar é mais simples que ajustar.
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    s.room?.dispose();
    if (s.room) s.scene.remove(s.room.group);
    s.room = undefined;
    if (sceneRoom) {
      s.room = buildRoom(sceneRoom, bounds, theme, mountZ);
      s.scene.add(s.room.group);
    }
    s.grid.visible = !sceneRoom;
    s.dirty = true;
  }, [sceneRoom, bounds, theme, mountZ]);
  // Pés: não são peças de corte, vêm da composição. Somem no explodido.
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    s.dirty = true;
    if (s.feet) {
      s.scene.remove(s.feet.group);
      s.feet.dispose();
      s.feet = undefined;
    }
    const feet = exploded ? [] : feetOf(params);
    if (!feet.length) return;
    const colorOf = (id: string) => {
      const m = params.modules.find((v) => v.id === id);
      return materials.find((v) => v.id === m?.materialId)?.color ?? '#888888';
    };
    s.feet = buildFeet(feet, colorOf);
    s.scene.add(s.feet.group);
  }, [params, exploded]);
  // Cotas: some no explodido, onde as peças não estão na medida real.
  const [dimLabels, setDimLabels] = useState<DimLabel[]>([]);
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    s.dirty = true;
    if (s.dims) {
      s.scene.remove(s.dims.lines);
      s.dims.dispose();
      s.dims = undefined;
    }
    if (showDims && !exploded) {
      s.dims = buildDims(parts, bounds, measuredRoom, PALETTE[theme].dim);
      s.scene.add(s.dims.lines);
      setDimLabels(s.dims.labels);
    } else setDimLabels([]);
  }, [showDims, exploded, parts, bounds, measuredRoom, theme]);
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    s.labelEls = labelHost.current
      ? (Array.from(labelHost.current.children) as HTMLSpanElement[])
      : [];
    // Rótulos novos só ganham lugar no próximo desenho.
    s.dirty = true;
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
    s.dirty = true;
    // Com o ambiente à vista, o quadro inclui o que está na parede perto do
    // móvel (porta, TV, tomada), não o quarto inteiro.
    const box = measuredRoom ? union(bounds, roomFocus(measuredRoom, bounds)) : bounds;
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
    // Móvel arrastado à mão: a câmera fica onde a pessoa deixou (sombra e
    // piso acima já acompanharam). F ou trocar a vista reenquadram.
    if (!resetDirection && s.view && (s.holdFrame ?? 0) > performance.now()) {
      s.holdFrame = undefined;
      s.view = { ...s.view, height, width, depth };
      return;
    }
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
  }, [bounds, view, scrub, exploded, frameRequest, measuredRoom]);
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
      aria-label="Modelo 3D interativo. Arraste para girar, use a roda para aproximar, arraste com o botão direito para mover a vista e clique para selecionar peças. Arraste uma peça selecionada, ou use as setas, para mudar o móvel de lugar."
    >
      {!error && onMove && (
        <MovePad
          target={target?.label ?? null}
          disabled={!movable}
          status={moveStatus}
          onNudge={nudge}
          onRotate={rotate}
        />
      )}
      {moveTip && (
        <output className={'move-tip' + (moveTip.bad ? ' bad' : '')} style={{ left: moveTip.x, top: moveTip.y }}>
          {moveTip.text}
        </output>
      )}
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
