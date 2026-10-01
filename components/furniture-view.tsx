'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Part } from '@/lib/furniture';
import type { Design } from '@/lib/studio';
import type { MainWallEdge, Obstacle, Room, Wall } from '@/lib/room';
import { generateComposition } from '@/lib/composition';
import { fittingsOf } from '@/lib/fittings';
import { buildFittings } from '@/lib/scene-fittings';
import { buildRoom, obstacleCrosses, referenceRoom, roomFocus, ROOM_PALETTE, type SceneBounds } from '@/lib/scene-room';
import { buildObstacle, tintFrame } from '@/lib/scene-obstacles';
import {
  buildWall,
  layoutWall,
  liveDimLines,
  mainHandlePoints,
  mainLiveDims,
  wallHandlePoints,
  wallLiveDims,
  type LiveDim,
  type WallFrame,
  type WallHandle,
} from '@/lib/scene-walls';
import { Pencil, RotateCw, Scissors, Trash2, X } from 'lucide-react';
import { buildDims, type DimLabel } from '@/lib/scene-dims';
import {
  FurnitureMotion,
  SPREAD_MM,
  ease,
  SCRUB_MS,
  TRANSITION_MS,
} from '@/lib/furniture-motion';
import { DIFF_GLOW } from '@/lib/scene-materials';
import { buildCutMarks, scissorsPose, type CutMarkMode } from '@/lib/cut-marks';
import type { ModularOp } from '@/lib/composition';
import { DEFAULT_DRAG_MODE, MOVE_GRID, constrainDrag, lockedAxes, moduleBoxes, moveGroup, moveOp, quickBlock, rotateOp, selectedGroup, shortMm, snapDelta, tryOp, type DragMode, type MoveGroup, type Vec3 } from '@/lib/move';
import {
  boxesCross,
  floorBound,
  MAIN_WALL,
  moveWallTo,
  obstacleOverlap,
  resizeMainWall,
  resizeWallEnd,
  resizeWallHeight,
  rotateWall,
  wallAt,
  wallBox,
  wallFootprint,
  wallName,
} from '@/lib/room';
import { MovePad, type NudgeDir } from './move-pad';
import { useDelayedTrue } from '@/hooks/use-delayed';
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
  shadowFloor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  reduced: MediaQueryList;
  move?: CameraMove;
  view?: { height: number; width: number; depth: number; mode: ViewMode; frameRequest: number };
  room?: ReturnType<typeof buildRoom>;
  /** Obstáculo novo seguindo o cursor na parede, antes do clique que o põe. */
  placing?: { group: THREE.Group; obstacle: Obstacle; x: number; y: number; blocked: string | null };
  /** Leva a prévia do obstáculo novo para x, y da parede (mm). */
  placeTo?: (x: number, y: number) => void;
  /** Põe o obstáculo novo onde a prévia está, se ali couber. */
  confirmPlacing?: () => void;
  /** Parede nova seguindo o cursor no piso, antes do clique que a põe. */
  placingWall?: { group: THREE.Group; wall: Wall };
  /** Leva a prévia da parede nova para x, z do ambiente (mm). */
  placeWallTo?: (x: number, z: number) => void;
  /** Gira a prévia da parede nova. */
  turnPlacingWall?: () => void;
  confirmPlacingWall?: () => void;
  /** Alças da parede escolhida (HTML por cima da cena): começo, arrasto e fim. */
  beginHandle?: (handle: WallHandle, e: PointerEvent) => boolean;
  moveHandle?: (e: PointerEvent) => void;
  endHandle?: () => void;
  /** Alça de parede sendo arrastada: as cotas de medida esperam ela parar. */
  wallDragging?: boolean;
  /** Cotas ao vivo do arrasto de uma alça: linhas na cena, rótulos em HTML. */
  liveDims?: { dims: LiveDim[]; lines: THREE.LineSegments; dispose: () => void };
  feet?: { group: THREE.Group; dispose: () => void };
  ghosts?: { group: THREE.Group; dispose: () => void };
  /** Tracejado de corte nas peças do plano sob o cursor; `scissors` é a peça que leva a tesoura. */
  cutMarks?: { marks: ReturnType<typeof buildCutMarks>; scissors: { mesh: THREE.Mesh; size: readonly number[] } | null };
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
  /**
   * Geometria e materiais trocados, descartados só depois do próximo quadro.
   * Descartar antes de desenhar o substituto zerava o uso do programa de
   * shader e o three.js o recompilava: ~100 ms travados a cada movimento.
   */
  retired: (() => void)[];
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

const OBSTACLE_WORD: Record<string, string> = {
  door: 'Porta',
  window: 'Janela',
  outlet: 'Tomada',
  column: 'Coluna',
  tv: 'TV',
  other: 'Obstáculo',
};
const OBSTACLE_ARTICLE: Record<string, string> = {
  door: 'a porta',
  window: 'a janela',
  outlet: 'a tomada',
  column: 'a coluna',
  tv: 'a TV',
  other: 'o obstáculo',
};

/** Chão de fundo bem abaixo do piso do ambiente: nunca disputa a mesma profundidade. */
const GROUND_UNDER_ROOM = -40;

/** Alças de uma parede do ambiente e da parede do fundo (que não sai do lugar). */
const WALL_HANDLES: WallHandle[] = ['start', 'end', 'top', 'move'];
const MAIN_HANDLES: WallHandle[] = ['start', 'end', 'top'];
function handleLabel(h: WallHandle, main: boolean) {
  if (h === 'move') return 'Arraste para mudar a parede de lugar';
  if (h === 'top') return main ? 'Arraste para mudar o pé-direito' : 'Arraste para mudar a altura';
  if (main) return h === 'start' ? 'Arraste para mudar a largura pela esquerda' : 'Arraste para mudar a largura pela direita';
  return 'Arraste para mudar o comprimento';
}
/** Metros com duas casas e vírgula: "2,70". */
const metresText = (mm: number) => (mm / 1000).toFixed(2).replace('.', ',');

