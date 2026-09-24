/* oxlint-disable react/react-compiler -- Analyzer internal invariant on Base UI callbacks; React Compiler is not enabled. */
/* oxlint-disable next/no-img-element -- Uploaded references are local, normalized WebP assets. */
'use client';
import Link from 'next/link';
import { TurnProgress, turnLabel, type Pulse, type TimedProgress } from '@/components/turn-progress';
import { ModelPicker } from '@/components/model-picker';
import { UsageMeter } from '@/components/usage-meter';
import { ChangeSet } from '@/components/change-set';
import { designDiff, partDiff, playbackFrames } from '@/lib/diff';
import { readEvents } from '@/lib/sse';
import { type Progress, type TextPreview } from '@/lib/progress';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Box,
  Boxes,
  Camera,
  Copy,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Command as CommandIcon,
  DoorOpen,
  Download,
  FileJson,
  FileSpreadsheet,
  FlipHorizontal2,
  History,
  Image as ImageIcon,
  ImagePlus,
  PenLine,
  Layers,
  LayoutTemplate,
  ListTree,
  MessageSquare,
  Monitor,
  Moon,
  Orbit,
  PanelLeftClose,
  PanelRightClose,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  Printer,
  Receipt,
  Redo2,
  Ruler,
  Scan,
  Scissors,
  Sparkles,
  Square,
  StopCircle,
  Sun,
  Undo2,
  X,
  Play,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useProjectTools } from '@/hooks/use-project-tools';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import type { ImageRef } from '@/lib/images';