/** Ordem de quem fica quando dois rótulos de cota se encostam. */
const LABEL_RANK: Record<DimLabel['tone'], number> = { main: 0, free: 1, module: 2 };
/** Tamanho medido de cada rótulo: o texto não muda enquanto o elemento vive. */
const labelSize = new WeakMap<HTMLElement, [number, number]>();

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
  steady = false,
  zoomRequest,
  room,
  showRoom = false,
  showDims = false,
  theme = 'light',
  snapshotRequest = 0,
  caption = '',
  onSnapshot,
  onSpinSuppressed,
  showMovePad = true,
  touch = false,
  diff = null,
  cutFocus = null,
  movable = false,
  onMove,
  onMoveObstacle,
  selectedObstacle = null,
  onSelectObstacle,
  placing = null,
  onPlace,
  onCancelPlace,
  onRemoveObstacle,
  onEditObstacle,
  selectedWall = null,
  onSelectWall,
  onChangeWall,
  onResizeMainWall,
  placingWall = null,
  onPlaceWall,
  onRemoveWall,
  onEditWall,
  keyboard = true,
}: {
  /** Parede escolhida (a do fundo é `MAIN_WALL`): destaque, alças e barra. */
  selectedWall?: string | null;
  onSelectWall?: (id: string | null) => void;
  /** Parede do ambiente arrastada, esticada ou girada na cena. */
  onChangeWall?: (w: Wall) => unknown;
  /** Alça da parede do fundo solta em `at` (mm: x do canto nas pontas, y do piso no topo). */
  onResizeMainWall?: (edge: MainWallEdge, at: number) => unknown;
  /** Parede nova esperando lugar: a prévia segue o cursor no piso até o clique. */
  placingWall?: Wall | null;
  onPlaceWall?: (w: Wall) => void;
  onRemoveWall?: (id: string) => void;
  onEditWall?: (id: string) => void;
  /** Obstáculo escolhido na parede (clique nele): moldura e barra de ações. */
  selectedObstacle?: string | null;
  onSelectObstacle?: (id: string | null) => void;
  /** Obstáculo novo esperando lugar: a prévia segue o cursor até o clique. */
  placing?: Obstacle | null;
  onPlace?: (o: Obstacle) => void;
  onCancelPlace?: () => void;
  onRemoveObstacle?: (id: string) => void;
  onEditObstacle?: (id: string) => void;
  /** Pode mover o móvel selecionado (fora do explodido, sem turno em curso). */
  movable?: boolean;
  /**
   * Grava o móvel no lugar novo. `shiftX` é quanto a borda esquerda do
   * projeto andou: com ambiente real, a parede fica onde está.
   */
  onMove?: (op: ModularOp, label: string, shiftX: number) => Promise<unknown>;
  /** Obstáculo da parede arrastado na cena: novo x e y em mm, pela parede. */
  onMoveObstacle?: (id: string, xMm: number, yMm: number) => unknown;
  /** Setas movem o móvel selecionado. Desligado com diálogos abertos. */
  keyboard?: boolean;
  /**
   * Diff do turno na cena: o que entrou e mudou brilha, o que saiu aparece
   * como fantasma vermelho, e `focus` acende só as peças da linha da conversa.
   * `dim: false` mantém o resto sólido (montagem ao vivo).
   */
  diff?: { added: string[]; changed: string[]; removed: Part[]; focus?: string[] | null; dim?: boolean } | null;
  /**
   * Plano de corte sob o cursor: tracejado de "corte aqui" nas peças. Numa
   * peça (`piece`) vem com a tesoura; na chapa inteira (`sheet`), mais leve.
   */
  cutFocus?: { ids: string[]; mode: CutMarkMode } | null;
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
  /**
   * Câmera parada mesmo que o envelope do móvel mude: a revisão das mudanças
   * troca o desenho passo a passo e reenquadrar a cada passo sacudia a cena.
   */
  steady?: boolean;
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
  /** O app no celular mostra o controle de mover só quando a pessoa pede. */
  showMovePad?: boolean;
  /**
   * Casca de toque: pôr obstáculo ou parede vira "toque move a prévia" e um
   * botão confirma, porque no toque não existe o cursor que a prévia seguiria.
   */
  touch?: boolean;
}) {
  const [hover, setHover] = useState<{
    id: string;
    x: number;
    y: number;
    flip: boolean;
  } | null>(null);
  const host = useRef<HTMLDivElement>(null),
    labelHost = useRef<HTMLDivElement>(null),
    scissorsEl = useRef<HTMLDivElement>(null),
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
        ...params.modules.filter((m) => !m.kind).map((m) => (m.rotation % 180 ? m.width : m.depth)),
      ) / 2,
    [params],
  );
  // A parede limita o arrasto para trás: a real, ou a de referência.
  const wallZ = room ? wallAt(room, bounds).z : Math.min(bounds.min[2], homeZ);
  // Modo do arrasto, escolhido no controle de mover e lembrado no navegador.
  const [dragMode, setDragModeState] = useState<DragMode>(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem('merce.dragmode') : null;
      return saved ? { ...DEFAULT_DRAG_MODE, ...(JSON.parse(saved) as Partial<DragMode>) } : DEFAULT_DRAG_MODE;
    } catch {
      return DEFAULT_DRAG_MODE;
    }
  });
  const setDragMode = (next: DragMode) => {
    setDragModeState(next);
    try {
      window.localStorage.setItem('merce.dragmode', JSON.stringify(next));
    } catch {
      // Sem armazenamento o modo vale só nesta aba.
    }
  };
  // Ambiente desenhado: o real, ou a parede de referência quando não há um.
  const sceneRoom = useMemo(
    () => (showRoom ? (room ?? referenceRoom(bounds, homeZ)) : undefined),
    [showRoom, room, bounds, homeZ],
  );
  const wallProps = { selectedWall, onSelectWall, onChangeWall, onResizeMainWall, placingWall, onPlaceWall };
  const latest = useRef({ params, parts, selected, movable, onMove, onMoveObstacle, wallZ, dragMode, onSelectObstacle, selectedObstacle, placing, onPlace, sceneRoom, bounds, ...wallProps });
  useEffect(() => {
    latest.current = { params, parts, selected, movable, onMove, onMoveObstacle, wallZ, dragMode, onSelectObstacle, selectedObstacle, placing, onPlace, sceneRoom, bounds, selectedWall, onSelectWall, onChangeWall, onResizeMainWall, placingWall, onPlaceWall };
  }, [params, parts, selected, movable, onMove, onMoveObstacle, wallZ, dragMode, onSelectObstacle, selectedObstacle, placing, onPlace, sceneRoom, bounds, selectedWall, onSelectWall, onChangeWall, onResizeMainWall, placingWall, onPlaceWall]);
  const obBar = useRef<HTMLDivElement>(null);
  const wallBar = useRef<HTMLDivElement>(null),
    wallHandles = useRef<HTMLDivElement>(null),
    liveDimHost = useRef<HTMLDivElement>(null);
  const [overWall, setOverWall] = useState(false);
  const lastParams = useRef(params);
  // Ponteiro sobre um obstáculo da parede que dá para arrastar.
  const [overObstacle, setOverObstacle] = useState(false);
  const [moveTip, setMoveTip] = useState<{ x: number; y: number; text: string; bad: boolean; warn?: boolean } | null>(null);
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
      // Profundidade logarítmica: piso, sombra e parede ficam a milímetros um
      // do outro e, com a câmera a metros, a profundidade linear não separava
      // as camadas. O piso e as paredes piscavam em faixas ao girar.
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
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
      shadowFloor,
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)'),
      labelEls: [],
      dirty: true,
      retired: [],
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
    // Girar, aproximar e o amortecimento mexem na câmera: redesenha. O fim do
    // amortecimento anda frações de milímetro por segundos a fio; abaixo de
    // ~0,1 px desde o último quadro desenhado, não vale um quadro novo.
    const shownCamera = new THREE.Vector3(),
      shownTarget = new THREE.Vector3();
    controls.addEventListener('change', () => {
      const tolerance = camera.position.distanceTo(controls.target) * 1e-4;
      if (
        camera.position.distanceToSquared(shownCamera) > tolerance * tolerance ||
        controls.target.distanceToSquared(shownTarget) > tolerance * tolerance
      )
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
    // Arrasto do móvel: começa numa peça já selecionada, mas só vira arrasto
    // depois de o ponteiro andar alguns pixels. Até lá é um clique, e o
    // clique (com ou sem Shift) chega à seleção normalmente.
    let armed: {
      id: number;
      point: THREE.Vector3;
      group: MoveGroup;
    } | null = null;
    let drag: {
      group: MoveGroup;
      plane: THREE.Plane;
      from: THREE.Vector3;
      mode: DragMode;
      boxes: ReturnType<typeof moduleBoxes>;
      key: string;
    } | null = null;
    const hit = new THREE.Vector3();
    const release = () => {
      armed = null;
      controls.enabled = true;
      dragging.current = false;
      el.style.cursor = '';
    };
    // Obstáculo da parede: porta, janela, tomada... pega e arrasta pela
    // parede. Com o móvel na frente, o móvel tem a preferência.
    type ObstacleEntry = NonNullable<Runtime['room']>['obstacles'][number];
    let obArmed: { entry: ObstacleEntry; point: THREE.Vector3 } | null = null;
    let obDrag: { entry: ObstacleEntry; plane: THREE.Plane; from: THREE.Vector3; x: number; y: number; blocked: string | null } | null = null;
    let tipTimer = 0;
    const cmText = (mm: number) => `${String(Number((mm / 10).toFixed(1))).replace('.', ',')} cm`;
    const obstacleHit = () => {
      const list = state.room?.obstacles ?? [];
      const now = latest.current;
      if (!list.length || (!now.onMoveObstacle && !now.onSelectObstacle)) return null;
      const h = ray.intersectObjects(list.map((v) => v.group), true)[0];
      if (!h) return null;
      let node: THREE.Object3D | null = h.object;
      while (node && node.userData.obstacleId === undefined) node = node.parent;
      const entry = list.find((v) => v.id === node?.userData.obstacleId);
      return entry ? { entry, point: h.point.clone(), distance: h.distance } : null;
    };
    /**
     * O lugar serve? Em cima de outro obstáculo não: se atravessariam no 3D e
     * não existem assim na parede. Na frente do móvel pode (a porta está onde
     * está na casa), mas avisa: o veredito de encaixe acusa o conflito.
     */
    const spotCheck = (o: Obstacle) => {
      if (!state.room) return { blocked: null, warn: null };
      const other = obstacleOverlap(o, state.room.obstacles.map((v) => v.obstacle));
      const now = latest.current;
      // Pelo vão, como o veredito de encaixe: o aviso e o vermelho concordam.
      const boxes = [...moduleBoxes(now.params)];
      const panels = boxes.filter(([id]) => now.params.modules.find((m) => m.id === id)?.kind === 'panel').map(([, b]) => b);
      const piece = boxes.find(([, b]) => obstacleCrosses(o, [b], state.room!.wall.x0, { panels, wallZ: state.room!.wall.z + 1 }));
      return {
        blocked: other ? (other.label ?? OBSTACLE_WORD[other.kind]) : null,
        warn: piece ? (now.params.modules.find((m) => m.id === piece[0])?.name ?? 'o móvel') : null,
      };
    };
    /** Etiqueta do obstáculo no lugar: onde está, ou por que não pode. */
    const spotText = (o: Obstacle, check: ReturnType<typeof spotCheck>) =>
      check.blocked
        ? `Bate em ${check.blocked}`
        : `${OBSTACLE_WORD[o.kind]} · ${cmText(o.xMm)} do canto${floorBound(o.kind) ? '' : ` · ${cmText(o.yMm)} do piso`}${check.warn ? ` · na frente de ${check.warn}` : ''}`;
    /** Ponto da tela sobre o meio do topo do obstáculo, para a etiqueta. */
    const screenAbove = (g: THREE.Object3D, o: Obstacle) => {
      const p = new THREE.Vector3(o.widthMm / 2, o.heightMm + 80, 120);
      g.localToWorld(p).project(camera);
      return { x: ((p.x + 1) / 2) * el.clientWidth, y: ((1 - p.y) / 2) * el.clientHeight };
    };
    const snap = (v: number) => Math.round(v / 10) * 10;
    const clampSpot = (o: Obstacle, x: number, y: number) => {
      const wall = state.room!.wall;
      return {
        x: THREE.MathUtils.clamp(snap(x), 0, Math.max(0, wall.width - o.widthMm)),
        y: floorBound(o.kind) ? o.yMm : THREE.MathUtils.clamp(snap(y), 0, Math.max(0, wall.height - o.heightMm)),
      };
    };
    const obstacleMove = (e: PointerEvent) => {
      if (!obDrag || !state.room) return;
      aim(e);
      if (!ray.ray.intersectPlane(obDrag.plane, hit)) return;
      const o = obDrag.entry.obstacle;
      const wall = state.room.wall;
      const at = clampSpot(o, o.xMm + hit.x - obDrag.from.x, o.yMm + hit.y - obDrag.from.y);
      obDrag.x = at.x;
      obDrag.y = at.y;
      obDrag.entry.group.position.x = wall.x0 + obDrag.x;
      obDrag.entry.group.position.y = obDrag.y;
      state.dirty = true;
      const moved = { ...o, xMm: obDrag.x, yMm: obDrag.y };
      const check = spotCheck(moved);
      obDrag.blocked = check.blocked;
      tintFrame(obDrag.entry.group, check.blocked ? 'bad' : check.warn ? 'warn' : 'ok');
      const box = el.getBoundingClientRect();
      setMoveTip({ x: e.clientX - box.left, y: e.clientY - box.top, text: spotText(moved, check), bad: !!check.blocked, warn: !!check.warn });
    };
    const flashTip = (text: string) => {
      setMoveTip((tip) => (tip ? { ...tip, text, bad: true, warn: false } : tip));
      window.clearTimeout(tipTimer);
      tipTimer = window.setTimeout(() => setMoveTip(null), 1600);
    };
    const obstacleEnd = () => {
      const d = obDrag;
      const clicked = obArmed?.entry;
      obArmed = null;
      obDrag = null;
      release();
      if (!d) {
        setMoveTip(null);
        // Segurou e soltou sem arrastar: é um clique, escolhe o obstáculo.
        if (clicked) latest.current.onSelectObstacle?.(clicked.id);
        return;
      }
      const o = d.entry.obstacle;
      if (d.blocked) {
        // Soltou em cima de outro: volta ao lugar gravado, como o móvel, e a
        // etiqueta vermelha fica um instante dizendo por quê.
        if (state.room) {
          d.entry.group.position.x = state.room.wall.x0 + o.xMm;
          d.entry.group.position.y = o.yMm;
        }
        tintFrame(d.entry.group, 'ok');
        state.dirty = true;
        flashTip(`Bate em ${d.blocked}: voltou ao lugar`);
        return;
      }
      setMoveTip(null);
      latest.current.onSelectObstacle?.(o.id);
      if (d.x !== o.xMm || d.y !== o.yMm) void latest.current.onMoveObstacle?.(o.id, d.x, d.y);
    };
    // Obstáculo novo: a prévia anda pela parede com o cursor ou as setas.
    const placeTo = (x: number, y: number) => {
      const pl = state.placing;
      if (!pl || !state.room) return;
      const at = clampSpot(pl.obstacle, x, y);
      pl.x = at.x;
      pl.y = at.y;
      pl.group.position.x = state.room.wall.x0 + at.x;
      pl.group.position.y = at.y;
      const moved = { ...pl.obstacle, xMm: at.x, yMm: at.y };
      const check = spotCheck(moved);
      pl.blocked = check.blocked;
      tintFrame(pl.group, check.blocked ? 'bad' : check.warn ? 'warn' : 'ok');
      state.dirty = true;
      const tip = screenAbove(pl.group, moved);
      window.clearTimeout(tipTimer);
      // Etiqueta larga não sai da cena na tela estreita.
      tip.x = Math.min(tip.x, Math.max(8, el.clientWidth - 300));
      setMoveTip({ ...tip, text: spotText(moved, check), bad: !!check.blocked, warn: !!check.warn });
    };
    state.placeTo = placeTo;
    state.confirmPlacing = () => {
      const pl = state.placing;
      if (!pl) return;
      if (pl.blocked) {
        flashTip(`Bate em ${pl.blocked}: escolha outro lugar`);
        return;
      }
      setMoveTip(null);
      latest.current.onPlace?.({ ...pl.obstacle, xMm: pl.x, yMm: pl.y });
    };
    const placingMove = (e: PointerEvent) => {
      const pl = state.placing;
      if (!pl || !state.room || e.buttons) return;
      aim(e);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -state.room.wall.z);
      if (!ray.ray.intersectPlane(plane, hit)) return;
      const o = pl.obstacle;
      // O cursor fica no meio da peça: é onde a pessoa está olhando.
      placeTo(hit.x - state.room.wall.x0 - o.widthMm / 2, hit.y - o.heightMm / 2);
    };
    // Paredes do ambiente. Clique escolhe; o corpo arrasta pelo piso; as alças
    // (HTML por cima da cena) esticam comprimento e altura. A parede do fundo
    // só estica: é dela que tudo no ambiente é medido.
    type Built = NonNullable<Runtime['room']>;
    type WallEntry = Built['walls'][number];
    let wallArmed: { entry: WallEntry; point: THREE.Vector3 } | null = null;
    let handleDrag: {
      target: string;
      handle: WallHandle;
      plane: THREE.Plane;
      from: THREE.Vector3;
      point: THREE.Vector3;
      /** Plano de pé (câmera rente ao piso): o arrasto pelo piso descarta a altura. */
      flat: boolean;
      room: Room;
      built: Built;
      wall?: Wall;
      draft?: Wall;
      /** Parede do fundo como está no arrasto, e o valor que a alça grava. */
      frame?: WallFrame;
      at?: number;
      changed: boolean;
      modules: { name: string; box: SceneBounds }[];
    } | null = null;
    const frameOf = (built: Built): WallFrame => ({ x0: built.wall.x0, z: built.face, width: built.wall.width, height: built.wall.height });
    const wallHit = () => {
      // Parede translúcida (entre a câmera e o móvel) deixa o clique passar.
      const list = (state.room?.walls ?? []).filter((v) => !v.group.userData.faded);
      if (!list.length || !latest.current.onSelectWall) return null;
      const h = ray.intersectObjects(
        list.map((v) => v.group.userData.body as THREE.Object3D),
        false,
      )[0];
      if (!h) return null;
      let node: THREE.Object3D | null = h.object;
      while (node && node.userData.wallId === undefined) node = node.parent;
      const entry = list.find((v) => v.id === node?.userData.wallId);
      return entry ? { entry, point: h.point.clone(), distance: h.distance } : null;
    };
    const mainWallHit = () => {
      const mesh = state.room?.mainWall;
      if (!mesh || !latest.current.onSelectWall) return null;
      const h = ray.intersectObject(mesh, false)[0];
      return h ? { distance: h.distance } : null;
    };
    /** Módulo que a parede cruza (nome), pela caixa de cada um. */
    const crossing = (w: Wall, frame: WallFrame, modules: { name: string; box: SceneBounds }[]) => {
      const solid = wallBox(w, { x: frame.x0, z: frame.z }, frame.height);
      return modules.find(({ box }) => boxesCross(solid, box))?.name ?? null;
    };
    const namedBoxes = () => {
      const now = latest.current;
      return [...moduleBoxes(now.params)].map(([id, box]) => ({ name: now.params.modules.find((m) => m.id === id)?.name ?? 'o móvel', box }));
    };
    const spotOf = (w: Wall) => {
      const f = wallFootprint(w);
      return `${cmText(Math.abs(f.x0))} ${f.x0 < 0 ? 'fora do canto' : 'do canto'} · ${f.z0 ? `${cmText(f.z0)} da parede do fundo` : 'encostada no fundo'}`;
    };
    /** Cotas ao vivo: linhas refeitas a cada passo, rótulos reposicionados no quadro. */
    const showLiveDims = (dims: LiveDim[]) => {
      clearLiveDims();
      if (!dims.length) return;
      const made = liveDimLines(dims);
      scene.add(made.lines);
      state.liveDims = { dims, ...made };
      const labels = liveDimHost.current ? Array.from(liveDimHost.current.children as HTMLCollectionOf<HTMLElement>) : [];
      labels.forEach((node, i) => {
        node.textContent = dims[i]?.text ?? '';
        node.style.display = dims[i] ? '' : 'none';
      });
    };
    const clearLiveDims = () => {
      const old = state.liveDims;
      if (!old) return;
      scene.remove(old.lines);
      state.retired.push(old.dispose);
      state.liveDims = undefined;
      for (const node of Array.from((liveDimHost.current?.children ?? []) as HTMLCollectionOf<HTMLElement>)) node.style.display = 'none';
      state.dirty = true;
    };
    /**
     * Plano do arrasto de uma alça: contém a linha em que ela anda e fica o
     * mais de frente possível para a câmera, para o cursor mandar em qualquer
     * ângulo. Levar a parede anda no plano do piso.
     */
    const handlePlane = (handle: WallHandle, point: THREE.Vector3, axis: THREE.Vector3) => {
      const view = camera.getWorldDirection(new THREE.Vector3());
      if (handle === 'move') {
        if (Math.abs(view.y) > 0.12) return { plane: new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), point), flat: false };
        return { plane: new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(-view.x, 0, -view.z).normalize(), point), flat: true };
      }
      const along = handle === 'top' ? new THREE.Vector3(0, 1, 0) : axis;
      const normal = view.clone().addScaledVector(along, -view.dot(along));
      if (normal.lengthSq() < 1e-4) normal.copy(handle === 'top' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0));
      return { plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), point), flat: false };
    };
    /** Começa o arrasto da alça (ou do corpo, com `grab`, o ponto pego na parede). */
    const startWallDrag = (target: string, handle: WallHandle, e: PointerEvent, grab?: THREE.Vector3) => {
      const built = state.room;
      const room = latest.current.sceneRoom;
      if (!built || !room) return false;
      const frame = frameOf(built);
      const wall = target === MAIN_WALL ? undefined : built.walls.find((v) => v.id === target)?.wall;
      if (target !== MAIN_WALL && !wall) return false;
      if (target === MAIN_WALL && handle === 'move') return false;
      const points = wall ? wallHandlePoints(wall, frame) : mainHandlePoints(frame);
      const point = grab ?? (handle === 'move' ? (points as ReturnType<typeof wallHandlePoints>).move : points[handle]);
      const { plane, flat } = handlePlane(handle, point, points.axis);
      let from = grab?.clone();
      if (!from) {
        aim(e);
        from = new THREE.Vector3();
        if (!ray.ray.intersectPlane(plane, from)) return false;
      }
      handleDrag = { target, handle, plane, from, point: point.clone(), flat, room, built, wall, changed: false, modules: namedBoxes() };
      controls.enabled = false;
      dragging.current = true;
      state.wallDragging = true;
      state.dirty = true;
      setHover(null);
      return true;
    };
    const wallDragMove = (e: PointerEvent) => {
      const d = handleDrag;
      if (!d) return;
      aim(e);
      if (!ray.ray.intersectPlane(d.plane, hit)) return;
      const delta = hit.clone().sub(d.from);
      if (d.flat) delta.y = 0;
      const p = d.point.clone().add(delta);
      const frame = frameOf(d.built);
      const box = el.getBoundingClientRect();
      const cursor = { x: e.clientX - box.left, y: e.clientY - box.top };
      if (d.target === MAIN_WALL) {
        const edge = d.handle as MainWallEdge;
        const at = edge === 'top' ? p.y : p.x - frame.x0;
        const next = resizeMainWall(d.room, latest.current.bounds, edge, at);
        const nf: WallFrame = { x0: wallAt(next, latest.current.bounds).x, z: frame.z, width: next.widthMm, height: next.heightMm };
        d.at = at;
        d.frame = nf;
        d.changed = nf.x0 !== frame.x0 || nf.width !== frame.width || nf.height !== frame.height;
        d.built.resize(nf.x0, nf.width, nf.height);
        // Paredes na altura do teto sobem e descem junto; o resto fica no lugar.
        for (const entry of d.built.walls) {
          const w = next.walls?.find((v) => v.id === entry.id);
          if (w) layoutWall(entry.group, w, nf);
        }
        showLiveDims(mainLiveDims(nf, edge));
      } else {
        const base = d.wall!;
        const next =
          d.handle === 'move'
            ? moveWallTo(base, base.xMm + delta.x, base.zMm + delta.z, d.room)
            : d.handle === 'top'
              ? resizeWallHeight(base, p.y, d.room)
              : resizeWallEnd(base, d.handle, base.rotation === 0 ? p.x - frame.x0 : p.z - frame.z, d.room);
        d.draft = next;
        d.changed = JSON.stringify(next) !== JSON.stringify(base);
        const entry = d.built.walls.find((v) => v.id === d.target);
        if (entry) layoutWall(entry.group, next, frame);
        showLiveDims(wallLiveDims(next, frame, d.handle));
        // As medidas já estão nas cotas; perto do cursor, só o aviso de que
        // a parede passa pelo móvel.
        const hitName = crossing(next, frame, d.modules);
        setMoveTip(hitName ? { ...cursor, text: `Cruza ${hitName}`, bad: false, warn: true } : null);
      }
      state.dirty = true;
    };
    /** Volta a parede ao que está gravado (arrasto sem efeito, ou que não gravou). */
    const restoreWall = (d: NonNullable<typeof handleDrag>) => {
      const frame = frameOf(d.built);
      if (d.target === MAIN_WALL) d.built.resize(frame.x0, frame.width, frame.height);
      for (const entry of d.built.walls) layoutWall(entry.group, entry.wall, frame);
      state.dirty = true;
    };
    const wallDragEnd = () => {
      const d = handleDrag;
      handleDrag = null;
      if (!d) return;
      release();
      state.wallDragging = false;
      clearLiveDims();
      setMoveTip(null);
      const now = latest.current;
      if (d.target !== MAIN_WALL) now.onSelectWall?.(d.target);
      if (!d.changed) {
        restoreWall(d);
        return;
      }
      state.holdFrame = performance.now() + 5000;
      const done = d.target === MAIN_WALL ? now.onResizeMainWall?.(d.handle as MainWallEdge, d.at!) : now.onChangeWall?.(d.draft!);
      // Gravou: o ambiente novo chega e a cena é refeita com ele. Não gravou
      // (erro, ou a pergunta de descartar versões): a parede volta ao gravado.
      void Promise.resolve(done)
        .catch(() => {})
        .finally(() =>
          window.setTimeout(() => {
            if (state.room === d.built) restoreWall(d);
          }, 250),
        );
    };
    state.beginHandle = (handle, e) => {
      const target = latest.current.selectedWall;
      if (!target || !latest.current.movable || state.placing || state.placingWall) return false;
      return startWallDrag(target, handle, e);
    };
    state.moveHandle = wallDragMove;
    state.endHandle = wallDragEnd;
    // Parede nova: a prévia anda pelo piso com o cursor ou as setas.
    const placeWallTo = (x: number, z: number) => {
      const pl = state.placingWall;
      const built = state.room;
      const room = latest.current.sceneRoom;
      if (!pl || !built || !room) return;
      const frame = frameOf(built);
      pl.wall = moveWallTo(pl.wall, x, z, room);
      layoutWall(pl.group, pl.wall, frame);
      state.dirty = true;
      const top = wallHandlePoints(pl.wall, frame).top.clone().setY(Math.min(pl.wall.heightMm, frame.height) + 80);
      top.project(camera);
      const hitName = crossing(pl.wall, frame, namedBoxes());
      window.clearTimeout(tipTimer);
      setMoveTip({
        x: Math.min(((top.x + 1) / 2) * el.clientWidth, Math.max(8, el.clientWidth - 300)),
        // Parede alta de perto: a etiqueta desce até abaixo do título da cena.
        y: Math.max(safeArea().y0 + 36, ((1 - top.y) / 2) * el.clientHeight),
        text: `${wallName(pl.wall)} · ${spotOf(pl.wall)}${hitName ? ` · cruza ${hitName}` : ''}`,
        bad: false,
        warn: !!hitName,
      });
    };
    state.placeWallTo = placeWallTo;
    state.turnPlacingWall = () => {
      const pl = state.placingWall;
      const room = latest.current.sceneRoom;
      if (!pl || !room) return;
      pl.wall = rotateWall(pl.wall, room);
      placeWallTo(pl.wall.xMm, pl.wall.zMm);
    };
    state.confirmPlacingWall = () => {
      const pl = state.placingWall;
      if (!pl) return;
      setMoveTip(null);
      latest.current.onPlaceWall?.(pl.wall);
    };
    const placingWallMove = (e: PointerEvent) => {
      const pl = state.placingWall;
      if (!pl || !state.room || e.buttons) return;
      aim(e);
      if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return;
      const f = wallFootprint(pl.wall);
      // O cursor fica no meio da base.
      placeWallTo(hit.x - state.room.wall.x0 - (f.x1 - f.x0) / 2, hit.z - state.room.face - (f.z1 - f.z0) / 2);
    };
    const start = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
      const now = latest.current;
      // Pondo um obstáculo ou uma parede: o clique é para ela; arrastar ainda gira a vista.
      if (state.placing || state.placingWall) return;
      // Shift é para somar e tirar da seleção: nunca começa um arrasto.
      if (e.button !== 0 || !now.movable || !e.isPrimary || e.shiftKey) return;
      aim(e);
      const first = ray.intersectObjects(motion.pickable(), false)[0];
      const ob = now.onMoveObstacle ? obstacleHit() : null;
      const wl = now.onChangeWall ? wallHit() : null;
      // A parede na frente de tudo (móvel e obstáculo) é a que o ponteiro pegou.
      if (wl && (!first || wl.distance < first.distance) && (!ob || wl.distance < ob.distance)) {
        wallArmed = { entry: wl.entry, point: wl.point };
        controls.enabled = false;
        dragging.current = true;
        try {
          renderer.domElement.setPointerCapture(e.pointerId);
        } catch {
          // Sem captura o arrasto termina quando o ponteiro sai da cena.
        }
        return;
      }
      if (ob && (!first || ob.distance < first.distance)) {
        obArmed = { entry: ob.entry, point: ob.point };
        controls.enabled = false;
        dragging.current = true;
        try {
          renderer.domElement.setPointerCapture(e.pointerId);
        } catch {
          // Sem captura o arrasto termina quando o ponteiro sai da cena.
        }
        return;
      }
      const id = first?.object.userData.id as string | undefined;
      if (!first || !id || !now.selected.includes(id)) return;
      const owner = (now.parts.find((p) => p.id === id) as { owners?: string[] } | undefined)?.owners?.[0];
      const group = owner ? moveGroup(now.params, owner) : null;
      if (!group) return;
      armed = { id: e.pointerId, point: first.point.clone(), group };
      // Antes do OrbitControls (ouvinte de captura): segurar a peça não gira a câmera.
      controls.enabled = false;
      dragging.current = true;
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // Sem captura o arrasto termina quando o ponteiro sai da cena.
      }
    };
    /** Passou do limite do clique: escolhe o plano pelo modo e pela câmera. */
    const begin = () => {
      if (!armed) return;
      const mode = latest.current.dragMode;
      const view = camera.getWorldDirection(new THREE.Vector3());
      let normal: THREE.Vector3;
      if (!mode.lockHeight) {
        // Livre: o plano de frente para a câmera, a peça segue o cursor.
        normal = view.clone().negate();
      } else if (Math.abs(view.y) > 0.12) {
        // Altura travada: desliza no piso, de qualquer ângulo.
        normal = new THREE.Vector3(0, 1, 0);
      } else {
        // Olhando rente ao piso o plano do chão foge para o horizonte: usa o
        // de pé e descarta a altura.
        normal = new THREE.Vector3(-view.x, 0, -view.z).normalize();
      }
      drag = {
        group: armed.group,
        plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, armed.point),
        from: armed.point,
        mode,
        boxes: moduleBoxes(latest.current.params),
        key: '0,0,0',
      };
      armed = null;
      el.style.cursor = 'grabbing';
      state.move = undefined;
      setHover(null);
    };
    const dragMove = (e: PointerEvent) => {
      if (state.placing) {
        placingMove(e);
        return;
      }
      if (state.placingWall) {
        placingWallMove(e);
        return;
      }
      if (wallArmed && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) {
        const armedWall = wallArmed;
        wallArmed = null;
        if (!startWallDrag(armedWall.entry.id, 'move', e, armedWall.point)) release();
        else el.style.cursor = 'grabbing';
      }
      if (handleDrag) {
        wallDragMove(e);
        return;
      }
      if (obArmed && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) {
        obDrag = {
          entry: obArmed.entry,
          plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -obArmed.point.z),
          from: obArmed.point,
          x: obArmed.entry.obstacle.xMm,
          y: obArmed.entry.obstacle.yMm,
          blocked: null,
        };
        obArmed = null;
        el.style.cursor = 'grabbing';
        setHover(null);
      }
      if (obDrag) {
        obstacleMove(e);
        return;
      }
      if (armed && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) begin();
      if (!drag) return;
      aim(e);
      if (!ray.ray.intersectPlane(drag.plane, hit)) return;
      const moved = hit.clone().sub(drag.from);
      const raw = constrainDrag([moved.x, moved.y, moved.z], drag.mode);
      const now = latest.current;
      const locked = lockedAxes([moved.x, moved.y, moved.z], drag.mode);
      const delta = snapDelta(now.params, drag.group, raw, drag.boxes, now.wallZ).map((v, i) =>
        locked[i] ? 0 : v,
      ) as Vec3;
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
    /** Segurou uma parede e soltou sem arrastar: é um clique, escolhe a parede. */
    const wallClick = () => {
      const armedWall = wallArmed;
      wallArmed = null;
      release();
      if (armedWall) latest.current.onSelectWall?.(armedWall.entry.id);
    };
    const dragEnd = () => {
      if (handleDrag) {
        wallDragEnd();
        return;
      }
      if (wallArmed) {
        wallClick();
        return;
      }
      if (obArmed || obDrag) {
        obstacleEnd();
        return;
      }
      if (armed) release();
      if (!drag) return;
      drag = null;
      release();
      setMoveTip(null);
      commitPreview();
    };
    const pick = (e: PointerEvent) => {
      if (state.placing) {
        if (e.button === 0 && Math.hypot(e.clientX - down[0], e.clientY - down[1]) <= 5) {
          placingMove(e);
          if (e.pointerType === 'mouse') state.confirmPlacing?.();
        }
        return;
      }
      if (state.placingWall) {
        if (e.button === 0 && Math.hypot(e.clientX - down[0], e.clientY - down[1]) <= 5) {
          placingWallMove(e);
          if (e.pointerType === 'mouse') state.confirmPlacingWall?.();
        }
        return;
      }
      if (handleDrag) {
        wallDragEnd();
        return;
      }
      if (wallArmed) {
        wallClick();
        return;
      }
      if (obArmed || obDrag) {
        obstacleEnd();
        return;
      }
      if (drag) {
        dragEnd();
        return;
      }
      // Segurou e soltou sem arrastar: é um clique na peça.
      if (armed) release();
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const first = ray.intersectObjects(motion.pickable(), false)[0];
      // Obstáculo na frente do móvel (ou sem móvel embaixo): escolhe ele.
      const ob = obstacleHit();
      const wl = wallHit();
      if (wl && (!first || wl.distance < first.distance) && (!ob || wl.distance < ob.distance)) {
        latest.current.onSelectWall?.(wl.entry.id);
        return;
      }
      if (ob && (!first || ob.distance < first.distance)) {
        latest.current.onSelectObstacle?.(ob.entry.id);
        return;
      }
      // Parede do fundo: com nada escolhido, o clique nela escolhe a parede.
      // Com algo escolhido, o primeiro clique no fundo só solta a escolha, como
      // sempre foi: o fundo ocupa quase toda a cena.
      const now = latest.current;
      if (!first && !now.selected.length && !now.selectedObstacle && !now.selectedWall && mainWallHit()) {
        now.onSelectWall?.(MAIN_WALL);
        return;
      }
      now.onSelectObstacle?.(null);
      now.onSelectWall?.(null);
      callback.current(first?.object.userData.id ?? null, e.shiftKey);
    };
    // Um texto selecionado na página (o chat, as cotas) virava arrasto de
    // texto do navegador por cima da cena: apertar na cena solta a seleção.
    const releaseText = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) sel.removeAllRanges();
    };
    const noDrag = (e: DragEvent) => e.preventDefault();
    el.addEventListener('pointerdown', releaseText, { capture: true });
    el.addEventListener('dragstart', noDrag);
    renderer.domElement.addEventListener('pointerdown', start, { capture: true });
    renderer.domElement.addEventListener('pointerup', pick);
    renderer.domElement.addEventListener('pointercancel', dragEnd);
    renderer.domElement.addEventListener('pointermove', dragMove);
    const hover = (e: PointerEvent) => {
      if (drag || obDrag || handleDrag) return;
      if (state.placing || state.placingWall) {
        setHover(null);
        return;
      }
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
        const ob = obstacleHit(),
          wl = wallHit();
        setOverObstacle(!!ob && (!wl || ob.distance < wl.distance));
        setOverWall(!!wl && (!ob || wl.distance <= ob.distance));
        return;
      }
      setOverObstacle(false);
      setOverWall(false);
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
      state.cutMarks?.marks.resize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      state.dirty = true;
    });
    resize.observe(el);
    const projected = new THREE.Vector3();
    const sight = new THREE.Ray();
    /** Ponto do mundo na tela, em px da cena; `behind` quando está atrás da câmera. */
    const screenOf = (p: THREE.Vector3) => {
      const v = p.clone().project(camera);
      return { x: ((v.x + 1) / 2) * el.clientWidth, y: ((1 - v.y) / 2) * el.clientHeight, behind: v.z > 1 };
    };
    /**
     * Área livre da cena, em px dela: abaixo do título, fora das ferramentas
     * (coluna à direita na tela larga, faixa em cima na estreita) e acima da
     * barra de vistas. As alças e a barra da parede ficam aqui dentro.
     */
    const safeArea = () => {
      const box = el.getBoundingClientRect();
      const stage = el.parentElement;
      const rect = (sel: string) => {
        const r = stage?.querySelector(sel)?.getBoundingClientRect();
        return r && r.width && r.height ? r : null;
      };
      const head = rect('.stage-head'),
        tools = rect('.stage-tools'),
        bottom = rect('.scene-bottom');
      let x1 = box.width - 14,
        y0 = head ? head.bottom - box.top + 8 : 14;
      if (tools && tools.height > tools.width) x1 = Math.min(x1, tools.left - box.left - 14);
      else if (tools) y0 = Math.max(y0, tools.bottom - box.top + 8);
      const y1 = (bottom ? bottom.top - box.top : box.height) - 14;
      return { x0: 14, x1: Math.max(14, x1), y0: Math.max(14, y0), y1: Math.max(y0, y1) };
    };
    /** Cursor de redimensionar que segue a direção da alça na tela. */
    const resizeCursor = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const angle = ((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 180) % 180;
      return angle < 22.5 || angle >= 157.5 ? 'ew-resize' : angle < 67.5 ? 'nwse-resize' : angle < 112.5 ? 'ns-resize' : 'nesw-resize';
    };
    const placeWallUi = () => {
      const id = latest.current.selectedWall;
      const built = state.room;
      const bar = wallBar.current,
        handles = wallHandles.current;
      if (!id || !built || (!bar && !handles)) return;
      const safe = safeArea();
      const d = handleDrag?.target === id ? handleDrag : null;
      const frame = d?.frame ?? frameOf(built);
      let points: { start: THREE.Vector3; end: THREE.Vector3; top: THREE.Vector3; move?: THREE.Vector3; axis: THREE.Vector3 };
      if (id === MAIN_WALL) points = mainHandlePoints(frame);
      else {
        const w = d?.draft ?? built.walls.find((v) => v.id === id)?.wall;
        if (!w) return;
        points = wallHandlePoints(w, frame);
      }
      const spots = {
        start: screenOf(points.start),
        end: screenOf(points.end),
        top: screenOf(points.top),
        move: points.move ? screenOf(points.move) : null,
      };
      const along = resizeCursor(screenOf(points.start), screenOf(points.start.clone().addScaledVector(points.axis, 100)));
      if (handles)
        for (const node of Array.from(handles.children as HTMLCollectionOf<HTMLElement>)) {
          const h = node.dataset.handle as WallHandle;
          const s = spots[h];
          // Arrastando, só a alça pega fica: as outras cairiam sobre as cotas.
          // A de mover some quando o topo fica em cima dela (mureta baixa, de longe).
          const crowded = h === 'move' && !!s && Math.hypot(s.x - spots.top.x, s.y - spots.top.y) < 44;
          const hidden = !s || s.behind || (!!d && d.handle !== h) || crowded;
          node.style.opacity = hidden ? '0' : '1';
          node.style.pointerEvents = hidden ? 'none' : '';
          if (!s) continue;
          // Ponta fora da vista ou sob as ferramentas da cena: a alça fica na
          // borda da área livre, apontando para ela. O arrasto conta o quanto
          // o ponteiro andou, então esticar dali funciona igual.
          const x = THREE.MathUtils.clamp(s.x, safe.x0, safe.x1),
            y = THREE.MathUtils.clamp(s.y, safe.y0, safe.y1);
          node.classList.toggle('clamped', Math.abs(x - s.x) > 1 || Math.abs(y - s.y) > 1);
          node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
          node.style.cursor = h === 'move' ? 'move' : h === 'top' ? 'ns-resize' : along;
        }
      if (bar) {
        const off = spots.top.behind;
        bar.style.opacity = off || d ? '0' : '1';
        bar.style.pointerEvents = off || d ? 'none' : '';
        // Acima do topo; sem espaço (parede alta, de perto), logo abaixo dele.
        // Nunca sai da área livre da cena nem cobre o título e as ferramentas.
        const w = bar.offsetWidth,
          h = bar.offsetHeight;
        const topY = THREE.MathUtils.clamp(spots.top.y, safe.y0, safe.y1);
        const above = topY - 22 - h >= safe.y0;
        const x = THREE.MathUtils.clamp(spots.top.x, safe.x0 + w / 2, Math.max(safe.x0 + w / 2, safe.x1 - w / 2));
        const y = above ? topY - 22 - h : Math.min(topY + 22, Math.max(safe.y0, safe.y1 - h));
        bar.style.transform = `translate(${Math.round(x - w / 2)}px, ${Math.round(y)}px)`;
      }
    };
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
      const settled = !motion.moving && !state.preview && !state.wallDragging;
      if (state.dims) state.dims.lines.visible = settled;
      if (labelHost.current && dimsShown !== settled) {
        dimsShown = settled;
        labelHost.current.style.visibility = settled ? '' : 'hidden';
      }
      // Parede do ambiente entre a câmera e o móvel fica translúcida: não
      // esconde o que está sendo desenhado, e o clique passa por ela. A
      // escolhida fica um pouco mais visível; as alças dela seguem valendo.
      if (state.room?.walls.length) {
        // Visadas da câmera para os cantos e o centro do móvel: a parede que
        // corta qualquer uma esconde parte dele.
        const b = latest.current.bounds;
        const targets = [
          ...[0, 1].flatMap((i) => [0, 1].flatMap((j) => [0, 1].map((k) => new THREE.Vector3(i ? b.max[0] : b.min[0], j ? b.max[1] : b.min[1], k ? b.max[2] : b.min[2])))),
          new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2),
        ];
        sight.origin.copy(camera.position);
        const hides = (box: THREE.Box3) =>
          targets.some((t) => {
            sight.direction.copy(t).sub(camera.position).normalize();
            return !!sight.intersectBox(box, projected) && projected.distanceTo(camera.position) < t.distanceTo(camera.position) - 1;
          });
        for (const entry of state.room.walls) {
          const box = entry.group.userData.box as THREE.Box3 | undefined;
          const faded = !!box && hides(box);
          const opacity = faded ? (entry.id === latest.current.selectedWall ? 0.4 : 0.22) : 1;
          const m = entry.group.userData.material as THREE.MeshStandardMaterial;
          entry.group.userData.faded = faded;
          if (m.opacity === opacity) continue;
          m.opacity = opacity;
          m.depthWrite = !faded;
        }
      }
      renderer.render(scene, camera);
      shownCamera.copy(camera.position);
      shownTarget.copy(controls.target);
      for (const dispose of state.retired.splice(0)) dispose();
      // Barra do obstáculo escolhido: acima dele, acompanhando câmera e arrasto.
      const bar = obBar.current;
      const chosen = bar && state.room?.obstacles.find((v) => v.id === latest.current.selectedObstacle);
      if (bar && chosen) {
        const at = screenAbove(chosen.group, chosen.obstacle);
        const off = at.x < 0 || at.y < 0 || at.x > el.clientWidth || at.y > el.clientHeight;
        bar.style.opacity = off ? '0' : '1';
        bar.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(Math.max(8, at.y))}px) translate(-50%, -100%)`;
      }
      // Parede escolhida: alças nas pontas, no topo e no pé, e a barra acima
      // dela. Durante o arrasto, a posição vem do rascunho, não do gravado.
      placeWallUi();
      // Cotas ao vivo do arrasto: rótulo no meio de cada linha.
      if (state.liveDims && liveDimHost.current) {
        const nodes = liveDimHost.current.children as HTMLCollectionOf<HTMLElement>;
        state.liveDims.dims.forEach((d, i) => {
          const node = nodes[i];
          if (!node) return;
          const at = screenOf(d.a.clone().add(d.b).multiplyScalar(0.5));
          node.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -50%)`;
        });
      }
      // Tesoura no começo do tracejado da peça, seguindo a câmera.
      const shears = scissorsEl.current;
      if (shears) {
        const target = state.cutMarks?.scissors;
        const pose = target ? scissorsPose(target.mesh, target.size, camera, el.clientWidth, el.clientHeight) : null;
        shears.style.opacity = pose ? '1' : '0';
        if (pose)
          shears.style.transform = `translate(${Math.round(pose.x)}px, ${Math.round(pose.y)}px) translate(-50%, -50%) rotate(${pose.angle.toFixed(1)}deg)`;
      }
      // Rótulos das cotas: HTML nítido em qualquer zoom, reposicionado a cada
      // quadro direto no DOM, sem passar pelo React.
      if (state.dims && state.labelEls.length) {
        const w = el.clientWidth,
          h = el.clientHeight;
        // Rótulos que se encostam na tela (celular, vista de longe): fica o
        // mais importante. Medidas gerais, depois folgas, depois módulos.
        const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
        const order = state.dims.labels
          .map((label, i) => ({ label, i }))
          .sort((a, b) => LABEL_RANK[a.label.tone] - LABEL_RANK[b.label.tone]);
        for (const { label, i } of order) {
          const node = state.labelEls[i];
          if (!node) continue;
          projected.copy(label.at).project(camera);
          const x = ((projected.x + 1) / 2) * w,
            y = ((1 - projected.y) / 2) * h;
          let hidden = projected.z > 1 || Math.abs(projected.x) > 1.2 || Math.abs(projected.y) > 1.2;
          if (!hidden) {
            let size = labelSize.get(node);
            if (!size) {
              size = [node.offsetWidth, node.offsetHeight];
              if (size[0]) labelSize.set(node, size);
            }
            const box = { x0: x - size[0] / 2 + 3, y0: y - size[1] / 2 + 3, x1: x + size[0] / 2 - 3, y1: y + size[1] / 2 - 3 };
            hidden = placed.some((o) => box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0);
            if (!hidden) placed.push(box);
          }
          node.style.opacity = hidden ? '0' : '1';
          node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        }
      }
    };
    frame = requestAnimationFrame(draw);
    return () => {
      window.clearTimeout(tipTimer);
      cancelAnimationFrame(frame);
      el.removeEventListener('pointerdown', releaseText, { capture: true });
      el.removeEventListener('dragstart', noDrag);
      resize.disconnect();
      controls.dispose();
      motion.dispose();
      for (const dispose of state.retired.splice(0)) dispose();
      state.room?.dispose();
      state.feet?.dispose();
      state.ghosts?.dispose();
      state.cutMarks?.marks.dispose();
      state.dims?.dispose();
      state.liveDims?.dispose();
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
            dim: diff.dim,
          }
        : null,
    );
    if (s.ghosts) {
      s.scene.remove(s.ghosts.group);
      s.retired.push(s.ghosts.dispose);
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
  // Tracejado de corte: refeito a cada troca de alvo (e se as peças mudam).
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    s.cutMarks?.marks.dispose();
    s.cutMarks = undefined;
    s.dirty = true;
    if (!cutFocus?.ids.length) return;
    const sizes = new Map(parts.map((part) => [part.id, part.size]));
    const targets = cutFocus.ids.flatMap((id) => {
      const entry = s.motion.entries.get(id);
      const size = sizes.get(id);
      return entry && !entry.exiting && size ? [{ mesh: entry.mesh as THREE.Mesh, size }] : [];
    });
    if (!targets.length) return;
    const marks = buildCutMarks(targets, cutFocus.mode, s.renderer.getSize(new THREE.Vector2()));
    s.cutMarks = { marks, scissors: cutFocus.mode === 'piece' ? targets[0] : null };
  }, [cutFocus, parts]);
  useEffect(() => {
    const state = runtime.current;
    if (state) state.motion.setHover(hover?.id ?? null);
    // Sobre uma peça já selecionada, a mão avisa que dá para arrastar.
    if (host.current && !dragging.current)
      host.current.style.cursor = placing || placingWall
        ? 'crosshair'
        : hover
          ? movable && selected.includes(hover.id)
            ? 'grab'
            : 'pointer'
          : overObstacle
            ? movable && onMoveObstacle
              ? 'grab'
              : 'pointer'
            : overWall
              ? movable && onChangeWall
                ? 'grab'
                : 'pointer'
              : '';
  }, [hover, movable, selected, overObstacle, placing, onMoveObstacle, overWall, placingWall, onChangeWall]);
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
      if (latest.current.placing || latest.current.placingWall) return;
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
  // Sem ambiente informado, a parede de referência (`sceneRoom`) dá escala e
  // fundo; ela não aparece nas cotas de espaço livre nem no enquadramento.
  const measuredRoom = showRoom ? room : undefined;
  // Frente do que está preso na parede (painel): a TV fica na frente dele.
  const panelBoxes = useMemo(
    () =>
      parts
        .filter((p) => p.kind === 'panel')
        .map((p) => ({
          min: [p.position[0] - p.size[0] / 2, p.position[1] - p.size[1] / 2, p.position[2] - p.size[2] / 2],
          max: [p.position[0] + p.size[0] / 2, p.position[1] + p.size[1] / 2, p.position[2] + p.size[2] / 2],
        })),
    [parts],
  );
  // Ambiente: reconstruído quando o móvel muda de envelope, o ambiente muda
  // ou o tema troca. É pouca geometria; recriar é mais simples que ajustar.
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    if (s.room) {
      const old = s.room;
      s.scene.remove(old.group);
      s.retired.push(() => old.dispose());
    }
    s.room = undefined;
    if (sceneRoom) {
      s.room = buildRoom(sceneRoom, bounds, theme, panelBoxes, [...moduleBoxes(params).values()], selectedObstacle, selectedWall);
      s.scene.add(s.room.group);
    }
    s.grid.visible = !sceneRoom;
    // Com ambiente o piso dele recebe a sombra: o apanhador de sombra por cima
    // escurecia duas vezes e brigava com o piso na profundidade.
    s.shadowFloor.visible = !sceneRoom;
    s.ground.position.y = sceneRoom ? GROUND_UNDER_ROOM : -1;
    s.dirty = true;
  }, [sceneRoom, bounds, theme, panelBoxes, params, selectedObstacle, selectedWall]);
  // Parede nova: a prévia translúcida entra no lugar que veio com ela e segue
  // o cursor pelo piso até o clique (ou Enter).
  useEffect(() => {
    const s = runtime.current;
    if (!s || !placingWall || !s.room) return;
    const disposables: { dispose: () => void }[] = [];
    const group = buildWall(placingWall, {
      palette: ROOM_PALETTE[theme],
      theme,
      bad: false,
      ghost: true,
      track: (d) => disposables.push(d),
    });
    layoutWall(group, placingWall, { x0: s.room.wall.x0, z: s.room.face, height: s.room.wall.height });
    s.scene.add(group);
    s.placingWall = { group, wall: placingWall };
    s.placeWallTo?.(placingWall.xMm, placingWall.zMm);
    return () => {
      s.scene.remove(group);
      s.retired.push(() => disposables.forEach((d) => d.dispose()));
      s.placingWall = undefined;
      s.dirty = true;
      setMoveTip(null);
    };
  }, [placingWall, theme, sceneRoom, bounds]);
  // Obstáculo novo: a prévia translúcida entra na parede no lugar livre que
  // veio com ele e segue o cursor até o clique (ou Enter).
  useEffect(() => {
    const s = runtime.current;
    if (!s || !placing || !s.room) return;
    const disposables: { dispose: () => void }[] = [];
    const group = buildObstacle(placing, {
      palette: ROOM_PALETTE[theme],
      theme,
      bad: false,
      ghost: true,
      track: (d) => disposables.push(d),
    });
    group.position.set(s.room.wall.x0 + placing.xMm, placing.yMm, s.room.wall.z);
    s.scene.add(group);
    s.placing = { group, obstacle: placing, x: placing.xMm, y: placing.yMm, blocked: null };
    s.placeTo?.(placing.xMm, placing.yMm);
    return () => {
      s.scene.remove(group);
      s.retired.push(() => disposables.forEach((d) => d.dispose()));
      s.placing = undefined;
      s.dirty = true;
      setMoveTip(null);
    };
  }, [placing, theme, sceneRoom, bounds]);
  // Pondo obstáculo: setas andam 10 cm (Shift, 1 cm), Enter põe, Esc desiste.
  const cancelPlace = useRef(onCancelPlace);
  useEffect(() => {
    cancelPlace.current = onCancelPlace;
  }, [onCancelPlace]);
  useEffect(() => {
    if (!placing) return;
    const down = (e: KeyboardEvent) => {
      const s = runtime.current;
      if (!s?.placing || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const step = e.shiftKey ? 10 : 100;
      const { x, y } = s.placing;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      };
      if (moves[e.key]) {
        e.preventDefault();
        s.placeTo?.(x + moves[e.key][0], y + moves[e.key][1]);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        s.confirmPlacing?.();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelPlace.current?.();
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [placing]);
  // Pondo parede: setas andam 10 cm (Shift, 1 cm), R gira, Enter põe, Esc desiste.
  useEffect(() => {
    if (!placingWall) return;
    const down = (e: KeyboardEvent) => {
      const s = runtime.current;
      if (!s?.placingWall || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const step = e.shiftKey ? 10 : 100;
      const { xMm, zMm } = s.placingWall.wall;
      // Seta para cima leva para o fundo, como se afastar de quem olha.
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (moves[e.key]) {
        e.preventDefault();
        s.placeWallTo?.(xMm + moves[e.key][0], zMm + moves[e.key][1]);
      } else if (e.key.toLowerCase() === 'r') {
        // Antes do atalho da página (R esconde o ambiente).
        e.preventDefault();
        e.stopImmediatePropagation();
        s.turnPlacingWall?.();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        s.confirmPlacingWall?.();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelPlace.current?.();
      }
    };
    window.addEventListener('keydown', down, { capture: true });
    return () => window.removeEventListener('keydown', down, { capture: true });
  }, [placingWall]);
  // Pés, estrutura de aço e LED: não são peças de corte, vêm da composição
  // (lib/fittings.ts). Somem no explodido.
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    s.dirty = true;
    if (s.feet) {
      s.scene.remove(s.feet.group);
      s.retired.push(s.feet.dispose);
      s.feet = undefined;
    }
    const fittings = exploded ? [] : fittingsOf(params).filter((f) => !f.hidden && f.kind !== 'handle');
    if (!fittings.length) return;
    s.feet = buildFittings(fittings);
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
      s.retired.push(s.dims.dispose);
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
    // Viés normal do tamanho de um texel da sombra: fixo em 0,6 mm, com o
    // mapa cobrindo metros, a face lateral iluminada rente ganhava acne.
    s.sun.shadow.normalBias = ((reach * 2) / s.sun.shadow.mapSize.x) * 0.8;
    s.sun.shadow.camera.updateProjectionMatrix();
    s.sun.target.position.copy(target);
    // Sol alto e pouco à frente: a sombra fica junto da base, como luz de
    // ambiente interno, em vez de uma cunha comprida atrás do móvel.
    s.sun.position.copy(target).add(new THREE.Vector3(-reach * 0.35, reach * 2.2, reach * 0.75));
    s.ground.scale.set(Math.max(width, 1200) * 3.2, Math.max(depth, 1200) * 5, 1);
    s.ground.position.set(target.x, s.room ? GROUND_UNDER_ROOM : -1, target.z);
    s.grid.position.set(target.x, -2, target.z);
    let to: THREE.Vector3;
    const resetDirection = !s.view || s.view.mode !== view || s.view.frameRequest !== frameRequest;
    // Móvel arrastado à mão: a câmera fica onde a pessoa deixou (sombra e
    // piso acima já acompanharam). F ou trocar a vista reenquadram.
    if (!resetDirection && s.view && steady) return;
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
  }, [bounds, view, scrub, exploded, frameRequest, measuredRoom, steady]);
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
  const chosenObstacle = showRoom && selectedObstacle ? room?.obstacles?.find((o) => o.id === selectedObstacle) : undefined;
  const chosenWall = useMemo(() => {
    if (!showRoom || !selectedWall || !room) return null;
    if (selectedWall === MAIN_WALL) return { id: MAIN_WALL, name: 'Parede do fundo', width: room.widthMm, height: room.heightMm, wall: null };
    const w = room.walls?.find((v) => v.id === selectedWall);
    return w ? { id: w.id, name: wallName(w), width: w.widthMm, height: Math.min(w.heightMm, room.heightMm), wall: w } : null;
  }, [showRoom, selectedWall, room]);
  // Gravar o lugar novo trava o controle por ~100 ms: sem este atraso ele
  // piscava apagado a cada movimento.
  const padLocked = useDelayedTrue(!movable, 300);
  return (
    <div
      ref={host}
      className="scene"
      role="application"
      aria-label="Modelo 3D interativo. Arraste para girar, use a roda para aproximar, arraste com o botão direito para mover a vista e clique para selecionar peças. Arraste uma peça selecionada, ou use as setas, para mudar o móvel de lugar."
    >
      {!error && onMove && showMovePad && (
        <MovePad
          collapsible={!touch}
          target={target?.label ?? null}
          disabled={padLocked}
          status={moveStatus}
          onNudge={nudge}
          onRotate={rotate}
          mode={dragMode}
          onMode={setDragMode}
        />
      )}
      {moveTip && (
        <output className={'move-tip' + (moveTip.bad ? ' bad' : moveTip.warn ? ' warn' : '')} style={{ left: moveTip.x, top: moveTip.y }}>
          {moveTip.text}
        </output>
      )}
      {placing && (touch ? (
        <output className="place-hint touch">
          <span>
            <strong>Toque na parede</strong> onde fica {OBSTACLE_ARTICLE[placing.kind]}. Arraste para girar a vista.
          </span>
          <button type="button" onClick={() => onCancelPlace?.()}>
            Cancelar
          </button>
          <button type="button" className="primary" onClick={() => runtime.current?.confirmPlacing?.()}>
            Pôr aqui
          </button>
        </output>
      ) : (
        <output className="place-hint">
          <span>
            <strong>Clique na parede</strong> para pôr {OBSTACLE_ARTICLE[placing.kind]}.
            <span className="place-keys"> Setas ajustam, Enter confirma.</span>
          </span>
          <button type="button" onClick={() => onCancelPlace?.()}>
            Cancelar <kbd>Esc</kbd>
          </button>
        </output>
      ))}
      {placingWall && (touch ? (
        <output className="place-hint touch">
          <span>
            <strong>Toque no piso</strong> onde fica a parede. Arraste para girar a vista.
          </span>
          <button type="button" onClick={() => onCancelPlace?.()}>
            Cancelar
          </button>
          <button type="button" className="primary" onClick={() => runtime.current?.confirmPlacingWall?.()}>
            Pôr aqui
          </button>
        </output>
      ) : (
        <output className="place-hint">
          <span>
            <strong>Clique no piso</strong> para pôr a parede.
            <span className="place-keys"> R gira, setas ajustam, Enter confirma.</span>
          </span>
          <button type="button" onClick={() => onCancelPlace?.()}>
            Cancelar <kbd>Esc</kbd>
          </button>
        </output>
      ))}
      {chosenWall && !placing && !placingWall && (
        <div className="ob-bar wall-bar" ref={wallBar} role="toolbar" aria-label={`${chosenWall.name} escolhida`}>
          <span className="ob-bar-name">
            <strong>{chosenWall.name}</strong>
            <small>
              {metresText(chosenWall.width)} × {metresText(chosenWall.height)} m
            </small>
          </span>
          {chosenWall.wall && onChangeWall && room && (
            <button
              type="button"
              title="Girar 90°"
              aria-label="Girar 90°"
              disabled={!movable}
              onClick={() => onChangeWall(rotateWall(chosenWall.wall!, room))}
            >
              <RotateCw size={14} />
            </button>
          )}
          {onEditWall && (
            <button type="button" title="Medidas exatas" aria-label="Medidas exatas" onClick={() => onEditWall(chosenWall.id)}>
              <Pencil size={14} />
            </button>
          )}
          {chosenWall.wall && onRemoveWall && (
            <button type="button" className="danger" title="Remover (Delete)" aria-label="Remover" onClick={() => onRemoveWall(chosenWall.id)}>
              <Trash2 size={14} />
            </button>
          )}
          <button type="button" title="Fechar (Esc)" aria-label="Fechar" onClick={() => onSelectWall?.(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {chosenWall && !placing && !placingWall && (chosenWall.wall ? onChangeWall : onResizeMainWall) && (
        <div className="wall-handles" ref={wallHandles}>
          {(chosenWall.wall ? WALL_HANDLES : MAIN_HANDLES).map((h) => (
            <button
              key={h}
              type="button"
              tabIndex={-1}
              data-handle={h}
              className={'wall-handle ' + h}
              aria-label={handleLabel(h, !chosenWall.wall)}
              title={handleLabel(h, !chosenWall.wall)}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                if (!runtime.current?.beginHandle?.(h, e.nativeEvent)) return;
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  // Sem captura, o arrasto segue enquanto o ponteiro estiver na alça.
                }
              }}
              onPointerMove={(e) => runtime.current?.moveHandle?.(e.nativeEvent)}
              onPointerUp={() => runtime.current?.endHandle?.()}
              onPointerCancel={() => runtime.current?.endHandle?.()}
              onLostPointerCapture={() => runtime.current?.endHandle?.()}
            />
          ))}
        </div>
      )}
      <div className="wall-live-dims" ref={liveDimHost} aria-hidden="true">
        <span className="dim-label live" style={{ display: 'none' }} />
        <span className="dim-label live" style={{ display: 'none' }} />
      </div>
      {chosenObstacle && !placing && (
        <div className="ob-bar" ref={obBar} role="toolbar" aria-label={`${OBSTACLE_WORD[chosenObstacle.kind]} escolhida na parede`}>
          <span className="ob-bar-name">
            <strong>{chosenObstacle.label ?? OBSTACLE_WORD[chosenObstacle.kind]}</strong>
            <small>
              {Math.round(chosenObstacle.widthMm / 10)} × {Math.round(chosenObstacle.heightMm / 10)} cm
            </small>
          </span>
          {onEditObstacle && (
            <button type="button" title="Editar medidas" aria-label="Editar medidas" onClick={() => onEditObstacle(chosenObstacle.id)}>
              <Pencil size={14} />
            </button>
          )}
          {onRemoveObstacle && (
            <button type="button" className="danger" title="Remover (Delete)" aria-label="Remover" onClick={() => onRemoveObstacle(chosenObstacle.id)}>
              <Trash2 size={14} />
            </button>
          )}
          <button type="button" title="Fechar (Esc)" aria-label="Fechar" onClick={() => onSelectObstacle?.(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="cut-scissors" ref={scissorsEl} aria-hidden="true">
        <Scissors size={15} strokeWidth={2.2} />
      </div>
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