import { renderPartThumb, thumbKey } from '@/lib/part-thumb';
import FurnitureView, { type ViewMode } from '@/components/furniture-view';
import {
  cortecloud,
  cutCSV,
  describeChanges,
  opSchema,
  generateDesign,
  shelfInfos,
  type Design,
  type ShelfOp,
} from '@/lib/studio';
import { type Part } from '@/lib/furniture';
import type { Project, Message, Clarification } from '@/lib/store';
import { ModularEditor } from '@/components/modular-editor';
import { ProjectPicker, type ProjectSummary } from '@/components/project-picker';
import { RoomPanel } from '@/components/room-panel';
import { QuotePanel } from '@/components/quote-panel';
import { CutPlanPanel, cutPlanCSV } from '@/components/cut-plan-panel';
import { CommandPalette, type PaletteAction } from '@/components/command-palette';
import { TemplateGallery } from '@/components/template-gallery';
import { templates } from '@/lib/templates';
import { PrintSheet, groupParts } from '@/components/print-sheet';
import { entityIds, canonical, selectedPartIds } from '@/lib/studio';
import { drawingParts, generateComposition, openingLimit, openingPose, type ModularPart } from '@/lib/composition';
import { fitReport, fitSummary, type Room } from '@/lib/room';
import { DEFAULT_PRICES, mergePrices, money, quote as buildQuote, type Prices } from '@/lib/quote';
import { friendlyError } from '@/lib/errors';
import { MODEL_KEYS, modelInfo, tokensLabel, usd, type ModelKey, type TurnUsage } from '@/lib/models';
type State = Project & {
  params: Design;
  parts: Part[];
  openings: number[];
  warnings: string[];
  area: number;
  selected?: string[];
  viewAction?:{ids:string[];open:boolean};
  /** Quantas versões futuras a última edição descartou (0 quando não perde nada). */
  discarded?: number;
  noop?: boolean;
};
type Tab = 'project' | 'room' | 'quote' | 'cut' | 'parts' | 'history';
type ThemeChoice = 'system' | 'light' | 'dark';
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'project', label: 'Projeto', icon: <Boxes size={17} /> },
  { id: 'room', label: 'Ambiente', icon: <DoorOpen size={17} /> },
  { id: 'quote', label: 'Orçamento', icon: <Receipt size={17} /> },
  { id: 'cut', label: 'Corte', icon: <Scissors size={17} /> },
  { id: 'parts', label: 'Peças', icon: <ListTree size={17} /> },
  { id: 'history', label: 'Versões', icon: <History size={17} /> },
];
const VIEWS: { id: ViewMode; label: string; key: string; icon: React.ReactNode }[] = [
  { id: 'perspective', label: 'Perspectiva', key: '1', icon: <Box size={15} /> },
  { id: 'front', label: 'Frente', key: '2', icon: <Square size={15} /> },
  { id: 'side', label: 'Lado', key: '3', icon: <FlipHorizontal2 size={15} /> },
  { id: 'top', label: 'Topo', key: '4', icon: <ArrowDown size={15} /> },
];
function dotLeft(i: number, max: number) {
  return `${((i / Math.max(1, max)) * 100).toFixed(2)}%`;
}
async function api<T = State>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    path,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const d = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(d.error || 'Não foi possível concluir.');
  return d;
}
/** Leitura de preferência local: '' quando o navegador bloqueia o storage. */
function readLocal(key: string) {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
/**
 * Trava de criação de projeto. O app chega a montar duas vezes na mesma
 * abertura (visto no harness), e sem esta trava as duas instâncias criariam um
 * projeto cada. Vale por poucos segundos.
 */
function claimProjectCreation() {
  try {
    const lock = Number(localStorage.getItem('merce-creating') ?? '0');
    if (lock && Date.now() - lock < 8000) return false;
    localStorage.setItem('merce-creating', String(Date.now()));
    return true;
  } catch {
    return true;
  }
}
/** Marca o projeto recém-criado: quem montar depois mostra o aviso. */
function markFreshProject() {
  writeLocal('merce-fresh', '1');
}
function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  downloadUrl(name, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadUrl(name: string, url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}
/** Nome de arquivo a partir do nome do projeto: "Guarda-roupa 2" → guarda-roupa-2. */
function slug(name: string) {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'projeto'
  );
}
/** Centímetros com no máximo uma casa, sem zeros à direita: 80 ou 158.2. */
function cm(millimetres: number) {
  return String(Number((millimetres / 10).toFixed(1)));
}
/** Metros com duas casas e vírgula: "2,40". */
function metres(millimetres: number) {
  return (millimetres / 1000).toFixed(2).replace('.', ',');
}
/**
 * Milímetros para exibição: a divisão de um vão pode dar 185.33333 mm e a
 * tabela não deve mostrar a dízima inteira. Duas casas bastam para cortar.
 */
function mm(millimetres: number) {
  return String(Math.round(millimetres * 100) / 100);
}
/** Raciocínio exibido no painel de depuração: mantém o fim, que é o que importa. */
const REASONING_VIEW_CAP = 64 * 1024;
/** Tecla digitada num campo não é atalho: a pessoa está escrevendo. */
function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
/**
 * Peças que entraram, saíram e mudaram em cada turno, guardado por par de
 * revisões: a conversa inteira não recalcula o diff a cada tecla.
 */
const partsStatCache = new Map<string, { added: number; removed: number; changed: number } | null>();
function partsStatOf(p: State, m: Message) {
  const base = m.context?.baseRevisionId, result = m.result?.resultRevisionId;
  if (!base || !result) return null;
  const key = `${base}>${result}`;
  if (!partsStatCache.has(key)) {
    const before = p.revisions.find((r) => r.id === base)?.params;
    const after = p.revisions.find((r) => r.id === result)?.params;
    let stat: { added: number; removed: number; changed: number } | null = null;
    try {
      if (before && after) {
        const d = designDiff(before, after);
        stat = { added: d.added.length, removed: d.removed.length, changed: d.changed.length };
      }
    } catch {
      stat = null;
    }
    partsStatCache.set(key, stat);
  }
  return partsStatCache.get(key) ?? null;
}
export default function Home() {
  const [opened,setOpened] = useState<Record<string,number>>({});
  const [p, setP] = useState<State | null>(null),
    [projects, setProjects] = useState<ProjectSummary[]>([]),
    [text, setText] = useState(''),
    [pending, setPending] = useState(''),
    [progress, setProgress] = useState<TimedProgress[]>([]),
    [started, setStarted] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [exploded, setExploded] = useState(false),
    [view, setView] = useState<ViewMode>('perspective'),
    [spin, setSpin] = useState(false),
    [tab, setTab] = useState<Tab>('project'),
    [exportOpen, setExportOpen] = useState(false),
    [online, setOnline] = useState(false),
    [shelfDelta, setShelfDelta] = useState('50'),
    [gapTarget, setGapTarget] = useState(''),
    [gapPick, setGapPick] = useState('0'),
    [attachment, setAttachment] = useState<ImageRef | null>(null),
    [thumbs, setThumbs] = useState<Record<string, string>>({}),
    [pendingImage, setPendingImage] = useState<ImageRef | null>(null),
    [failedTurn, setFailedTurn] = useState<{ text: string; image: ImageRef | null; error: string; requestId: string } | null>(null),
    [forkName, setForkName] = useState(''),
    [uploading, setUploading] = useState(false),
    [historyPreview, setHistoryPreview] = useState<number | null>(null),
    /**
     * Mudanças de uma mensagem revistas na cena. `frame` -1 é o antes; depois
     * um quadro por operação. `pinned`: a pessoa pediu, então não some sozinho.
     */
    [review, setReview] = useState<{ id: string; frame: number; playing: boolean; pinned: boolean } | null>(null),
    [reviewFocus, setReviewFocus] = useState<string[] | null>(null),
    [scrubbing, setScrubbing] = useState(false),
    [model, setModel] = useState<ModelKey>('deepseek'),
    [available, setAvailable] = useState<ModelKey[]>([]),
    [pulse, setPulse] = useState<Pulse | null>(null),
    [liveUsage, setLiveUsage] = useState<TurnUsage | null>(null),
    [sessionUsage, setSessionUsage] = useState<TurnUsage[]>([]),
    [copied, setCopied] = useState(''),
    [live, setLive] = useState(false),
    [liveText, setLiveText] = useState<TextPreview | null>(null),
    // Resposta digitada no cartão de dúvida: o campo é do cartão, não do
    // composer, para o rascunho do pedido não se misturar com a resposta.
    [clarAnswer, setClarAnswer] = useState(''),
    [notice, setNotice] = useState(''),
    // Aviso de primeira visita. O estado do efeito de boot pode se perder se a
    // instância que montou não for a que ficou viva, então a marca é lida e
    // consumida por um efeito sincrono no mount.
    [freshBoot, setFreshBoot] = useState(false),
    // Esclarecimento já respondido nesta sessão: o cartão não pode continuar
    // parecendo uma pergunta em aberto enquanto a IA trabalha.
    [answeredClar, setAnsweredClar] = useState(''),
    [confirm, setConfirm] = useState<{ title: string; lines: string[] } | null>(null),
    // Quem observa a preferência é a cena 3D (é ela que gira); o botão apenas
    // reflete o que a cena faria.
    [reducedMotion, setReducedMotion] = useState(false),
    // v2: cena, painéis e ferramentas novas.
    [showDims, setShowDims] = useState(true),
    [showRoom, setShowRoom] = useState(true),
    [chatOpen, setChatOpen] = useState(true),
    [inspectorOpen, setInspectorOpen] = useState(true),
    [paletteOpen, setPaletteOpen] = useState(false),
    [galleryOpen, setGalleryOpen] = useState(false),
    /** A biblioteca abre para começar um projeto ou para somar ao atual. */
    [galleryMode, setGalleryMode] = useState<'new' | 'add'>('new'),
    [frameRequest, setFrameRequest] = useState(0),
    [zoomRequest, setZoomRequest] = useState<{ id: number; direction: 'in' | 'out' }>(),
    [snapshotRequest, setSnapshotRequest] = useState(0),
    [printShot, setPrintShot] = useState<string | null>(null),
    [themeChoice, setThemeChoice] = useState<ThemeChoice>('system'),
    [systemDark, setSystemDark] = useState(false),
    [prices, setPrices] = useState<Prices>(DEFAULT_PRICES),
    [renaming, setRenaming] = useState(false);
  const theme = themeChoice === 'system' ? (systemDark ? 'dark' : 'light') : themeChoice;
  /** Para que serve a próxima foto da cena: baixar o PNG ou ilustrar a impressão. */
  const snapshotPurpose = useRef<'download' | 'print'>('download');
  // A ação pendente do cartão de confirmação vive num ref: o cartão é render do
  // estado atual e o callback precisa enxergar o mesmo fechamento que o criou.
  const confirmAction = useRef<(() => void) | null>(null);
  // Buffer local do raciocínio exibido: o contrato do evento traz só o pedaço
  // novo, o painel acumula (mantendo o fim).
  const [reasoningView, setReasoningView] = useState('');
  // Preferências deste navegador: depuração ao vivo, tema, painéis, cena e preços.
  useEffect(() => {
    setLive(readLocal('merce-live') === '1');
    const savedModel = readLocal('merce-model');
    if ((MODEL_KEYS as readonly string[]).includes(savedModel)) setModel(savedModel as ModelKey);
    // Custo desta aba: sessionStorage, que some ao fechar a aba e sobrevive ao
    // recarregamento.
    try {
      const raw = sessionStorage.getItem('merce-session-usage');
      if (raw) setSessionUsage(Object.values(JSON.parse(raw) as Record<string, TurnUsage>));
    } catch {}
    const t = readLocal('merce-theme');
    if (t === 'light' || t === 'dark' || t === 'system') setThemeChoice(t);
    if (readLocal('merce-dims') === '0') setShowDims(false);
    if (readLocal('merce-room') === '0') setShowRoom(false);
    if (readLocal('merce-chat') === '0') setChatOpen(false);
    if (readLocal('merce-inspector') === '0') setInspectorOpen(false);
    const savedTab = readLocal('merce-tab');
    if (TABS.some((v) => v.id === savedTab)) setTab(savedTab as Tab);
    try {
      const raw = readLocal('merce-prices');
      if (raw) setPrices(mergePrices(JSON.parse(raw)));
    } catch {}
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(query.matches);
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  // Primeira visita: a marca é consumida uma vez, para o aviso não voltar.
  useEffect(() => {
    try {
      if (localStorage.getItem('merce-fresh') === '1') {
        localStorage.removeItem('merce-fresh');
        setFreshBoot(true);
      }
    } catch {}
  }, []);
  const chooseModel = (key: ModelKey) => {
    setModel(key);
    writeLocal('merce-model', key);
  };
  /** Soma à conta desta aba o custo de um turno, uma vez por pedido. */
  const recordSessionUsage = (state: State | undefined, requestId: string) => {
    const usage = state?.messages.findLast((m) => m.context?.requestId === requestId && m.usage)?.usage
      ?? state?.messages.findLast((m) => m.role === 'assistant' && m.error && m.usage)?.usage;
    if (!usage) return;
    try {
      const store = JSON.parse(sessionStorage.getItem('merce-session-usage') ?? '{}') as Record<string, TurnUsage>;
      store[requestId] = usage;
      sessionStorage.setItem('merce-session-usage', JSON.stringify(store));
      setSessionUsage(Object.values(store));
    } catch {
      setSessionUsage((list) => [...list, usage]);
    }
  };
  const toggleLive = () =>
    setLive((v) => {
      writeLocal('merce-live', v ? '0' : '1');
      return !v;
    });
  /** Preferência que alterna e fica lembrada neste navegador. */
  const remembered = (key: string, set: React.Dispatch<React.SetStateAction<boolean>>) => (next?: boolean) =>
    set((v) => {
      const value = next ?? !v;
      writeLocal(key, value ? '1' : '0');
      return value;
    });
  const toggleDims = remembered('merce-dims', setShowDims);
  const toggleRoom = remembered('merce-room', setShowRoom);
  const toggleChat = remembered('merce-chat', setChatOpen);
  const toggleInspector = remembered('merce-inspector', setInspectorOpen);
  const chooseTab = (next: Tab) => {
    setTab(next);
    writeLocal('merce-tab', next);
    if (!inspectorOpen) toggleInspector(true);
  };
  const cycleTheme = () =>
    setThemeChoice((current) => {
      const next: ThemeChoice = current === 'system' ? (systemDark ? 'light' : 'dark') : current === 'dark' ? 'light' : 'dark';
      writeLocal('merce-theme', next);
      return next;
    });
  const updatePrices = (next: Prices) => {
    setPrices(next);
    writeLocal('merce-prices', JSON.stringify(next));
  };
  const scrubCancelled = useRef(false);
  const reasoningBox = useRef<HTMLPreElement>(null);
  // O raciocínio rola junto: o que interessa é o fim, em tempo real.
  useEffect(() => {
    const box = reasoningBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [reasoningView]);
  const previewFrame = useRef(0);
  const previewFallback = useRef<number | undefined>(undefined);
  const pendingPreview = useRef<number | null>(null);
  const applyPendingPreview = () => {
    cancelAnimationFrame(previewFrame.current);
    clearTimeout(previewFallback.current);
    previewFrame.current = 0;
    const next = pendingPreview.current;
    pendingPreview.current = null;
    if (next !== null) setHistoryPreview(next);
  };
  const cancelPreview = () => {
    cancelAnimationFrame(previewFrame.current);
    clearTimeout(previewFallback.current);
    previewFrame.current = 0;
    pendingPreview.current = null;
  };
  const queuePreview = (v: number) => {
    pendingPreview.current = v;
    if (previewFrame.current) return;
    previewFrame.current = requestAnimationFrame(applyPendingPreview);
    previewFallback.current = window.setTimeout(applyPendingPreview, 60);
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const exportWrap = useRef<HTMLDivElement>(null);
  /** Um clique fora fecha o menu; sem isso ele cobria as abas do inspetor. */
  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!exportWrap.current?.contains(e.target as Node)) setExportOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportOpen]);
  /**
   * Editar a partir de uma versão antiga apaga todas as seguintes. Antes isto
   * acontecia em silêncio: agora a pessoa escolhe entre descartar e criar uma
   * alternativa que preserva o caminho atual.
   */
  const guardTruncation = (run: () => void | Promise<void>, what: string) => {
    if (!p || p.cursor >= p.revisions.length - 1) {
      return run();
    }
    const lost = p.revisions.length - p.cursor - 1;
    confirmAction.current = () => void run();
    setConfirm({
      title: `Editar a partir da versão ${p.cursor + 1} descarta ${lost === 1 ? '1 versão seguinte' : `${lost} versões seguintes`}`,
      lines: [
        `${what} cria uma nova versão e apaga ${lost === 1 ? 'a versão' : 'as versões'} ${p.revisions
          .slice(p.cursor + 1)
          .map((r) => `${r.number} (${r.label})`)
          .join(', ')} deste caminho.`,
        'O que já está desenhado na tela permanece; só o futuro do histórico se perde.',
        'Criar uma alternativa preserva tudo, num projeto separado.',
      ],
    });
    return undefined;
  };
  const closeConfirm = () => {
    confirmAction.current = null;
    setConfirm(null);
  };
  async function openProject(id: string) {
    setBusy(true);
    setError('');
    setExportOpen(false);
    try {
      accept(await api('/api/projects?id=' + id));
      setSelected([]);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  async function removeProject(id: string) {
    setBusy(true);
    setError('');
    try {
      await api('/api/projects', { id, version: 0, action: 'delete' });
      const left = await api<ProjectSummary[]>('/api/projects');
      setProjects(left);
      // Apagar o projeto aberto cai no vizinho; apagar o último cria um novo.
      if (id === p?.id)
        accept(
          left.length
            ? await api('/api/projects?id=' + left[0].id)
            : await api('/api/projects', { action: 'create' }),
        );
      await refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  const reviewId = review?.id ?? null;
  const reviewIndex = review?.frame ?? 0;
  const reviewData = useMemo(() => {
    if (!reviewId || !p) return null;
    const m = p.messages.find((v) => v.id === reviewId);
    const before = p.revisions.find((r) => r.id === m?.context?.baseRevisionId)?.params;
    const after = p.revisions.find((r) => r.id === m?.result?.resultRevisionId)?.params;
    if (!m || !before || !after) return null;
    const ops = m.result?.appliedOperations ?? [];
    return {
      message: m,
      before,
      frames: playbackFrames(before, ops, after),
      beforeParts: drawingParts(canonical(before)),
      /** A cena mostra a versão salva quando a revisão já é a vigente. */
      current: after === p.revisions[p.cursor].params,
    };
  }, [reviewId, p]);
  /** Quadro da reprodução: -1 é o antes, depois um por operação do lote. */
  const reviewFrame = useMemo(
    () =>
      reviewData
        ? reviewIndex < 0
          ? { design: reviewData.before, op: -1 }
          : reviewData.frames[Math.min(reviewIndex, reviewData.frames.length - 1)]
        : null,
    [reviewData, reviewIndex],
  );
  /** Revendo uma versão que não é a atual, ou no meio da reprodução: só olhar. */
  const reviewLocked = !!reviewData && (!!review?.playing || !reviewData.current);
  const visualParams = reviewFrame?.design ?? p?.revisions[historyPreview ?? p.cursor].params;
  const visualBounds = useMemo(() => (visualParams ? generateComposition(visualParams).bounds : null), [visualParams]);
  const visualSize = visualBounds ? ([0, 1, 2].map((i) => visualBounds.max[i] - visualBounds.min[i]) as [number, number, number]) : null;
  /**
   * Veredito de encaixe do ambiente, calculado uma vez por render: alimenta a
   * seção Ambiente e o aviso do cabeçalho. Sem ambiente informado não existe
   * veredito, e o cabeçalho não inventa um.
   */
  const roomFit = useMemo(() => {
    if (!p?.room || !visualParams) return null;
    const report = fitReport(visualParams, p.room);
    return { report, summary: fitSummary(visualParams, p.room, report) };
  }, [p?.room, visualParams]);
  // Chips de prévia são da linha do tempo; na revisão das mudanças quem fala
  // é o diff na conversa e a barra da cena.
  const previewChanges = useMemo(
    () =>
      p && visualParams && !reviewData
        ? describeChanges(p.revisions[p.cursor].params, visualParams)
        : [],
    [p, visualParams, reviewData],
  );
  const changed = useMemo(() => {
    if (!p || !visualBounds || historyPreview === null) return new Set<string>();
    const current = generateComposition(p.revisions[p.cursor].params).bounds;
    return new Set(['width', 'height', 'depth'].filter((_, i) =>
      visualBounds.max[i] - visualBounds.min[i] !== current.max[i] - current.min[i],
    ));
  }, [p, visualBounds, historyPreview]);
  const visualParts = useMemo(() => {
    if (!p) return [];
    if (reviewFrame) return generateDesign(reviewFrame.design).parts;
    const rev = p.revisions[historyPreview ?? p.cursor];
    return historyPreview === null || historyPreview === p.cursor ? p.parts : generateDesign(rev.params).parts;
  }, [p, historyPreview, reviewFrame]);
  // Diff na cena contra o antes do turno: cresce quadro a quadro na reprodução.
  const sceneDiff = useMemo(() => {
    if (!reviewData || !reviewFrame || !visualParams) return null;
    const d = partDiff(reviewData.beforeParts, drawingParts(canonical(reviewFrame.design)));
    const focus = reviewFocus?.length ? selectedPartIds(visualParams, reviewFocus) : null;
    return { ...d, focus };
  }, [reviewData, reviewFrame, visualParams, reviewFocus]);
  const historyCount = p?.revisions.length ?? 0;
  const displayParts=useMemo(()=>visualParts.map(part=>openingPose(part as ModularPart,historyPreview!==null?0:opened[(part as ModularPart).motion?.id??'']??0)),[visualParts,opened,historyPreview]);
  const displaySelected=visualParams?selectedPartIds(visualParams,selected):[];
  // Orçamento e plano de corte sempre da versão exibida: arrastar a linha do
  // tempo mostra quanto cada versão custava.
  const quote = useMemo(
    () => (visualParams ? buildQuote(visualParts as ModularPart[], visualParams.modules.length, prices) : null),
    [visualParts, visualParams, prices],
  );
  const [viewNotice,setViewNotice]=useState('');
  const historyMax=Math.max(0,historyCount-1);
  function toggleOpening(id:string){
    if(historyPreview!==null)return;
    setViewNotice('');
    if(opened[id]){const fraction=openingLimit(visualParts as ModularPart[],id,opened,opened[id],0);setOpened(prev=>({...prev,[id]:fraction}));if(fraction>0)setViewNotice('Fechamento limitado por outra peça aberta. Feche-a primeiro.');return;}
    const fraction=openingLimit(visualParts as ModularPart[],id,opened);
    setOpened(prev=>({...prev,[id]:fraction}));
    if(fraction<1)setViewNotice(fraction===0?'Abertura bloqueada por outra peça.':'Abertura limitada para evitar colisão com outra peça.');
  }
  /** Abre ou fecha todas as frentes de uma vez, respeitando as colisões. */
  function toggleAllFronts() {
    if (historyPreview !== null || !p) return;
    const groups = [...new Set((p.parts as ModularPart[]).filter((v) => v.motion).map((v) => v.motion!.id))];
    if (!groups.length) {
      setViewNotice('Este projeto não tem portas nem gavetas.');
      return;
    }
    const anyOpen = groups.some((g) => (opened[g] ?? 0) > 0);
    const next: Record<string, number> = {};
    let blocked = false;
    for (const g of groups) {
      const target = anyOpen ? 0 : 1;
      next[g] = openingLimit(p.parts as ModularPart[], g, next, 0, target);
      if (Math.abs(next[g] - target) > 1e-5) blocked = true;
    }
    setOpened(next);
    setViewNotice(blocked ? 'Algumas frentes pararam antes para não colidir.' : '');
  }
  const historyView = historyPreview ?? p?.cursor ?? 0;
  /**
   * Reprodução: o antes por um instante, depois uma operação por quadro. No
   * fim a cena fica no resultado com o diff aceso; sem a pessoa ter pedido,
   * o destaque some sozinho depois de alguns segundos.
   */
  useEffect(() => {
    if (!review || !reviewData) return;
    if (review.playing) {
      const last = reviewData.frames.length - 1;
      const timer = setTimeout(
        () =>
          setReview((r) =>
            r && r.id === review.id
              ? r.frame >= last
                ? { ...r, playing: false }
                : { ...r, frame: r.frame + 1 }
              : r,
          ),
        review.frame < 0 ? 550 : 750,
      );
      return () => clearTimeout(timer);
    }
    if (!review.pinned) {
      const timer = setTimeout(() => setReview(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [review, reviewData]);
  function startReview(id: string, pinned = true) {
    setReviewFocus(null);
    setReview({ id, frame: -1, playing: true, pinned });
  }
  function stopReview() {
    setReview(null);
    setReviewFocus(null);
  }
  /** Linha da conversa sob o cursor: a cena mostra o resultado e acende só ela. */
  function focusLine(id: string, targets: string[] | null) {
    setReviewFocus(targets);
    if (targets && (!review || review.id !== id))
      setReview({ id, frame: Number.MAX_SAFE_INTEGER, playing: false, pinned: false });
  }
  const messages = useRef<HTMLDivElement>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  // Quantas mensagens chegaram depois de a pessoa sair do fim. Rolar para cima
  // numa conversa parada não é "mensagem nova": o aviso só existe quando há
  // algo que ela ainda não viu.
  const [unseen, setUnseen] = useState(0);
  const seenCount = useRef(0);
  const onScroll = () => {
    const el = messages.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setPinnedToBottom(nearBottom);
    if (nearBottom) setUnseen(0);
  };
  useEffect(() => {
    const el = messages.current;
    if (!el || !pinnedToBottom) return;
    el.scrollTop = el.scrollHeight;
    // O cartão de progresso cresce enquanto a IA trabalha (passos, proposta,
    // contadores): cada pulso mantém o fim da conversa à vista.
  }, [p?.messages.length, pending, progress, pulse, liveUsage, pinnedToBottom]);
  useEffect(() => {
    const total = p?.messages.length ?? 0;
    if (pinnedToBottom) {
      seenCount.current = total;
      setUnseen(0);
      return;
    }
    if (total > seenCount.current) setUnseen(total - seenCount.current);
  }, [p?.messages.length, pinnedToBottom]);
  /** Revisão de uma mensagem: disponível, descartada ou indisponível. */
  const revisionState = (m: Message) => {
    if (!p || !m.revisionId) return { status: 'unknown' as const };
    const idx = p.revisions.findIndex((r) => r.id === m.revisionId);
    if (idx < 0) return { status: 'dropped' as const };
    return { status: 'found' as const, cursor: idx, revision: p.revisions[idx] };
  };
  const acceptedState=useRef({p,opened});
  useEffect(()=>{acceptedState.current={p,opened};},[p,opened]);
  const accept = (d: State, options: { dims?: boolean } = {}) => {
    setP(d);
    setHistoryPreview(null);
    writeLocal('merce-project', d.id);

    const previous=acceptedState.current;
    // Medida geral mudou (editar a largura de um módulo muda a composição
    // inteira): sem este aviso a mudança parecia não ter explicação.
    if (options.dims && previous.p?.id === d.id && previous.p) {
      const labels = ['largura', 'altura', 'profundidade'] as const;
      const before = [previous.p.params.width, previous.p.params.height, previous.p.params.depth];
      const after = [d.params.width, d.params.height, d.params.depth];
      const moved = labels
        .map((label, i) => (before[i] !== after[i] ? `${label} total ${cm(before[i])} → ${cm(after[i])} cm` : ''))
        .filter(Boolean);
      if (moved.length) setNotice(`Medida geral: ${moved.join('; ')}.`);
    }
    if (d.discarded) {
      setNotice(
        d.discarded === 1
          ? 'Esta edição descartou 1 versão seguinte do caminho.'
          : `Esta edição descartou ${d.discarded} versões seguintes do caminho.`,
      );
    }
    const sameRevision=previous.p?.id===d.id&&previous.p.revisions[previous.p.cursor].id===d.revisions[d.cursor].id;
    const nextOpen:Record<string,number>=sameRevision?{...previous.opened}:{};
    let blocked=false;
    if(d.viewAction){const all=d.parts as ModularPart[];const action=d.viewAction;const resolvedParts=selectedPartIds(d.params,action.ids);const groups=new Set(all.filter(part=>part.motion&&(resolvedParts.includes(part.id)||action.ids.includes(part.motion.id))).map(part=>part.motion!.id));for(const group of groups){const target=action.open?1:0;nextOpen[group]=openingLimit(all,group,nextOpen,nextOpen[group]??0,target);if(Math.abs(nextOpen[group]-target)>1e-5)blocked=true;}}
    setOpened(nextOpen);
    setViewNotice(blocked?'Alguns movimentos foram limitados para evitar colisões.':'');
    if (d.selected?.length)
      setSelected(d.selected.filter((id) => entityIds(d.params).includes(id)));
    else setSelected((s) => s.filter((id) => entityIds(d.params).includes(id)));
  };
  /**
   * Conjunto que um shift+clique puxa: a peça traz o módulo inteiro, o
   * compartimento traz as peças dele e o módulo traz tudo que é dele. Sem
   * shift é só a peça, como antes.
   */
  const groupOf = (id: string): string[] => {
    if (!p) return [id];
    const peca = p.parts.find((v) => v.id === id);
    if (peca) {
      const donos = peca.owners ?? [];
      return p.parts
        .filter((v) => (v.owners ?? []).some((dono) => donos.includes(dono)))
        .map((v) => v.id);
    }
    if (generateDesign(p.params).cells.some((c) => c.id === id))
      return [id, ...p.parts.filter((v) => v.cellId === id).map((v) => v.id)];
    if (p.params.modules.some((m) => m.id === id))
      return [id, ...p.parts.filter((v) => (v.owners ?? []).includes(id)).map((v) => v.id)];
    return [id];
  };
  const toggleSelected = (id: string, extend = false) => {
    const grupo = extend ? groupOf(id) : [id];
    setSelected((s) => {
      const dentro = grupo.every((v) => s.includes(v));
      return dentro
        ? s.filter((v) => !grupo.includes(v))
        : [...new Set([...s, ...grupo])];
    });
  };
  /** Seleção vinda da árvore: clique troca, shift+clique soma os conjuntos. */
  const selectMany = (ids: string[], extend = false) =>
    setSelected((s) =>
      extend ? [...new Set([...s, ...ids.flatMap(groupOf)])] : ids,
    );
  const refresh = async () =>
    setProjects(await api<ProjectSummary[]>('/api/projects'));
  useEffect(() => {
    void (async () => {
      try {
        const all = await api<ProjectSummary[]>('/api/projects');
        setProjects(all);
        // Só abre um projeto que este navegador já conhece. Sem memória, abre
        // um projeto NOVO: o mais recente da base pode ser de outra pessoa e
        // abrir sozinho já causou pedido gravado no projeto errado.
        let mine = all.find((v) => v.id === readLocal('merce-project'));
        if (!mine && !claimProjectCreation()) {
          // Outra instância da página já está criando um projeto: espera por ele.
          await new Promise((done) => setTimeout(done, 700));
          const again = await api<ProjectSummary[]>('/api/projects');
          mine = again.find((v) => !all.some((old) => old.id === v.id));
        }
        if (mine) {
          accept(await api('/api/projects?id=' + mine.id));
        } else {
          // Base vazia: o exemplo guiado é o primeiro contato. Havendo
          // qualquer projeto, criar um novo em branco é mais seguro.
          markFreshProject();
          accept(
            await api('/api/projects', { action: all.length ? 'create' : 'demo' }),
          );
        }
        await refresh();
        const h = await api<{ configured: boolean; models?: ModelKey[] }>('/api/health');
        setOnline(h.configured);
        if (h.models) setAvailable(h.models);
      } catch (e) {
        setError(friendlyError(e));
      }
    })();
  }, []);
  useEffect(() => cancelPreview, []);
  useEffect(() => {
    if (!p) return;
    const jobs: { key: string; size: [number, number, number]; color: string }[] = [];
    for (const m of p.messages)
      for (const s of m.report?.selected ?? []) {
        if (!s.size || !s.color) continue;
        const key = thumbKey(s.size, s.color);
        if (!thumbs[key] && !jobs.some((j) => j.key === key))
          jobs.push({ key, size: s.size, color: s.color });
      }
    if (!jobs.length) return;
    const next: Record<string, string> = {};
    for (const job of jobs) {
      const url = renderPartThumb(job.size, job.color);
      if (url) next[job.key] = url;
    }
    if (Object.keys(next).length) setThumbs((prev) => ({ ...prev, ...next }));
  }, [p, thumbs]);
  // Esc sai da revisão das mudanças e volta à versão vigente.
  useEffect(() => {
    if (!review) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopReview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [review]);
  useEffect(() => {
    if (!scrubbing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        scrubCancelled.current = true;
        cancelPreview();
        setHistoryPreview(null);
        setScrubbing(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scrubbing]);
  /**
   * Atalhos de teclado. O listener é registrado uma vez e lê o estado do
   * render atual por um ref: sem isso cada tecla veria o estado da montagem.
   */
  const shortcuts = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    shortcuts.current = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && key === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (paletteOpen || galleryOpen) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || key === 'y')) {
        if (typing(e.target)) return;
        e.preventDefault();
        if (key === 'y' || e.shiftKey) {
          if (!busy && p && p.cursor < p.revisions.length - 1) void action('redo');
        } else if (!busy && p && p.cursor > 0) void action('undo');
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const viewKey = VIEWS.find((v) => v.key === key);
      if (viewKey) setView(viewKey.id);
      else if (key === 'e') setExploded((v) => !v);
      else if (key === 'd') toggleDims();
      else if (key === 'r') toggleRoom();
      else if (key === 'f') setFrameRequest((v) => v + 1);
      else if (key === 'o') toggleAllFronts();
      else if (key === '+' || key === '=') setZoomRequest({ id: Date.now(), direction: 'in' });
      else if (key === '-') setZoomRequest({ id: Date.now(), direction: 'out' });
      else if (key === '[') toggleChat();
      else if (key === ']') toggleInspector();
      else if (key === '/') {
        e.preventDefault();
        if (!chatOpen) toggleChat(true);
        setTimeout(() => composer.current?.focus(), 30);
      } else if (key === 'escape' && selected.length) setSelected([]);
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcuts.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  /** Projeto em branco: a estante de sempre, com o aviso de como renomear. */
  async function createProject() {
    setGalleryOpen(false);
    const created = await action('create');
    if (created) {
      setNotice(
        `Projeto "${created.name}" criado. Clique no nome acima do 3D para renomear.`,
      );
    }
  }
  function openGallery(mode: 'new' | 'add') {
    setGalleryMode(mode);
    setGalleryOpen(true);
  }
  /** Soma um móvel da biblioteca ao projeto, pelo mesmo contrato do chat. */
  async function addFromLibrary(asset: string, placement: 'left' | 'right') {
    const name = templates.find((t) => t.id === asset)?.name ?? 'móvel';
    try {
      await applyOps([{ kind: 'asset.add', asset, placement }], `Biblioteca: ${name}`);
      setGalleryOpen(false);
      setFrameRequest((v) => v + 1);
    } catch {
      // O aviso geral já mostrou o motivo; a biblioteca fica aberta.
    }
  }
  async function createFromTemplate(template: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const created = await api<State>('/api/projects', { action: 'template', template });
      setGalleryOpen(false);
      accept(created);
      setSelected([]);
      setView('perspective');
      setExploded(false);
      setFrameRequest((v) => v + 1);
      if (created.room) setShowRoom(true);
      await refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  async function action(action: string, extra: object = {}) {
    if (busy) return null;
    setBusy(true);
    setError('');
    try {
      const next = await api<State>('/api/projects', {
        id: p?.id,
        version: p?.version,
        action,
        ...extra,
      });
      accept(next, { dims: true });
      await refresh();
      return next;
    } catch (e) {
      setError(friendlyError(e));
      return null;
    } finally {
      setBusy(false);
      setHistoryPreview(null);
    }
  }
  async function op(operation: ShelfOp, label: string) {
    if (busy || !p) return;
    // O painel precisa ver a rejeição para mostrar o motivo no formulário.
    return guardTruncation(() => runOps([operation], label, 'op'), label);
  }
  /** Lote atômico: igualar módulos que compartilham painel exige editar os dois. */
  async function applyOps(operations: ShelfOp[], label: string) {
    if (busy || !p) return;
    return guardTruncation(() => runOps(operations, label, 'ops'), label);
  }
  async function runOps(operations: ShelfOp[], label: string, kind: 'op' | 'ops') {
    if (busy || !p) return;
    setBusy(true);
    setError('');
    setNotice('');
    const before = p.params.modules.map((m) => m.id);
    try {
      const next =
        kind === 'op'
          ? await api<State>('/api/projects', { id: p.id, version: p.version, action: 'op', op: operations[0], label })
          : await api<State>('/api/projects', { id: p.id, version: p.version, action: 'ops', ops: operations, label });
      accept(next, { dims: true });
      // Um módulo novo passa a ser a seleção: sem isso o painel continuava
      // mostrando o módulo anterior e o recém-criado parecia inexistente.
      if (operations.some((v) => v.kind === 'module.add' || v.kind === 'module.duplicate')) {
        const added = next.params.modules.map((m) => m.id).filter((id) => !before.includes(id));
        if (added.length) setSelected(added);
      }
      await refresh();
    } catch (e) {
      setError(friendlyError(e));
      // O painel mostra o motivo no próprio formulário.
      throw e;
    } finally {
      setBusy(false);
      setHistoryPreview(null);
    }
  }
  /**
   * Ambiente é dado do lugar, não do móvel: salvar não abre revisão nem
   * descarta versões futuras, só grava as medidas no projeto.
   */
  async function saveRoom(room: Room) {
    const next = await action('room', { room });
    // O painel mostra o motivo no próprio formulário; o aviso geral já saiu.
    if (!next) throw new Error('Não foi possível salvar o ambiente.');
    setShowRoom(true);
  }
  async function forkFrom(cursor: number) {
    if (busy || !p) return;
    const shown = historyPreview ?? p.cursor;
    const target = cursor === -1 ? shown : cursor;
    const name = (forkName.trim() || `${p.name} · alternativa`).slice(0, 80);
    setBusy(true);
    setError('');
    try {
      const created = await api<State>('/api/projects', { id: p.id, version: p.version, action: 'fork', cursor: target, name });
      setForkName('');
      accept(created);
      await refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setHistoryPreview(null);
    }
  }
  function ShelfPanel() {
    if (!p) return null;
    const infos = shelfInfos(p.params);
    const selectedShelves = infos.filter((s) => selected.includes(s.id));
    const single = selectedShelves.length === 1 ? selectedShelves[0] : null;
    const shelfIds = selected.filter((id) => infos.some((s) => s.id === id));
    const delta = Number(shelfDelta);
    return (
      <div className="shelf-panel">
        <div className="section-label">Prateleiras</div>
        {single ? (
          <div className="shelf-card">
            <strong>{single.label}</strong>
            <div className="shelf-measures">
              <span>Posição <b>{Math.round(single.elevation)} mm</b></span>
              <span>Vão abaixo <b>{Math.round(single.gapBelow)} mm</b></span>
              <span>Vão acima <b>{Math.round(single.gapAbove)} mm</b></span>
            </div>
            <div className="shelf-row">
              <input
                type="number"
                aria-label="Deslocamento em milímetros (negativo desce)"
                placeholder="± mm"
                value={shelfDelta}
                onChange={(e) => setShelfDelta(e.target.value)}
                disabled={busy}
              />
              <Button variant="outline" disabled={busy || !Number.isFinite(delta) || delta === 0} onClick={() => void op({ kind: 'move', ids: [single.id], deltaMm: delta }, `${single.label}: deslocar ${delta} mm`)}>
                Mover
              </Button>
            </div>
            <div className="shelf-row">
              <input
                type="number"
                aria-label="Vão livre abaixo em milímetros"
                placeholder="Vão abaixo (mm)"
                value={gapTarget}
                onChange={(e) => setGapTarget(e.target.value)}
                disabled={busy}
              />
              <Button variant="outline" disabled={busy || !Number.isFinite(Number(gapTarget))} onClick={() => void op({ kind: 'gap', id: single.id, gapMm: Number(gapTarget) }, `${single.label}: vão de ${gapTarget} mm`)}>
                Definir vão
              </Button>
            </div>
            <div className="shelf-row">
              <Button variant="outline" disabled={busy} onClick={() => void op({ kind: 'remove', ids: [single.id] }, `Remover ${single.label}`)}>
                Remover {single.label.toLowerCase()}
              </Button>
            </div>
          </div>
        ) : (
          <p className="hint">
            {selectedShelves.length > 1
              ? `${selectedShelves.length} prateleiras selecionadas.`
              : 'Selecione uma prateleira no 3D, na lista ou num card da conversa.'}
          </p>
        )}
        {selectedShelves.length > 1 && (
          <>
            <div className="shelf-row">
              <input
                type="number"
                aria-label="Deslocamento conjunto em milímetros"
                placeholder="± mm"
                value={shelfDelta}
                onChange={(e) => setShelfDelta(e.target.value)}
                disabled={busy}
              />
              <Button variant="outline" disabled={busy || !Number.isFinite(delta) || delta === 0} onClick={() => void op({ kind: 'move', ids: shelfIds, deltaMm: delta }, `Mover ${shelfIds.length} prateleiras ${delta} mm`)}>
                Mover juntas
              </Button>
            </div>
            <div className="shelf-row">
              <Button variant="outline" disabled={busy} onClick={() => void op({ kind: 'remove', ids: shelfIds }, `Remover ${shelfIds.length} prateleiras`)}>
                Remover selecionadas
              </Button>
            </div>
          </>
        )}
        <div className="shelf-row">
          <select aria-label="Vão para nova prateleira" value={gapPick} onChange={(e) => setGapPick(e.target.value)} disabled={busy}>
            <option value="0">Vão 1 · abaixo ({infos[0] ? Math.round(infos[0].gapBelow) : 0} mm)</option>
            {infos.map((s, i) => (
              <option key={s.id} value={String(i + 1)}>Vão {i + 2} · acima {s.label} ({Math.round(s.gapAbove)} mm)</option>
            ))}
          </select>
        </div>
        <div className="shelf-row">
          <Button variant="outline" disabled={busy || !infos.length} onClick={() => void op({ kind: 'add', gap: Number(gapPick) }, 'Adicionar prateleira no vão')}>
            Inserir no vão
          </Button>
          <Button variant="outline" disabled={busy || !infos.length} onClick={() => void op({ kind: 'distribute' }, 'Distribuir prateleiras igualmente')}>
            Distribuir
          </Button>
        </div>
      </div>
    );
  }
  async function upload(file?: File) {
    if (!file || busy) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (file.type && !allowed.includes(file.type)) {
      setError('Anexe uma imagem JPG, PNG ou WebP. Para PDF ou outro arquivo, descreva o que ele mostra.');
      return;
    }
    if (attachment && attachment.name === file.name) {
      setError('Esta imagem já está anexada ao pedido.');
      return;
    }
    setBusy(true);
    setUploading(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('A imagem deve ter até 10 MB.');
      const body = new FormData(); body.append('image', file);
      const response = await fetch('/api/images', { method: 'POST', body });
      const result = await response.json() as ImageRef & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível anexar a imagem.');
      setAttachment(result);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); setUploading(false); }
  }
  function seekVersion(cursor: number) {
    if (!p || busy) return;
    if (cursor === p.cursor) { setHistoryPreview(null); return; }
    void action('seek', { cursor });
  }
  function stepVersion(delta: number) {
    if (!p || busy) return;
    seekVersion(Math.min(p.revisions.length - 1, Math.max(0, (historyPreview ?? p.cursor) + delta)));
  }
  const draftDuringWait = useRef('');
  /** Turno em andamento: o botão Parar aborta esta conexão. */
  const turnAbort = useRef<AbortController | null>(null);
  const stopped = useRef(false);
  function stopTurn() {
    stopped.current = true;
    turnAbort.current?.abort();
  }
  async function send(
    value = text,
    replyTo?: { clarificationId: string; optionId?: string },
    retry?: { text: string; image: ImageRef | null; requestId: string },
    confirmed = false,
  ) {
    if (!p || busy) return;
    const sentImage = retry?.image ?? attachment;
    const sentText = (retry?.text ?? value).trim();
    if (!sentText && !sentImage && !replyTo) return;
    const message = sentText || 'Use esta imagem como referência para a estante.';
    // Editar a partir de uma versão antiga apaga as seguintes: pergunte antes.
    if (!confirmed && p.cursor < p.revisions.length - 1) {
      void guardTruncation(
        () => void send(value, replyTo, retry, true),
        `Enviar "${message.length > 60 ? `${message.slice(0, 60)}…` : message}"`,
      );
      return;
    }
    const requestId = retry?.requestId ?? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    // O rascunho digitado não se perde ao clicar numa sugestão.
    const keepDraft = value !== text;
    if (replyTo) setAnsweredClar(replyTo.clarificationId);
    // O servidor grava o pedido antes de chamar a IA: quando o erro traz o
    // estado, o cartão repetível já está no histórico e não precisa de um
    // segundo cartão local.
    let serverRecorded = false;
    draftDuringWait.current = text;
    setPendingImage(sentImage);
    setAttachment(null);
    setBusy(true);
    setError('');
    setNotice('');
    setFailedTurn(null);
    if (!chatOpen) toggleChat(true);
    setPending(
      replyTo?.optionId
        ? `${message} (escolha: ${
            p.messages
              .find((m) => m.clarification?.id === replyTo.clarificationId)
              ?.clarification?.options.find((o) => o.id === replyTo.optionId)?.label ?? ''
          })`
        : message,
    );
    setProgress([]);
    setPulse(null);
    setLiveUsage(null);
    setLiveText(null);
    setReasoningView('');
    setStarted(Date.now());
    if (!keepDraft) setText('');
    const abort = new AbortController();
    turnAbort.current = abort;
    stopped.current = false;
    let finalState: State | undefined;
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        signal: abort.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          // Depuração: sem este cabeçalho o servidor manda o texto parcial da IA.
          ...(live ? {} : { 'X-Chat-Preview': 'hidden' }),
        },
        body: JSON.stringify({
          id: p.id,
          version: p.version,
          message,
          imageId: sentImage?.id,
          selected,
          requestId,
          model,
          prices,
          // Responder pelo cartão precisa chegar como resposta de
          // esclarecimento; antes o clique reenviava só o texto da pergunta.
          // Sem optionId é resposta digitada: resolve a pergunta do mesmo jeito.
          ...(replyTo
            ? {
                clarificationId: replyTo.clarificationId,
                ...(replyTo.optionId ? { optionId: replyTo.optionId } : {}),
              }
            : {}),
        }),
      });
      if (!r.ok || !r.body) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || 'Não foi possível concluir.');
      }
      let completed = false;
      await readEvents(r, ({ event, data }) => {
        if (event === 'progress') {
          const update = { ...(JSON.parse(data) as Progress), at: Date.now() };
          setProgress((previous) =>
            // A proposta da IA chega em pedaços: a etapa é atualizada no lugar
            // em vez de encher a lista de "Proposta da IA" repetida.
            update.stage === 'proposing' && previous.at(-1)?.stage === 'proposing'
              ? [...previous.slice(0, -1), update]
              : [...previous, update],
          );
        } else if (event === 'pulse') {
          setPulse(JSON.parse(data) as Pulse);
        } else if (event === 'usage') {
          setLiveUsage(JSON.parse(data) as TurnUsage);
        } else if (event === 'text') {
          const preview = JSON.parse(data) as TextPreview;
          setLiveText((previous) => ({ ...previous, ...preview }));
          if (preview.reasoningDelta)
            setReasoningView((previous) => {
              const buffered = previous + preview.reasoningDelta;
              return buffered.length > REASONING_VIEW_CAP
                ? buffered.slice(-REASONING_VIEW_CAP)
                : buffered;
            });
        } else if (event === 'done') {
          finalState = JSON.parse(data) as State;
          // O bloco de mudanças da resposta já conta as medidas: sem o aviso
          // de medida geral repetindo a mesma coisa embaixo do campo.
          accept(finalState);
          completed = true;
          // Turno que mudou o projeto: a cena mostra a mudança acontecendo.
          const last = finalState.messages.at(-1);
          if (last?.role === 'assistant' && last.report?.highlights?.length && last.result?.appliedOperations?.length)
            startReview(last.id, false);
        } else if (event === 'error') {
          const payload = JSON.parse(data) as { error: string; state?: State };
          // O servidor já salvou o pedido: aceitar o estado mantém a versão em dia.
          if (payload.state) {
            serverRecorded = true;
            finalState = payload.state;
            accept(payload.state, { dims: true });
          }
          throw new Error(payload.error);
        }
      });
      if (!completed)
        throw new Error(
          'A conexão terminou antes da confirmação. Use “Tentar novamente” — se a resposta já foi salva, ela reaparece sem aplicar duas vezes.',
        );
    } catch (e) {
      // Parar foi escolha da pessoa: o servidor grava o pedido interrompido
      // como cartão repetível. Um instante para ele gravar antes de sincronizar.
      if (stopped.current) await new Promise((done) => setTimeout(done, 700));
      // O servidor é a fonte da verdade. Se outra aba (ou uma ação de timeline)
      // salvou enquanto este turno corria, a versão local ficou para trás e
      // "Tentar novamente" reenviaria a versão velha para sempre. Sincroniza
      // antes de oferecer o cartão.
      try {
        const current = await api<State>('/api/projects?id=' + p.id);
        if (current.version !== p.version) accept(current);
        finalState ??= current;
      } catch {}
      if (stopped.current) {
        serverRecorded = true;
        setNotice('Pedido interrompido. Nada mudou no projeto; use “Tentar novamente” para repetir.');
      }
      // Sem registro no servidor (falha antes de salvar): cartão local e o
      // texto volta ao campo. Com registro, o histórico já tem o cartão
      // repetível e duplicá-lo confundiria.
      if (!serverRecorded) {
        setFailedTurn({ text: message, image: sentImage, error: friendlyError(e), requestId });
        if (draftDuringWait.current) {
          setText(draftDuringWait.current);
        } else if (!retry) {
          setText(message);
        }
        if (sentImage) setAttachment(sentImage);
      }
    } finally {
      recordSessionUsage(finalState, requestId);
      turnAbort.current = null;
      setPending('');
      setPendingImage(null);
      setProgress([]);
      setPulse(null);
      setLiveUsage(null);
      setLiveText(null);
      setReasoningView('');
      setBusy(false);
      draftDuringWait.current = '';
    }
  }
  useProjectTools(
    () =>
      p
        ? { id: p.id, version: p.version, params: p.params, parts: p.parts }
        : null,
    async (input) => {
      if (!p || busy) throw new Error('Aguarde o projeto.');
      const op = opSchema.parse(input);
      setBusy(true);
      try {
        const updated = await api('/api/projects', {
          id: p.id,
          version: p.version,
          action: 'op',
          op,
        });
        accept(updated, { dims: true });
        return {
          id: updated.id,
          version: updated.version,
          params: updated.params,
        };
      } finally {
        setBusy(false);
      }
    },
  );
  const onSnapshot = useCallback(
    (url: string) => {
      if (snapshotPurpose.current === 'print') {
        setPrintShot(url);
        // O React precisa pintar a foto na folha antes de a impressão abrir.
        setTimeout(() => window.print(), 120);
      } else downloadUrl(`${slug(p?.name ?? 'projeto')}.png`, url);
    },
    [p?.name],
  );
  function exportProjectJSON() {
    if (!p || !quote) return;
    const rows = groupParts(p.parts);
    download(
      `${slug(p.name)}.json`,
      JSON.stringify(
        {
          ...p,
          schemaVersion: 3,
          params: canonical(p.params),
          revisions: p.revisions.map((r) => ({ ...r, params: canonical(r.params) })),
          // Medidas gerais fora das revisões: quem lê o arquivo
          // não deve precisar somar módulos para saber o tamanho.
          resumo: {
            larguraMm: p.params.width,
            alturaMm: p.params.height,
            profundidadeMm: p.params.depth,
            modulos: p.params.modules.length,
            pecas: p.parts.length,
            itensDistintos: rows.length,
            areaM2: Number(rows.reduce((a, r) => a + r.area, 0).toFixed(4)),
            versaoExibida: p.cursor + 1,
            versoesSalvas: p.revisions.length,
            chapas: quote.counts.sheets,
            orcamentoEstimado: quote.total,
            // Ambiente do lugar, o mesmo que o cabeçalho confere.
            ...(p.room ? { ambiente: p.room } : {}),
          },
        },
        null,
        2,
      ),
    );
  }
  const exports: { id: string; label: string; hint: string; icon: React.ReactNode; run: () => void }[] = p && quote
    ? [
        { id: 'png', label: 'Foto da vista', hint: 'PNG com cotas', icon: <ImageIcon size={16} />, run: () => { snapshotPurpose.current = 'download'; setSnapshotRequest((v) => v + 1); } },
        { id: 'print', label: 'Imprimir / PDF', hint: 'Desenho, orçamento, peças e corte', icon: <Printer size={16} />, run: () => { snapshotPurpose.current = 'print'; setSnapshotRequest((v) => v + 1); } },
        { id: 'csv', label: 'Lista de peças', hint: 'CSV', icon: <FileSpreadsheet size={16} />, run: () => download(`${slug(p.name)}-pecas.csv`, cutCSV(p.params), 'text/csv;charset=utf-8') },
        { id: 'cut', label: 'Plano de corte', hint: 'CSV com posições', icon: <Scissors size={16} />, run: () => download(`${slug(p.name)}-corte.csv`, cutPlanCSV(quote.plan), 'text/csv;charset=utf-8') },
        { id: 'cortecloud', label: 'Cortecloud', hint: 'JSON experimental', icon: <FileJson size={16} />, run: () => download(`${slug(p.name)}-cortecloud.json`, JSON.stringify(cortecloud(p.params), null, 2)) },
        { id: 'json', label: 'Projeto completo', hint: 'JSON com histórico', icon: <FileJson size={16} />, run: exportProjectJSON },
      ]
    : [];
  const selectedNames = selected.map((id) => p?.parts.find((v) => v.id === id)?.name ?? p?.params.modules.find(m=>m.id===id)?.name ?? (p ? generateDesign(p.params).cells.find(c=>c.id===id)?.label : null) ?? id);
  // Entidades vivas desta versão: ids de módulo, compartimento, frente e peça.
  const aliveIds = useMemo(() => (p ? entityIds(p.params) : []), [p]);
  const clarificationAnswered = (id: string) =>
    id === answeredClar || !!p?.messages.some((m) => m.clarificationId === id);
  const targetPart=p?.parts.find(part=>part.id===selected[0]);
  const targetCell=p?generateDesign(p.params).cells.find(c=>c.id===selected[0]||c.id===targetPart?.cellId):undefined;
  // Quem propõe o próximo passo é a IA, com o contexto do último turno. A lista
  // fixa abaixo só aparece quando ela ainda não respondeu nada (primeira
  // interação) ou quando a resposta não trouxe sugestões.
  const aiSuggestions =
    p?.messages.findLast((m) => m.role === 'assistant' && m.suggestions?.length)
      ?.suggestions ?? [];
  const contextualSuggestions=selected.length>1?['Descreva os itens selecionados','Abra as frentes selecionadas']
    :targetCell?.node.front||targetPart?.kind==='door'||targetPart?.kind==='drawer'?['Abra esta frente','Feche esta frente','Troque esta frente para nogueira']
    :p?.params.modules.some(m=>m.id===selected[0])?['Duplique este módulo','Gire este módulo em 90 graus','Mude este módulo para verde sálvia']
    :targetCell&&!targetCell.node.split?['Divida este compartimento em duas colunas','Coloque duas portas neste compartimento','Coloque três gavetas neste compartimento']
    :selected.length?['Distribua as divisões deste compartimento','Deixe 400 mm livres antes desta divisória']
    :['Adicione um nicho à direita','Crie um gaveteiro de 80 × 90 × 45 cm','Troque o acabamento para nogueira'];
  const suggestions = aiSuggestions.length ? aiSuggestions : contextualSuggestions;
  // Pergunta em aberto: o cartão traz as respostas, então os chips de sugestão
  // saem de cena para não competir com a pergunta.
  const openClarification = (() => {
    if (!p) return false;
    const i = p.messages.findLastIndex(
      (m) =>
        m.role === 'assistant' &&
        m.clarification &&
        !clarificationAnswered(m.clarification.id),
    );
    return i >= 0 && !p.messages.slice(i + 1).some((later) => later.role === 'user');
  })();
  /** Resposta sugerida do cartão: clicar envia a escolha, não preenche campo. */
  const renderClarifyOption = (
    clar: Clarification,
    o: Clarification['options'][number],
    message: string,
  ) => {
    const alive = o.partIds.some((pid) => aliveIds.includes(pid));
    return (
      <button
        key={o.id}
        type="button"
        className={alive ? '' : 'dead'}
        disabled={busy}
        title={
          alive
            ? `Enviar a escolha: ${o.label}`
            : 'Esta opção pode não existir mais nesta versão; o servidor confere antes de aplicar'
        }
        onClick={() => void send(message, { clarificationId: clar.id, optionId: o.id })}
      >
        {o.label}
      </button>
    );
  };
  const hasFronts = !!p?.parts.some((v) => (v as ModularPart).motion);
  const anyOpen = Object.values(opened).some((v) => v > 0);
  const paletteActions: PaletteAction[] = [
    ...VIEWS.map((v) => ({ id: 'view-' + v.id, group: 'Vista', label: { perspective: 'Vista em perspectiva', front: 'Vista frontal', side: 'Vista lateral', top: 'Vista de topo' }[v.id], keys: v.key, icon: v.icon, run: () => setView(v.id) })),
    { id: 'fit', group: 'Vista', label: 'Enquadrar o móvel', keys: 'F', icon: <Scan size={15} />, run: () => setFrameRequest((v) => v + 1) },
    { id: 'dims', group: 'Vista', label: showDims ? 'Esconder cotas' : 'Mostrar cotas', keys: 'D', icon: <Ruler size={15} />, run: () => toggleDims() },
    { id: 'room', group: 'Vista', label: showRoom ? 'Esconder a parede e o ambiente' : 'Mostrar a parede e o ambiente', hint: p?.room ? '' : 'parede de referência', keys: 'R', icon: <DoorOpen size={15} />, run: () => toggleRoom() },
    { id: 'explode', group: 'Vista', label: exploded ? 'Juntar as peças' : 'Explodir as peças', keys: 'E', icon: <Layers size={15} />, run: () => setExploded((v) => !v) },
    { id: 'fronts', group: 'Vista', label: anyOpen ? 'Fechar portas e gavetas' : 'Abrir portas e gavetas', keys: 'O', icon: <DoorOpen size={15} />, disabled: !hasFronts, run: toggleAllFronts },
    { id: 'theme', group: 'Vista', label: theme === 'dark' ? 'Tema claro' : 'Tema escuro', icon: theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />, run: cycleTheme },
    ...TABS.map((t) => ({ id: 'tab-' + t.id, group: 'Painéis', label: `Abrir ${t.label}`, icon: t.icon, run: () => chooseTab(t.id) })),
    { id: 'chat', group: 'Painéis', label: chatOpen ? 'Recolher a conversa' : 'Abrir a conversa', keys: '[', icon: <MessageSquare size={15} />, run: () => toggleChat() },
    { id: 'inspector', group: 'Painéis', label: inspectorOpen ? 'Recolher o painel lateral' : 'Abrir o painel lateral', keys: ']', icon: <PanelRight size={15} />, run: () => toggleInspector() },
    { id: 'ask', group: 'Painéis', label: 'Escrever para a IA', keys: '/', icon: <Sparkles size={15} />, run: () => { if (!chatOpen) toggleChat(true); setTimeout(() => composer.current?.focus(), 30); } },
    { id: 'new', group: 'Projeto', label: 'Novo projeto…', hint: 'em branco ou modelo', icon: <Plus size={15} />, run: () => openGallery('new') },
    { id: 'library', group: 'Projeto', label: 'Adicionar da biblioteca…', hint: 'rack, cozinha, cômoda…', icon: <LayoutTemplate size={15} />, disabled: !p, run: () => openGallery('add') },
    { id: 'undo', group: 'Projeto', label: 'Desfazer', keys: 'Ctrl Z', icon: <Undo2 size={15} />, disabled: !p || p.cursor === 0 || busy, run: () => void action('undo') },
    { id: 'redo', group: 'Projeto', label: 'Refazer', keys: 'Ctrl Y', icon: <Redo2 size={15} />, disabled: !p || p.cursor >= p.revisions.length - 1 || busy, run: () => void action('redo') },
    { id: 'rename', group: 'Projeto', label: 'Renomear projeto', icon: <Pencil size={15} />, run: () => setRenaming(true) },
    ...exports.map((x) => ({ id: 'export-' + x.id, group: 'Exportar', label: x.label, hint: x.hint, icon: x.icon, run: x.run })),
  ];
  const messageCount = p?.messages.length ?? 0;
  return (
    <main
      className={
        'studio' + (chatOpen ? '' : ' no-chat') + (inspectorOpen ? '' : ' no-inspector')
      }
    >
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Merce, início">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="4" y="3" width="16" height="18" rx="1.5" />
              <path d="M4 9.5h16M12 9.5V21M4 15h8" />
            </svg>
          </span>
          merce<span className="brand-dot">.</span>
        </Link>
        <span className="topbar-sep" />
        <ProjectPicker
          projects={projects}
          current={p?.id}
          disabled={busy}
          onSelect={(id) => void openProject(id)}
          onDelete={removeProject}
        />
        <span className="saved" title="Cada alteração é salva neste computador">
          <Check size={13} /> Salvo
        </span>
        <div className="topbar-actions">
          <button type="button" className="palette-trigger" onClick={() => setPaletteOpen(true)}>
            <CommandIcon size={14} />
            <span>Buscar ações</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={cycleTheme}
            title={`Tema: ${themeChoice === 'system' ? 'do sistema' : theme === 'dark' ? 'escuro' : 'claro'}`}
            aria-label="Alternar tema claro e escuro"
          >
            {themeChoice === 'system' ? <Monitor size={16} /> : theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <Button variant="ghost" className="topbar-new" onClick={() => openGallery('new')} disabled={busy}>
            <Plus />
            Novo
          </Button>
          <div className="export-wrap" ref={exportWrap}>
            <Button
              className="export-button"
              aria-expanded={exportOpen}
              onClick={() => setExportOpen(!exportOpen)}
              disabled={!p || busy}
              title={
                busy
                  ? 'Aguarde a resposta atual: exportar agora gravaria a versão anterior'
                  : 'Exportar foto, PDF, peças, corte ou projeto'
              }
            >
              <Download />
              Exportar
              <ChevronDown size={14} />
            </Button>
            {exportOpen && p && (
              <div className="export-menu" role="menu">
                {exports.map((x) => (
                  <button
                    key={x.id}
                    role="menuitem"
                    onClick={() => {
                      setExportOpen(false);
                      x.run();
                    }}
                  >
                    <span className="menu-icon">{x.icon}</span>
                    <span>
                      {x.label}
                      <small>{x.hint}</small>
                    </span>
                  </button>
                ))}
                <p>
                  Cortecloud experimental. Nada inclui furação, instruções de montagem ou
                  certificação de estabilidade.
                </p>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="workbench">
        {chatOpen && (
        <aside className="chat-panel" aria-label="Conversa com a IA">
          <div className="panel-head">
            <span className="assistant-id">
              <span className="assistant-avatar"><Sparkles size={15} /></span>
              <span>
                <strong>Assistente</strong>
                <small>
                  <span className={pending ? 'work-dot' : online ? 'live-dot' : 'offline-dot'} />
                  {pending ? 'Trabalhando no seu pedido…' : online ? `${modelInfo(model).label} · pronto` : 'IA não configurada'}
                </small>
              </span>
            </span>
            <UsageMeter
              conversation={p?.messages.map((m) => m.usage) ?? []}
              session={sessionUsage}
              live={liveUsage}
            />
            <button type="button" className="icon-button" aria-label="Recolher a conversa" title="Recolher ( [ )" onClick={() => toggleChat(false)}>
              <PanelLeftClose size={16} />
            </button>
          </div>
          <div className="chat-messages" ref={messages} onScroll={onScroll}>
            {messageCount <= 1 && (
              <div className="intro">
                <span className="eyebrow">Da ideia às peças</span>
                <h1>O que vamos construir?</h1>
                <p>
                  Eu desenho, você ajusta. Orçamento e plano de corte saem
                  prontos a cada versão.
                </p>
                <div className="start-cards">
                  <button type="button" onClick={() => openGallery('new')}>
                    <span className="start-icon"><LayoutTemplate size={17} /></span>
                    <span>
                      <strong>Começar de um modelo</strong>
                      <small>Rack de TV, cozinha, guarda-roupa e mais {templates.length - 3}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setText('Quero um móvel de ');
                      setTimeout(() => {
                        const el = composer.current;
                        el?.focus();
                        el?.setSelectionRange(el.value.length, el.value.length);
                      }, 20);
                    }}
                  >
                    <span className="start-icon"><PenLine size={17} /></span>
                    <span>
                      <strong>Descrever com palavras</strong>
                      <small>Medidas, portas, gavetas e acabamento</small>
                    </span>
                  </button>
                  <button type="button" disabled={busy || !p} onClick={() => fileInput.current?.click()}>
                    <span className="start-icon"><ImagePlus size={17} /></span>
                    <span>
                      <strong>Copiar de uma foto</strong>
                      <small>Eu estimo as medidas e digo o erro</small>
                    </span>
                  </button>
                </div>
              </div>
            )}
            {p?.messages.map((m, i) => {
              const rev = revisionState(m);
              const clar = m.clarification;
              return (
              <div className={'message ' + m.role} key={m.id ?? i}>
                {m.role === 'assistant' && (
                  <span className="avatar">
                    <Sparkles size={13} />
                  </span>
                )}
                <div className="message-body">
                  {m.image && <img className="chat-image" src={m.image.url} alt={m.image.name} loading="lazy" />}
                  {m.report?.highlights?.length ? (
                    <>
                      <ChangeSet
                        lines={m.report.highlights}
                        revision={m.revision}
                        parts={partsStatOf(p, m)}
                        active={review?.id === m.id}
                        playing={review?.id === m.id && review.playing}
                        playingOp={review?.id === m.id && review.playing && reviewFrame ? reviewFrame.op : null}
                        onReplay={m.result?.appliedOperations?.length ? () => startReview(m.id) : undefined}
                        onStop={() => setReview((r) => (r ? { ...r, playing: false, frame: Number.MAX_SAFE_INTEGER, pinned: true } : r))}
                        onFocus={(targets) => focusLine(m.id, targets)}
                        onPick={(targets) => {
                          setReview({ id: m.id, frame: Number.MAX_SAFE_INTEGER, playing: false, pinned: true });
                          if (!reviewLocked) setSelected(targets);
                        }}
                      />
                      {m.report.prose && <p className="message-prose">{m.report.prose}</p>}
                      {m.report.review && (
                        <div className={'turn-review ' + m.report.review.fidelity}>
                          <span className="turn-review-label">
                            {m.report.review.fidelity === 'parecido'
                              ? 'Olhei o desenho: ficou parecido com a foto'
                              : m.report.review.fidelity === 'parcial'
                                ? 'Olhei o desenho: ficou parecido em parte'
                                : 'Olhei o desenho: ficou diferente da foto'}
                          </span>
                          <p>{m.report.review.verdict}</p>
                          {m.report.review.corrections > 0 && (
                            <em>
                              Ajustei {m.report.review.corrections} operaç
                              {m.report.review.corrections === 1 ? 'ão' : 'ões'} depois de olhar.
                            </em>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    m.content
                  )}
                  {m.error && <div className="turn-error" role="alert">{m.error}</div>}
                  {m.error && m.retry && (
                    <div className="confirm-actions">
                      <Button
                        variant="outline"
                        disabled={busy}
                        title="Reenvia o mesmo pedido; o que já foi aplicado não é repetido"
                        onClick={() =>
                          void send(m.retry!.message, undefined, {
                            text: m.retry!.message,
                            image: m.retry!.image ?? null,
                            requestId: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
                          })
                        }
                      >
                        Tentar novamente
                      </Button>
                    </div>
                  )}
                  {clar &&
                    !clarificationAnswered(clar.id) &&
                    !p.messages.slice(i + 1).some((later) => later.role === 'user') && (
                    <div className="clarify-card">
                      <p>{clar.question}</p>
                      {clar.options.length > 0 && (
                        <div className="clarify-options">
                          {clar.options.slice(0, 2).map((o) => renderClarifyOption(clar, o, m.content))}
                        </div>
                      )}
                      {clar.options.length > 2 && (
                        <div className="clarify-more">
                          <small>Outras opções</small>
                          <div>
                            {clar.options.slice(2).map((o) => renderClarifyOption(clar, o, m.content))}
                          </div>
                        </div>
                      )}
                      {!clar.options.length && (
                        <p className="clarify-empty">
                          A IA não conseguiu listar opções. Descreva de novo com a
                          medida ou com o nome do compartimento.
                        </p>
                      )}
                      <form
                        className="clarify-answer"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const answer = clarAnswer.trim();
                          if (!answer || busy) return;
                          setClarAnswer('');
                          void send(answer, { clarificationId: clar.id });
                        }}
                      >
                        <label htmlFor={`clar-answer-${clar.id}`}>
                          Ou responda com suas palavras
                        </label>
                        <input
                          id={`clar-answer-${clar.id}`}
                          value={clarAnswer}
                          onChange={(e) => setClarAnswer(e.target.value)}
                          placeholder="Escreva sua resposta"
                          disabled={busy}
                          maxLength={500}
                        />
                        <button type="submit" disabled={busy || !clarAnswer.trim()}>
                          Responder
                        </button>
                      </form>
                      <small>As opções são revalidadas antes de aplicar.</small>
                      <button
                        type="button"
                        className="clarify-dismiss"
                        disabled={busy}
                        title="A pergunta sai da frente; nada muda no projeto"
                        onClick={() => setAnsweredClar(clar.id)}
                      >
                        Deixar para depois
                      </button>
                    </div>
                  )}
                  {m.report?.selected && m.report.selected.length > 0 && (
                    <div className="part-showcase">
                      <strong>{m.result?.outcome === 'applied' ? 'Peças afetadas' : 'Peças mencionadas'}</strong>
                      <div>
                        {m.report.selected.map((s) => {
                          const alive = p?.parts.some((v) => v.id === s.id);
                          const chipRev = m.revisionId ? p?.revisions.find((r) => r.id === m.revisionId) : undefined;
                          const stale = !alive && !!chipRev;
                          return (
                          <button
                            key={s.id}
                            type="button"
                            className={'part-chip' + (stale ? ' stale' : '')}
                            title={alive ? 'Alternar seleção' : stale ? `Peça removida ou de versão anterior (${chipRev!.label})` : 'Peça de uma versão anterior'}
                            onClick={(e) => {
                              if (alive) toggleSelected(s.id, e.shiftKey);
                            }}
                          >
                            {s.size && s.color && thumbs[thumbKey(s.size, s.color)] && (
                              <img src={thumbs[thumbKey(s.size, s.color)]} alt="" loading="lazy" />
                            )}
                            <span className="part-meta">
                              <strong>{s.name}{stale ? ' · removida' : ''}</strong>
                              <small>
                                {s.dims} · {s.material}
                              </small>
                            </span>
                          </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {m.role === 'assistant' && (m.usage || m.report || rev.status !== 'unknown') && (
                    <div className="msg-meta">
                      {m.usage && (
                        <span
                          className="msg-cost"
                          title={`${m.usage.calls} ${m.usage.calls === 1 ? 'chamada' : 'chamadas'} · ${tokensLabel(m.usage.inputTokens)} de entrada · ${tokensLabel(m.usage.outputTokens)} de saída${m.usage.reasoningTokens ? ` (${tokensLabel(m.usage.reasoningTokens)} de raciocínio)` : ''}`}
                        >
                          {modelInfo(m.usage.model).label}
                          {m.report ? ` · ${(m.report.durationMs / 1000).toFixed(1).replace('.', ',')} s` : ''}
                          {` · ${tokensLabel(m.usage.inputTokens + m.usage.outputTokens)} tokens · ${usd(m.usage.costUsd)}`}
                        </span>
                      )}
                      <span className="msg-actions">
                        {(m.report?.prose || m.content) && (
                          <button
                            type="button"
                            title="Copiar o texto da resposta"
                            aria-label="Copiar o texto da resposta"
                            onClick={() => {
                              void navigator.clipboard?.writeText(m.report?.prose || m.content).then(() => {
                                setCopied(m.id);
                                setTimeout(() => setCopied(''), 1500);
                              });
                            }}
                          >
                            {copied === m.id ? <Check size={13} /> : <Copy size={13} />}
                          </button>
                        )}
                        {rev.status === 'found' && (
                          <button
                            type="button"
                            className="msg-version"
                            disabled={busy}
                            title="Ver o projeto nesta versão"
                            onClick={() => seekVersion(rev.cursor)}
                          >
                            v{rev.revision.number}
                          </button>
                        )}
                        {rev.status === 'dropped' && (
                          <small className="dropped" title="Versão original descartada neste caminho">versão descartada</small>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              );
            })}
            {!p && !error && (
              <>
                <p className="loading-line">Carregando seu estúdio…</p>
                {/* Só aparece se esta tela continuar aqui: sem JavaScript
                    (pacote trocado no servidor, rede caída) a página ficava
                    carregando para sempre, sem dizer o que fazer. */}
                <p className="boot-hint">
                  Está demorando mais que o normal. Se não sair em instantes,
                  recarregue a página (Ctrl+Shift+R): o app costuma estar em uma
                  versão mais nova que a desta aba.
                </p>
              </>
            )}
            {pending && (
              <>
                <div className="message user">
                  <div className="message-body">{pendingImage && <img className="chat-image" src={pendingImage.url} alt={pendingImage.name} />}{pending}</div>
                </div>
                <TurnProgress
                  events={progress}
                  started={started}
                  pulse={pulse}
                  usage={liveUsage}
                  model={model}
                  withPhoto={Boolean(pendingImage)}
                />
                {live && liveText && (
                  <div className="answer-stream">
                    <h3>
                      Resposta ao vivo · tentativa {liveText.attempt}
                      {liveText.bytes ? ` · ${(liveText.bytes / 1024).toFixed(1)} kB recebidos` : ''}
                    </h3>
                    {liveText.approach && <p>{liveText.approach}</p>}
                    {liveText.answer ? (
                      <p>
                        {liveText.answer}
                        <span className="text-caret" />
                      </p>
                    ) : (
                      <p>
                        Recebendo do provedor; a resposta pública aparece quando
                        os campos chegam.
                        <span className="text-caret" />
                      </p>
                    )}
                    <small>
                      Texto parcial da IA, ainda não validado nem salvo. Só a
                      resposta final cria revisão.
                    </small>
                  </div>
                )}
                {live && reasoningView && (
                  <div className="thinking">
                    <details open>
                      <summary>
                        <span className="thinking-dots">
                          <span />
                          <span />
                          <span />
                        </span>
                        Raciocínio do modelo ·{' '}
                        {(liveText?.reasoningTotal ?? 0) < 4096
                          ? `${liveText?.reasoningTotal ?? 0} caracteres`
                          : `${((liveText?.reasoningTotal ?? 0) / 1024).toFixed(1)} kB`}{' '}
                        (só em depuração; não é salvo nem reenviado)
                        {(liveText?.reasoningTotal ?? 0) > REASONING_VIEW_CAP
                          ? ' · mostrando o fim'
                          : ''}
                      </summary>
                      <pre ref={reasoningBox}>{reasoningView}</pre>
                    </details>
                  </div>
                )}
              </>
            )}
            {confirm && (
              <div className="confirm-card" role="alertdialog" aria-label={confirm.title}>
                <p>
                  <strong>{confirm.title}</strong>
                </p>
                <ul>
                  {confirm.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <div className="confirm-actions">
                  <Button variant="ghost" disabled={busy} onClick={closeConfirm}>
                    Cancelar
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    title="Preserva este caminho num projeto separado e continua a edição lá"
                    onClick={() => {
                      const cursor = p?.cursor ?? 0;
                      closeConfirm();
                      void forkFrom(cursor);
                    }}
                  >
                    Criar alternativa
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      const run = confirmAction.current;
                      confirmAction.current = null;
                      setConfirm(null);
                      run?.();
                    }}
                  >
                    Descartar e continuar
                  </Button>
                </div>
              </div>
            )}
            {failedTurn && (
              <div className="failed-turn" role="alert">
                <p><strong>Não enviado:</strong> {failedTurn.text}</p>
                <small>{failedTurn.error}</small>
                <div>
                  <Button variant="outline" disabled={busy} onClick={() => void send(failedTurn.text, undefined, { text: failedTurn.text, image: failedTurn.image, requestId: failedTurn.requestId })}>
                    Tentar novamente
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setFailedTurn(null)}>
                    Descartar
                  </Button>
                </div>
              </div>
            )}
            {unseen > 0 && (
              <div className="new-message-anchor">
                <button
                  type="button"
                  className="new-message-jump"
                  aria-live="polite"
                  onClick={() => {
                    setPinnedToBottom(true);
                    setUnseen(0);
                    const el = messages.current;
                    if (el) el.scrollTop = el.scrollHeight;
                  }}
                >
                  <span className="new-message-count">{unseen}</span>
                  {unseen === 1 ? 'nova mensagem' : 'novas mensagens'}
                  <ArrowDown size={13} />
                </button>
              </div>
            )}
          </div>
          <div className="composer-wrap">
            {p && !openClarification && !pending && suggestions.length > 0 && (
              <div className="suggestions" aria-label={aiSuggestions.length ? 'Próximos passos sugeridos' : 'Para começar'}>
                {suggestions.map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={busy}
                    title="Enviar esta sugestão (o que você digitou continua no campo)"
                    onClick={() => void send(v)}
                  >
                    {aiSuggestions.length ? <Sparkles size={12} /> : <ArrowUp size={12} />}
                    {v}
                  </button>
                ))}
              </div>
            )}
            {(notice || freshBoot) && (
              <output className="notice-banner">
                <span>
                  {notice ||
                    'Começamos um projeto novo. Use o seletor no topo para abrir um projeto antigo.'}
                </span>
                <button
                  aria-label="Fechar aviso"
                  onClick={() => {
                    setNotice('');
                    setFreshBoot(false);
                  }}
                >
                  <X size={13} />
                </button>
              </output>
            )}
            {viewNotice&&<output className="opening-notice">{viewNotice}</output>}
            {selected.length > 0 && (
              <div className="selection-chip">
                <span>
                  {selected.length === 1
                    ? `Selecionado: ${selectedNames[0]}`
                    : `${selected.length} itens selecionados: ${selectedNames.join(', ')}`}
                </span>
                <button
                  aria-label="Limpar seleção"
                  onClick={() => setSelected([])}
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {error && (
              <div className="error error-panel" role="alert">
                <span>{error}</span>
                <span className="error-actions">
                  {/mudou|desatualizado|Recarregue/i.test(error) && (
                    <button onClick={() => window.location.reload()}>
                      Recarregar projeto
                    </button>
                  )}
                  <button aria-label="Fechar aviso" onClick={() => setError('')}>
                    <X size={13} />
                  </button>
                </span>
              </div>
            )}
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <input ref={fileInput} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
              {attachment && <div className="attachment-preview"><img src={attachment.url} alt={attachment.name} /><span>{attachment.name}</span><button type="button" disabled={busy} aria-label="Remover imagem" onClick={() => setAttachment(null)}><X size={16} /></button></div>}
              {/* A foto agora serve para copiar layout: sem esta linha, quem
                  anexa uma referência não sabe que pode pedir a cópia. */}
              {attachment && <p className="attachment-hint">Peça “copie o layout desta foto” e eu monto uma versão com medidas estimadas, dizendo o erro e o que ficou de fora.</p>}
              {uploading && <output className="upload-status">Preparando imagem…</output>}
              <textarea
                ref={composer}
                aria-label="Mensagem para o assistente"
                placeholder={selected.length ? 'Peça algo sobre a seleção…' : 'Descreva seu móvel ou uma alteração…'}
                value={text}
                maxLength={4000}
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => {
                  const file = Array.from(e.clipboardData.items).find((item) => item.type.startsWith('image/'))?.getAsFile();
                  if (file) { e.preventDefault(); void upload(file); }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (busy) {
                      // Enter engolido sem aviso era um dos pontos de irritação.
                      setNotice('Aguarde a resposta atual antes de enviar outra mensagem. O texto continua aqui.');
                      return;
                    }
                    void send();
                  }
                  if (e.key === 'Escape') composer.current?.blur();
                }}
              />
              <div className="composer-bar">
                <Button type="button" variant="ghost" size="icon" disabled={busy || !p} title="Anexar imagem (JPG, PNG ou WebP, até 10 MB)" aria-label="Anexar imagem" onClick={() => fileInput.current?.click()}><ImagePlus /></Button>
                <ModelPicker
                  value={model}
                  available={available}
                  onChange={chooseModel}
                  live={live}
                  onToggleLive={toggleLive}
                  disabled={busy}
                />
                <span
                  className="composer-hint"
                  title="Enter envia · Shift+Enter quebra linha · aceita imagem JPG, PNG ou WebP"
                >
                  Enter envia · Shift+Enter quebra
                </span>
                {pending ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="composer-send stop"
                    aria-label="Parar a resposta"
                    title="Parar: o pedido fica salvo para tentar de novo"
                    onClick={stopTurn}
                  >
                    <StopCircle />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    className="composer-send"
                    aria-label="Enviar mensagem"
                    disabled={busy || !p || (!text.trim() && !attachment)}
                  >
                    <ArrowUp />
                  </Button>
                )}
              </div>
            </form>
          </div>
        </aside>
        )}
        <section className="viewport" aria-label="Modelo 3D">
          <div className="stage-head">
            {!chatOpen && (
              <button type="button" className="icon-button floating-toggle" aria-label="Abrir a conversa" title="Abrir a conversa ( [ )" onClick={() => toggleChat(true)}>
                <PanelLeft size={16} />
              </button>
            )}
            <div className="stage-title">
              {renaming && p ? (
                <input
                  className="title-input"
                  ref={(el) => el?.focus()}
                  defaultValue={p.name}
                  maxLength={80}
                  aria-label="Nome do projeto"
                  onBlur={(e) => {
                    setRenaming(false);
                    const name = e.target.value.trim();
                    if (name && name !== p.name) void action('rename', { name });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                      e.currentTarget.value = p.name;
                      e.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="title-button"
                  title="Clique para renomear"
                  disabled={!p || busy}
                  onClick={() => setRenaming(true)}
                >
                  <h2>{p?.name || 'Minha estante'}</h2>
                  <Pencil size={14} />
                </button>
              )}
              {p && visualSize && (
                <p className="stage-meta">
                  <span className={changed.size ? 'changed' : ''}>
                    {metres(visualSize[0])} × {metres(visualSize[1])} × {metres(visualSize[2])} m
                  </span>
                  <i />
                  {visualParams!.modules.length} {visualParams!.modules.length === 1 ? 'módulo' : 'módulos'}
                  <i />
                  {visualParts.length} peças
                  {quote && (
                    <>
                      <i />
                      <button type="button" className="meta-link" onClick={() => chooseTab('quote')}>
                        {money(quote.total)}
                      </button>
                    </>
                  )}
                </p>
              )}
            </div>
            <div className="stage-badges">
              {roomFit && (
                <button
                  type="button"
                  className={'fit-badge ' + (roomFit.report.fits ? 'ok' : 'bad')}
                  onClick={() => chooseTab('room')}
                  title={roomFit.summary}
                >
                  <span className="fit-dot" />
                  {roomFit.report.fits ? 'Cabe no ambiente' : 'Não cabe'}
                </button>
              )}
              <span className={'version-badge' + (historyPreview !== null && p && historyPreview !== p.cursor ? ' preview' : '')}>
                Versão {p ? (historyPreview ?? p.cursor) + 1 : 1}
                {historyPreview !== null && p && historyPreview !== p.cursor ? ' · prévia' : ''}
              </span>
            </div>
            <button
              type="button"
              className="icon-button floating-toggle"
              aria-label={inspectorOpen ? 'Recolher o painel lateral' : 'Abrir o painel lateral'}
              title={inspectorOpen ? 'Recolher o painel ( ] )' : 'Abrir o painel ( ] )'}
              onClick={() => toggleInspector()}
            >
              {inspectorOpen ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
            </button>
          </div>
          {p && historyPreview === null && p.cursor < p.revisions.length - 1 && (
            <p className="stage-warning">
              Editando a versão {p.cursor + 1} de {p.revisions.length}: uma nova edição descarta{' '}
              {p.revisions.length - p.cursor - 1 === 1 ? 'a versão seguinte' : `as ${p.revisions.length - p.cursor - 1} versões seguintes`}.
            </p>
          )}
          {roomFit && !roomFit.report.fits && <p className="stage-warning bad">{roomFit.summary}</p>}
          {reviewData && review && !pending && (() => {
            const lines = reviewData.message.report?.highlights ?? [];
            const total = reviewData.frames.length;
            const step = review.frame < 0 ? 0 : Math.min(review.frame + 1, total);
            const now = reviewFrame && reviewFrame.op >= 0 ? lines.find((l) => l.ops?.includes(reviewFrame.op)) : null;
            return (
              <output className={'review-bar' + (review.playing ? ' playing' : '')}>
                <span className="rb-legend" aria-hidden="true">
                  <i className="add" />
                  <i className="mod" />
                  <i className="del" />
                </span>
                <span className="rb-text">
                  {review.playing
                    ? review.frame < 0
                      ? 'Antes da mudança'
                      : `Passo ${step} de ${total}`
                    : `Mudanças da versão ${reviewData.message.revision ?? ''}`}
                  {review.playing ? (now ? <b>{now.title}</b> : null) : <b>verde entrou · âmbar mudou · vermelho saiu</b>}
                </span>
                {!review.playing && (
                  <button type="button" onClick={() => startReview(review.id)} title="Rever passo a passo">
                    <Play size={12} />
                  </button>
                )}
                <button type="button" onClick={stopReview} title="Fechar (Esc)" aria-label="Fechar a revisão das mudanças">
                  <X size={13} />
                </button>
              </output>
            );
          })()}
          {pending && (
            <output className="stage-working">
              <span className="tp-orb small" key={pulse?.bytes ?? 0} aria-hidden="true"><i /></span>
              {turnLabel(progress, pulse)}
              {liveUsage && <b>{usd(liveUsage.costUsd)}</b>}
            </output>
          )}
          {p && (
            <FurnitureView
              params={visualParams!}
              parts={displayParts}
              scrub={scrubbing}
              selected={displaySelected}
              onSelect={(id, extend) =>
                id === null ? setSelected([]) : toggleSelected(id, extend)
              }
              exploded={exploded}
              view={view}
              spin={spin}
              frameRequest={frameRequest}
              zoomRequest={zoomRequest}
              room={p.room}
              showRoom={showRoom}
              showDims={showDims}
              theme={theme}
              snapshotRequest={snapshotRequest}
              caption={visualSize ? `${p.name} · ${metres(visualSize[0])} × ${metres(visualSize[1])} × ${metres(visualSize[2])} m` : p.name}
              onSnapshot={onSnapshot}
              onSpinSuppressed={setReducedMotion}
              diff={sceneDiff}
            />
          )}
          <div className="stage-tools" role="toolbar" aria-label="Ferramentas da cena" aria-orientation="vertical">
            <button type="button" title="Aproximar (+)" aria-label="Aproximar" onClick={() => setZoomRequest({ id: Date.now(), direction: 'in' })}><ZoomIn size={17} /></button>
            <button type="button" title="Afastar (−)" aria-label="Afastar" onClick={() => setZoomRequest({ id: Date.now(), direction: 'out' })}><ZoomOut size={17} /></button>
            <button type="button" title="Enquadrar (F)" aria-label="Enquadrar o móvel" onClick={() => setFrameRequest((v) => v + 1)}><Scan size={17} /></button>
            <span className="tool-sep" />
            <button type="button" className={showDims ? 'active' : ''} aria-pressed={showDims} title="Cotas (D)" aria-label="Cotas" onClick={() => toggleDims()}><Ruler size={17} /></button>
            <button
              type="button"
              className={showRoom ? 'active' : ''}
              aria-pressed={showRoom}
              title={p?.room ? 'Ambiente no 3D (R)' : 'Parede de referência (R). Informe o ambiente real na aba Ambiente'}
              aria-label="Parede e ambiente no 3D"
              onClick={() => toggleRoom()}
            >
              <DoorOpen size={17} />
            </button>
            <button type="button" className={exploded ? 'active' : ''} aria-pressed={exploded} title="Explodir (E)" aria-label="Explodir" onClick={() => setExploded(!exploded)}><Layers size={17} /></button>
            <button
              type="button"
              className={anyOpen ? 'active' : ''}
              aria-pressed={anyOpen}
              disabled={!hasFronts || historyPreview !== null}
              title={hasFronts ? 'Abrir e fechar frentes (O)' : 'Sem portas ou gavetas'}
              aria-label="Abrir e fechar frentes"
              onClick={toggleAllFronts}
            >
              <Box size={17} />
            </button>
            <button
              type="button"
              className={spin && !reducedMotion ? 'active' : ''}
              aria-pressed={spin && !reducedMotion}
              disabled={reducedMotion}
              title={
                reducedMotion
                  ? 'Desativado: seu sistema pede menos animação (prefers-reduced-motion)'
                  : spin
                    ? 'Girar o modelo: ativo. Clique para parar.'
                    : 'Girar o modelo continuamente'
              }
              aria-label="Girar"
              onClick={() => setSpin(!spin)}
            >
              <Orbit size={17} />
            </button>
            <span className="tool-sep" />
            <button type="button" title="Foto da vista (PNG)" aria-label="Foto da vista" onClick={() => { snapshotPurpose.current = 'download'; setSnapshotRequest((v) => v + 1); }}><Camera size={17} /></button>
          </div>
          <div className="scene-bottom">
            <fieldset className="view-switch">
              <legend className="sr-only">Vista</legend>
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={view === v.id}
                  className={view === v.id ? 'active' : ''}
                  title={`${v.label} (${v.key})`}
                  onClick={() => setView(v.id)}
                >
                  {v.icon}
                  <span>{v.label}</span>
                </button>
              ))}
            </fieldset>
            {p && <div className="history-timeline">
              <div className="history-scrub">
                <button
                  type="button"
                  className="history-step"
                  disabled={busy || historyView <= 0}
                  onClick={() => stepVersion(-1)}
                  aria-label="Versão anterior"
                >
                  <ChevronLeft size={14} />
                </button>
                <div className="history-track">
                  <output
                    className="history-tip"
                    style={{
                      left: dotLeft(historyView, historyMax),
                      transform:
                        historyView <= 1
                          ? 'translateX(0)'
                          : historyView >= historyMax - 1
                            ? 'translateX(-100%)'
                            : 'translateX(-50%)',
                    }}
                  >
                    {p.revisions[historyView].label}
                  </output>
                  <div className="history-slider-wrap">
                    <Slider
                      aria-label="Versão do projeto"
                      aria-valuetext={`Versão ${historyView + 1} de ${historyCount}: ${p.revisions[historyView]?.label ?? ''}`}
                      title={
                        busy
                          ? 'Aguarde a resposta atual para navegar pelas versões'
                          : 'Arraste ou use as setas para ver uma versão anterior'
                      }
                      min={0}
                      max={Math.max(1, historyMax)}
                      step={1}
                      value={[historyView]}
                      // Desabilitar durante o turno tirava o foco do teclado a
                      // cada passo; a navegação fica habilitada e apenas ignora
                      // o movimento enquanto a IA responde.
                      disabled={historyCount < 2}
                      onValueChange={(value) => {
                        if (busy) return;
                        const v = Array.isArray(value) ? value[0] : value;
                        setScrubbing(true);
                        queuePreview(Math.min(v, historyMax));
                      }}
                      onValueCommitted={(value) => {
                        if (busy) return;
                        setScrubbing(false);
                        cancelPreview();
                        if (scrubCancelled.current) {
                          scrubCancelled.current = false;
                          setHistoryPreview(null);
                          return;
                        }
                        seekVersion(Math.min(Array.isArray(value) ? value[0] : value, historyMax));
                      }}
                    />
                    <div className="history-dots" aria-hidden="true">
                      {p.revisions.map((r, i) => (
                        <i
                          key={i}
                          className={
                            'history-dot' +
                            (i === p.cursor ? ' current' : '') +
                            (i === historyPreview ? ' previewed' : '')
                          }
                          style={{ left: dotLeft(i, historyMax) }}
                        />
                      ))}
                    </div>
                  </div>
                  {historyCount > 1 && (
                    <div className="history-ends" aria-hidden="true">
                      {p.revisions.map((r, i) =>
                        historyCount <= 8 || i === 0 || i === historyCount - 1 ? (
                          <span key={i} style={{ left: dotLeft(i, historyMax) }}>
                            {i + 1}
                          </span>
                        ) : null,
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="history-step"
                  disabled={busy || historyView >= historyCount - 1}
                  onClick={() => stepVersion(1)}
                  aria-label="Próxima versão"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
              {previewChanges.length > 0 && (
                <output className="preview-chips">
                  {previewChanges.map((change) => (
                    <span className="preview-chip" key={change}>{change}</span>
                  ))}
                  <button
                    type="button"
                    className="preview-cancel"
                    onClick={() => { scrubCancelled.current = true; cancelPreview(); setHistoryPreview(null); setScrubbing(false); }}
                  >
                    <X size={12} /> Cancelar (Esc)
                  </button>
                </output>
              )}
            </div>}
            <div className="history-actions">
              <Button
                variant="outline"
                size="icon"
                aria-label="Desfazer"
                title="Desfazer (Ctrl+Z)"
                disabled={busy || !p || p.cursor === 0}
                onClick={() => action('undo')}
              >
                <Undo2 />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Refazer"
                title="Refazer (Ctrl+Y)"
                disabled={busy || !p || p.cursor === p.revisions.length - 1}
                onClick={() => action('redo')}
              >
                <Redo2 />
              </Button>
            </div>
          </div>
        </section>
        {inspectorOpen && (
        <aside className="inspector" aria-label="Painel do projeto">
          <div className="inspector-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? 'active' : ''}
                onClick={() => chooseTab(t.id)}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          {p && (
            <div className="inspector-content" role="tabpanel">
              {tab === 'project' && (
                <ModularEditor
                  design={visualParams!}
                  selected={selected}
                  onSelect={selectMany}
                  onOp={op}
                  onOps={applyOps}
                  onLibrary={() => openGallery('add')}
                  busy={busy || historyPreview !== null || reviewLocked}
                  onOpen={toggleOpening}
                  opened={opened}
                />
              )}
              {tab === 'room' && (
                <RoomPanel
                  key={p.id}
                  room={p.room}
                  report={roomFit?.report ?? null}
                  summary={roomFit?.summary ?? ''}
                  busy={busy || historyPreview !== null || reviewLocked}
                  onSave={saveRoom}
                  showInScene={showRoom && !!p.room}
                  onToggleScene={(v) => toggleRoom(v)}
                />
              )}
              {tab === 'quote' && quote && (
                <QuotePanel name={p.name} quote={quote} prices={prices} onPrices={updatePrices} />
              )}
              {tab === 'cut' && quote && (
                <CutPlanPanel
                  plan={quote.plan}
                  selected={displaySelected}
                  onSelect={(id, extend) => toggleSelected(id, extend)}
                  onDownload={() => download(`${slug(p.name)}-corte.csv`, cutPlanCSV(quote.plan), 'text/csv;charset=utf-8')}
                />
              )}
              {tab === 'parts' && (
                <>
                  <div className="section-label">
                    <span>
                      {p.parts.length} peças{selected.length > 0 ? ` · ${selected.length} selecionada${selected.length > 1 ? 's' : ''}` : ''}
                    </span>
                    {selected.length > 0 && (
                      <button type="button" className="link-button" onClick={() => setSelected([])}>
                        limpar
                      </button>
                    )}
                  </div>
                  {p.params.modules.length===1 && p.params.modules[0].legacyIds ? (
                    <ShelfPanel />
                  ) : (
                    <p className="hint">
                      Clique para selecionar; Shift+clique seleciona o módulo inteiro.
                      Para mexer em prateleiras, use Dividir e Distribuir do
                      compartimento em Projeto.
                    </p>
                  )}
                  <div className="part-list">
                    {p.parts.map((v) => (
                      <button
                        className={
                          'part-row ' + (selected.includes(v.id) ? 'selected' : '')
                        }
                        key={v.id}
                        title="Clique para selecionar · Shift+clique seleciona o módulo inteiro"
                        onClick={(e) => toggleSelected(v.id, e.shiftKey)}
                      >
                        <i className="swatch-dot" style={{ '--swatch': (v as ModularPart).color } as React.CSSProperties} />
                        <span>
                          <strong>{v.name}</strong>
                          <small>{v.material}</small>
                        </span>
                        <code>
                          {mm(v.c)} × {mm(v.l)} × {mm(v.thickness)}
                        </code>
                      </button>
                    ))}
                  </div>
                  <p className="hint">
                    Medidas nominais. Veja o aproveitamento de chapas na aba Corte.
                    Posições de montagem e furação não estão incluídas.
                  </p>
                </>
              )}
              {tab === 'history' && (
                <>
                  <div className="section-label">
                    <span>{p.revisions.length} versões salvas</span>
                  </div>
                  <ol className="history-list">
                    {[...p.revisions.entries()].reverse().map(([i, r]) => (
                      <li key={i}>
                        <button
                          disabled={busy}
                          onClick={() => seekVersion(i)}
                          className={
                            'history-row ' + (i === p.cursor ? 'current' : '')
                          }
                        >
                          <span className="history-num">{i + 1}</span>
                          <div>
                            <strong>{r.label}</strong>
                            <small>{new Date(r.at).toLocaleString('pt-BR')}</small>
                            {i === p.cursor && <em>Versão atual</em>}
                            {(historyPreview ?? p.cursor) === i && historyPreview !== null && historyPreview !== p.cursor && <em>Prévia exibida</em>}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ol>
                  {p.origin && (
                    <p className="hint">
                      Alternativa criada da versão {p.origin.revision}. Original preservado.
                    </p>
                  )}
                  <div className="fork-box">
                    <div className="section-label">Criar alternativa</div>
                    <p className="hint">
                      Usa a versão {(historyPreview ?? p?.cursor ?? 0) + 1} atualmente exibida{(historyPreview !== null && historyPreview !== p?.cursor) ? ' (prévia)' : ''}; o original e as versões futuras são preservados.
                    </p>
                    <input
                      aria-label="Nome da alternativa"
                      placeholder={`${p?.name} · alternativa`}
                      value={forkName}
                      maxLength={80}
                      disabled={busy}
                      onChange={(e) => setForkName(e.target.value)}
                    />
                    <Button variant="outline" disabled={busy || !p} onClick={() => void forkFrom(-1)}>
                      Criar alternativa desta versão
                    </Button>
                  </div>
                  <p className="hint">
                    Arraste a linha do tempo ou clique numa versão para voltar. Uma nova edição
                    substitui o caminho desfeito.
                  </p>
                </>
              )}
            </div>
          )}
        </aside>
        )}
      </div>
      <CommandPalette
        key={paletteOpen ? 'open' : 'closed'}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
        onAsk={(value) => void send(value)}
      />
      <TemplateGallery
        open={galleryOpen}
        mode={galleryMode}
        busy={busy}
        onClose={() => setGalleryOpen(false)}
        onBlank={() => void createProject()}
        onPick={(id) => void createFromTemplate(id)}
        onAdd={(id, placement) => void addFromLibrary(id, placement)}
      />
      {p && quote && visualSize && (
        <PrintSheet
          name={p.name}
          version={p.cursor + 1}
          size={visualSize}
          moduleCount={p.params.modules.length}
          parts={p.parts as ModularPart[]}
          drawing={drawingParts(p.params)}
          quote={quote}
          snapshot={printShot}
        />
      )}
    </main>
  );
}
