/* oxlint-disable react/react-compiler -- Analyzer internal invariant on Base UI callbacks; React Compiler is not enabled. */
/* oxlint-disable next/no-img-element -- Uploaded references are local, normalized WebP assets. */
'use client';
import Link from 'next/link';
import { ChatProgress } from '@/components/chat-progress';
import { readEvents } from '@/lib/sse';
import { type Progress, type TextPreview } from '@/lib/progress';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Box,
  Bug,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FlipHorizontal2,
  ImagePlus,
  Layers,
  Orbit,
  Plus,
  Redo2,
  Sparkles,
  Square,
  Undo2,
  X,
  Zap,
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
import type { Project, Message } from '@/lib/store';
import { ModularEditor } from '@/components/modular-editor';
import { ProjectPicker, type ProjectSummary } from '@/components/project-picker';
import { entityIds, canonical, selectedPartIds } from '@/lib/studio';
import { openingLimit, openingPose, type ModularPart } from '@/lib/composition';
type State = Project & {
  params: Design;
  parts: Part[];
  openings: number[];
  warnings: string[];
  area: number;
  selected?: string[];
  viewAction?:{ids:string[];open:boolean};
};
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
function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Centímetros com no máximo uma casa, sem zeros à direita: 80 ou 158.2. */
function cm(millimetres: number) {
  return String(Number((millimetres / 10).toFixed(1)));
}
/**
 * Milímetros para exibição: a divisão de um vão pode dar 185.33333 mm e a
 * tabela não deve mostrar a dízima inteira. Duas casas bastam para cortar.
 */
function mm(millimetres: number) {
  return String(Math.round(millimetres * 100) / 100);
}
/**
 * Agrupa peças idênticas para a folha impressa: quatro prateleiras iguais são
 * uma linha com quantidade 4, não quatro linhas com quantidade 1.
 */
function groupParts(parts: Part[]) {
  const rows = new Map<
    string,
    {
      key: string;
      name: string;
      count: number;
      duplicates: number;
      c: number;
      l: number;
      thickness: number;
      material: string;
      area: number;
    }
  >();
  for (const part of parts) {
    const key = [part.name, part.c, part.l, part.thickness, part.material].join(
      '|',
    );
    const row = rows.get(key);
    if (row) {
      row.count += 1;
      row.duplicates += 1;
      row.area += (part.c * part.l) / 1_000_000;
    } else
      rows.set(key, {
        key,
        name: part.name,
        count: 1,
        duplicates: 1,
        c: part.c,
        l: part.l,
        thickness: part.thickness,
        material: part.material,
        area: (part.c * part.l) / 1_000_000,
      });
  }
  return [...rows.values()];
}
/**
 * Falhas de rede chegam como TypeError ("Failed to fetch") ou "network error"
 * do motor do navegador. A interface é em português: traduzir na fronteira.
 */
function friendlyError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|network error|load failed|fetch failed|err_/i.test(message))
    return 'Sem conexão com o estúdio local. Verifique se o servidor está rodando e tente novamente.';
  if (/aborted|abort/i.test(message) && !/timeout/i.test(message))
    return 'A conexão foi interrompida antes da resposta. Tente novamente.';
  return message || 'Não foi possível concluir.';
}
export default function Home() {
  const [opened,setOpened] = useState<Record<string,number>>({});
  const [p, setP] = useState<State | null>(null),
    [projects, setProjects] = useState<ProjectSummary[]>([]),
    [text, setText] = useState(''),
    [pending, setPending] = useState(''),
    [progress, setProgress] = useState<Progress[]>([]),
    [started, setStarted] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [exploded, setExploded] = useState(false),
    [view, setView] = useState<ViewMode>('perspective'),
    [spin, setSpin] = useState(false),
    [tab, setTab] = useState('params'),
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
    [scrubbing, setScrubbing] = useState(false),
    [fast, setFast] = useState(false),
    [live, setLive] = useState(false),
    [liveText, setLiveText] = useState<TextPreview | null>(null);
  // Depuração: a transmissão do texto parcial é opcional e lembrada entre sessões.
  useEffect(() => {
    try {
      setLive(localStorage.getItem('merce-live') === '1');
    } catch {}
  }, []);
  const toggleLive = () =>
    setLive((v) => {
      try {
        localStorage.setItem('merce-live', v ? '0' : '1');
      } catch {}
      return !v;
    });
  const scrubCancelled = useRef(false);
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
  const visualParams = p?.revisions[historyPreview ?? p.cursor].params;
  const previewChanges = useMemo(
    () =>
      p && visualParams
        ? describeChanges(p.revisions[p.cursor].params, visualParams)
        : [],
    [p, visualParams],
  );
  const changed = useMemo(
    () =>
      new Set(
        (['width', 'height', 'depth', 'materialId'] as const).filter(
          (key) => p && visualParams && p.revisions[p.cursor].params[key] !== visualParams[key],
        ),
      ),
    [p, visualParams],
  );
  const visualParts = useMemo(() => {
    if (!p) return [];
    const rev = p.revisions[historyPreview ?? p.cursor];
    return historyPreview === null || historyPreview === p.cursor ? p.parts : generateDesign(rev.params).parts;
  }, [p, historyPreview]);
  const historyCount = p?.revisions.length ?? 0;
  const displayParts=useMemo(()=>visualParts.map(part=>openingPose(part as ModularPart,historyPreview!==null?0:opened[(part as ModularPart).motion?.id??'']??0)),[visualParts,opened,historyPreview]);
  const displaySelected=visualParams?selectedPartIds(visualParams,selected):[];
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
  const historyView = historyPreview ?? p?.cursor ?? 0;
  const messages = useRef<HTMLDivElement>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [newMessageFlag, setNewMessageFlag] = useState(false);
  const onScroll = () => {
    const el = messages.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setPinnedToBottom(nearBottom);
    if (nearBottom) setNewMessageFlag(false);
  };
  useEffect(() => {
    const el = messages.current;
    if (!el || !pinnedToBottom) return;
    el.scrollTop = el.scrollHeight;
  }, [p?.messages.length, pending, progress.length, pinnedToBottom]);
  useEffect(() => {
    if (!pinnedToBottom && p?.messages.length) setNewMessageFlag(true);
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
  const accept = (d: State) => {
    setP(d);
    setHistoryPreview(null);

    const previous=acceptedState.current;
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
  const toggleSelected = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((v) => v !== id) : [...s, id]));
  const refresh = async () =>
    setProjects(await api<ProjectSummary[]>('/api/projects'));
  useEffect(() => {
    void (async () => {
      try {
        const all = await api<ProjectSummary[]>('/api/projects');
        setProjects(all);
        accept(
          all.length
            ? await api('/api/projects?id=' + all[0].id)
            : await api('/api/projects', { action: 'demo' }),
        );
        await refresh();
        const h = await api<{ configured: boolean }>('/api/health');
        setOnline(h.configured);
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
  /** Ctrl/Cmd+Z e Shift+Z: os botões existiam, o atalho não. */
  const undoRedo = useRef({ undo: () => {}, redo: () => {} });
  // Sem lista de dependências: o ref sempre aponta para o estado do render
  // atual, e o listener é registrado uma única vez.
  useEffect(() => {
    undoRedo.current = {
      undo: () => {
        if (!busy && p && p.cursor > 0) void action('undo');
      },
      redo: () => {
        if (!busy && p && p.cursor < p.revisions.length - 1) void action('redo');
      },
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'))
        return;
      e.preventDefault();
      if (key === 'y' || e.shiftKey) undoRedo.current.redo();
      else undoRedo.current.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  async function action(action: string, extra: object = {}) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      accept(
        await api('/api/projects', {
          id: p?.id,
          version: p?.version,
          action,
          ...extra,
        }),
      );
      await refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setHistoryPreview(null);
    }
  }
  async function op(operation: ShelfOp, label: string) {
    if (busy || !p) return;
    setBusy(true);
    setError('');
    const before = p.params.modules.map((m) => m.id);
    try {
      const next = await api<State>('/api/projects', { id: p.id, version: p.version, action: 'op', op: operation, label });
      accept(next);
      // Um módulo novo passa a ser a seleção: sem isso o painel continuava
      // mostrando o módulo anterior e o recém-criado parecia inexistente.
      if (operation.kind === 'module.add' || operation.kind === 'module.duplicate') {
        const added = next.params.modules.map((m) => m.id).filter((id) => !before.includes(id));
        if (added.length) setSelected(added);
      }
      await refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setHistoryPreview(null);
    }
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
        <div className="section-label">PRATELEIRAS</div>
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
          <p className="shelf-hint">
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
  async function send(
    value = text,
    replyTo?: { clarificationId: string; optionId: string },
    retry?: { text: string; image: ImageRef | null; requestId: string },
  ) {
    if (!p || busy) return;
    const sentImage = retry?.image ?? attachment;
    const sentText = (retry?.text ?? value).trim();
    if (!sentText && !sentImage && !replyTo) return;
    const requestId = retry?.requestId ?? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    const message = sentText || 'Use esta imagem como referência para a estante.';
    draftDuringWait.current = text;
    setPendingImage(sentImage);
    setAttachment(null);
    setBusy(true);
    setError('');
    setFailedTurn(null);
    setPending(replyTo ? `${message} (escolha: ${p.messages.find((m) => m.clarification?.id === replyTo.clarificationId)?.clarification?.options.find((o) => o.id === replyTo.optionId)?.label ?? ''})` : message);
    setProgress([]);
    setLiveText(null);
    setStarted(Date.now());
    setText('');
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
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
          fast,
        }),
      });
      if (!r.ok || !r.body) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || 'Não foi possível concluir.');
      }
      let completed = false;
      await readEvents(r, ({ event, data }) => {
        if (event === 'progress') {
          const update = JSON.parse(data) as Progress;
          setProgress((previous) => [...previous, update]);
        } else if (event === 'text') {
          setLiveText(JSON.parse(data) as { approach: string; answer: string; attempt: number });
        } else if (event === 'done') {
          accept(JSON.parse(data) as State);
          completed = true;
        } else if (event === 'error')
          throw new Error((JSON.parse(data) as { error: string }).error);
      });
      if (!completed)
        throw new Error(
          'A conexão terminou antes da confirmação. Use “Tentar novamente” — se a resposta já foi salva, ela reaparece sem aplicar duas vezes.',
        );
    } catch (e) {
      // O servidor é a fonte da verdade. Se outra aba (ou uma ação de timeline)
      // salvou enquanto este turno corria, a versão local ficou para trás e
      // "Tentar novamente" reenviaria a versão velha para sempre. Sincroniza
      // antes de oferecer o cartão.
      try {
        const current = await api<State>('/api/projects?id=' + p.id);
        if (current.version !== p.version) accept(current);
      } catch {}
      // Uma única superfície de erro para o turno: o cartão com "Tentar
      // novamente". O aviso global fica para as ações de painel.
      setFailedTurn({ text: message, image: sentImage, error: friendlyError(e), requestId });
      if (draftDuringWait.current) {
        setText(draftDuringWait.current);
      } else if (!retry) {
        setText(message);
      }
      if (sentImage) setAttachment(sentImage);
    } finally {
      setPending('');
      setPendingImage(null);
      setProgress([]);
      setLiveText(null);
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
        accept(updated);
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
  const selectedNames = selected.map((id) => p?.parts.find((v) => v.id === id)?.name ?? p?.params.modules.find(m=>m.id===id)?.name ?? (p ? generateDesign(p.params).cells.find(c=>c.id===id)?.label : null) ?? id);
  const sheetRows = groupParts(p?.parts ?? []);
  const areaM2 = sheetRows
    .reduce((total, row) => total + row.area, 0)
    .toFixed(2)
    .replace('.', ',');
  const targetPart=p?.parts.find(part=>part.id===selected[0]);
  const targetCell=p?generateDesign(p.params).cells.find(c=>c.id===selected[0]||c.id===targetPart?.cellId):undefined;
  const suggestions=selected.length>1?['Descreva os itens selecionados','Abra as frentes selecionadas']
    :targetCell?.node.front||targetPart?.kind==='door'||targetPart?.kind==='drawer'?['Abra esta frente','Feche esta frente','Troque esta frente para grafite']
    :p?.params.modules.some(m=>m.id===selected[0])?['Duplique este módulo','Gire este módulo em 90 graus','Mude este módulo para branco']
    :targetCell&&!targetCell.node.split?['Divida este compartimento em duas colunas','Coloque duas portas neste compartimento','Coloque três gavetas neste compartimento']
    :selected.length?['Distribua as divisões deste compartimento','Deixe 400 mm livres antes desta divisória']
    :['Adicione um nicho à direita','Crie um gaveteiro de 80 × 90 × 45 cm','Descreva os módulos do projeto'];
  return (
    <main className="studio">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <Box size={22} />
          </span>
          merce<span className="brand-dot">.</span>
        </Link>
        <span className="divider" />
        <span className="workspace-label">Estúdio de móveis</span>
        <ProjectPicker
          projects={projects}
          current={p?.id}
          disabled={busy}
          onSelect={(id) => void openProject(id)}
          onDelete={removeProject}
        />
        <span className="saved">
          <Check size={14} /> Salvo neste computador
        </span>
        <Button
          variant="ghost"
          onClick={() => action('create')}
          disabled={busy}
        >
          <Plus />
          Novo
        </Button>
        <div className="export-wrap" ref={exportWrap}>
          <Button
            className="export-button"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen(!exportOpen)}
            disabled={!p}
          >
            <Download />
            Exportar
          </Button>
          {exportOpen && p && (
            <div className="export-menu">
              <button
                onClick={() => {
                  setExportOpen(false);
                  download(
                    'merce-pecas.csv',
                    cutCSV(p.params),
                    'text/csv;charset=utf-8',
                  );
                }}
              >
                Lista de peças · CSV
              </button>
              <button
                onClick={() => {
                  setExportOpen(false);
                  download(
                    'merce-cortecloud.json',
                    JSON.stringify(cortecloud(p.params), null, 2),
                  );
                }}
              >
                Cortecloud · JSON
              </button>
              <button
                onClick={() => {
                  setExportOpen(false);
                  download(
                    'merce-projeto.json',
                    JSON.stringify(
                      { ...p, schemaVersion: 3, params:canonical(p.params), revisions:p.revisions.map(r=>({...r,params:canonical(r.params)})) },
                      null,
                      2,
                    ),
                  );
                }}
              >
                Projeto completo · JSON
              </button>
              <button
                onClick={() => {
                  setExportOpen(false);
                  window.print();
                }}
              >
                Desenho e peças · Imprimir / PDF
              </button>
              <small>
                Arquivo Cortecloud experimental. Confira materiais e bordas na
                importação. Não inclui ferragens, furação, instruções de montagem ou certificação de estabilidade.
              </small>
            </div>
          )}
        </div>
      </header>
      <div className="workbench">
        <aside className="chat-panel">
          <div className="panel-title">
            <span>
              <Sparkles size={18} />
              Seu projeto começa aqui
            </span>
            <span className="live-dot" />
          </div>
          <div className="chat-messages" ref={messages} onScroll={onScroll}>
            <div className="intro">
              <span className="eyebrow">DA IDEIA ÀS PEÇAS</span>
              <h1>
                Vamos dar forma
                <br />à sua ideia.
              </h1>
              <p>Converse, ajuste e veja sua estante ganhar forma.</p>
            </div>
            {p?.messages.map((m, i) => {
              const rev = revisionState(m);
              const clar = m.clarification;
              return (
              <div className={'message ' + m.role} key={m.id ?? i}>
                {m.role === 'assistant' && (
                  <span className="avatar">
                    <Sparkles size={14} />
                  </span>
                )}
                <div>
                  {m.image && <img className="chat-image" src={m.image.url} alt={m.image.name} loading="lazy" />}
                  {m.content}
                  {m.error && <div className="turn-error" role="alert">{m.error}</div>}
                  {clar && !m.result && (
                    <div className="clarify-card">
                      <p>{clar.question}</p>
                      <div>
                        {clar.options.map((o) => {
                          const alive = o.partIds.some((pid) => p?.parts.some((v) => v.id === pid));
                          return (
                          <button
                            key={o.id}
                            type="button"
                            disabled={busy || !alive}
                            title={alive ? o.label : 'Peça não existe mais nesta versão'}
                            onClick={() => void send(m.content, { clarificationId: clar.id, optionId: o.id })}
                          >
                            {o.label}
                          </button>
                          );
                        })}
                      </div>
                      <small>As opções são revalidadas antes de aplicar.</small>
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
                            onClick={() => {
                              if (alive) toggleSelected(s.id);
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
                  {m.report && (
                    <details className="change-report">
                      <summary>
                        {m.report.outcome === 'applied'
                          ? 'Alterações aplicadas'
                          : m.report.outcome === 'clarification'
                            ? 'Aguardando sua resposta'
                            : m.report.outcome === 'rejected'
                              ? 'Projeto preservado'
                              : m.report.outcome === 'highlighted'
                                ? 'Peças destacadas'
                                : m.report.outcome === 'answered'
                                  ? 'Resposta'
                                  : 'Sem alteração nas medidas'}{' '}
                        · {rev.status === 'found' ? `v${rev.revision.number}` : rev.status === 'dropped' ? 'versão descartada' : 'sem versão'} · {(m.report.durationMs / 1000).toFixed(1)}s
                      </summary>
                      {m.report.approach && (
                        <div className="saved-approach">
                          <strong>Abordagem proposta pela IA</strong>
                          <p>{m.report.approach}</p>
                        </div>
                      )}
                      {m.report.changes.length > 0 ? (
                        <ul>
                          {m.report.changes.map((change) => (
                            <li key={change}>{change}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>Nenhuma medida foi alterada.</p>
                      )}
                    </details>
                  )}
                  {m.role === 'assistant' && rev.status === 'found' && (
                    <button
                      type="button"
                      className="link-button view-rev"
                      disabled={busy}
                      onClick={() => seekVersion(rev.cursor)}
                    >
                      Ver versão {rev.revision.number}
                    </button>
                  )}
                  {m.role === 'assistant' && rev.status === 'dropped' && (
                    <small className="view-rev dropped">Versão original descartada neste caminho.</small>
                  )}
                </div>
              </div>
              );
            })}
            {!p && !error && <p>Carregando seu estúdio…</p>}
            {pending && (
              <>
                <div className="message user">
                  <div>{pendingImage && <img className="chat-image" src={pendingImage.url} alt={pendingImage.name} />}{pending}</div>
                </div>
                <ChatProgress events={progress} started={started} />
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
                        Recebendo do provedor. O raciocínio não é exibido; o
                        texto aparece quando os campos públicos chegam.
                        <span className="text-caret" />
                      </p>
                    )}
                    <small>
                      Texto parcial da IA, ainda não validado nem salvo. Só a
                      resposta final cria revisão.
                    </small>
                  </div>
                )}
              </>
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
            {newMessageFlag && (
              <button
                type="button"
                className="new-message-jump"
                onClick={() => {
                  setPinnedToBottom(true);
                  setNewMessageFlag(false);
                  const el = messages.current;
                  if (el) el.scrollTop = el.scrollHeight;
                }}
              >
                Nova mensagem <ArrowUp size={12} />
              </button>
            )}
            {p && (
              <div className="suggestions">
                {suggestions.map((v) => (
                  <button
                    key={v}
                    disabled={busy}
                    title="Escreve no campo abaixo; revise e envie"
                    onClick={() => {
                      setText(v);
                      composer.current?.focus();
                    }}
                  >
                    {v}
                    <ArrowUp size={14} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="composer-wrap">
            {viewNotice&&<output className="opening-notice">{viewNotice}</output>}
            {selected.length > 0 && (
              <div className="selection-chip">
                {selected.length === 1
                  ? `Selecionado: ${selectedNames[0]}`
                  : `${selected.length} peças selecionadas: ${selectedNames.join(', ')}`}
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
              {uploading && <output className="upload-status">Preparando imagem…</output>}
              <textarea
                ref={composer}
                aria-label="Mensagem para o assistente"
                placeholder="Descreva seu móvel ou uma alteração…"
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
                    void send();
                  }
                }}
              />
              <div>
                <Button type="button" variant="ghost" size="icon" disabled={busy || !p} title="Anexar imagem (JPG, PNG ou WebP, até 10 MB)" aria-label="Anexar imagem" onClick={() => fileInput.current?.click()}><ImagePlus /></Button>
                <button
                  type="button"
                  className={'fast-toggle' + (fast ? ' on' : '')}
                  disabled={busy}
                  aria-pressed={fast}
                  title={fast ? 'Modo rápido ativado (Qwen 3.8 27B via Cerebras)' : 'Ativar modo rápido (Qwen 3.8 27B via Cerebras)'}
                  onClick={() => setFast((v) => !v)}
                >
                  <Zap size={14} />
                  Rápido
                </button>
                <button
                  type="button"
                  className={'fast-toggle' + (live ? ' on' : '')}
                  aria-pressed={live}
                  title={
                    live
                      ? 'Transmissão em tempo real ativa (depuração): o texto parcial da IA aparece enquanto chega, sem esperar a validação'
                      : 'Depuração: mostrar o texto parcial da IA em tempo real, antes da validação'
                  }
                  onClick={toggleLive}
                >
                  <Bug size={14} />
                  Ao vivo
                </button>
                <span>Imagem ou texto · Enter para enviar</span>
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Enviar mensagem"
                  disabled={busy || !p || (!text.trim() && !attachment)}
                >
                  <ArrowUp />
                </Button>
              </div>
            </form>
            <div className="model-label">
              <span className={online ? 'live-dot' : 'offline-dot'} />
              {fast ? 'Qwen 3.8 27B' : 'DeepSeek V4.1 Flash'} <span>{fast ? 'via Cerebras · modo rápido' : 'via Command Code · esforço baixo'}</span>
            </div>
          </div>
        </aside>
        <section className="viewport">
          <div className="viewport-heading">
            <div>
              <span className="eyebrow">COMPOSIÇÃO MODULAR</span>
              <h2>{p?.name || 'Minha estante'}</h2>
            </div>
            <span className="revision">Versão {p ? (historyPreview ?? p.cursor) + 1 : 1}{historyPreview !== null && p && historyPreview !== p.cursor ? ' · Prévia' : ''}{p && historyPreview === null && p.cursor < p.revisions.length - 1 ? ` · Editando a versão ${p.cursor + 1} (${p.revisions.length} salvas)` : ''}</span>
          </div>
          {p && (
            <FurnitureView
              params={visualParams!}
              parts={displayParts}
              scrub={scrubbing}
              dims={false}
              selected={displaySelected}
              onSelect={(id) => (id === null ? setSelected([]) : toggleSelected(id))}
              exploded={exploded}
              view={view}
              spin={spin}
            />
          )}
          <div className="scene-bottom">
            <div className="viewport-controls">
              <span className="control-label">Vista</span>
              <div className="control-buttons">
                <button
                  className={view === 'perspective' ? 'active' : ''}
                  onClick={() => setView('perspective')}
                >
                  <Box size={16} />
                  Perspectiva
                </button>
                <button
                  className={view === 'front' ? 'active' : ''}
                  onClick={() => setView('front')}
                >
                  <Square size={16} />
                  Frontal
                </button>
                <button
                  className={view === 'side' ? 'active' : ''}
                  onClick={() => setView('side')}
                >
                  <FlipHorizontal2 size={16} />
                  Lateral
                </button>
                <button
                  className={view === 'top' ? 'active' : ''}
                  onClick={() => setView('top')}
                >
                  <ArrowDown size={16} />
                  Topo
                </button>
                <button
                  className={exploded ? 'active' : ''}
                  onClick={() => setExploded(!exploded)}
                >
                  <Layers size={16} />
                  Explodir
                </button>
                <button
                  className={spin ? 'rotating' : ''}
                  aria-pressed={spin}
                  title={
                    spin
                      ? 'Girar o modelo: ativo. Clique para parar.'
                      : 'Girar o modelo continuamente'
                  }
                  onClick={() => setSpin(!spin)}
                >
                  <Orbit size={16} />
                  Girar
                </button>
              </div>
            </div>
            <div className="control-divider" />
            {p && <div className="history-timeline">
              <span className="control-label">Histórico</span>
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
                      min={0}
                      max={historyMax}
                      step={1}
                      value={[historyView]}
                      disabled={busy || historyCount < 2}
                      onValueChange={(value) => {
                        const v = Array.isArray(value) ? value[0] : value;
                        setScrubbing(true);
                        queuePreview(v);
                      }}
                      onValueCommitted={(value) => {
                        setScrubbing(false);
                        cancelPreview();
                        if (scrubCancelled.current) {
                          scrubCancelled.current = false;
                          setHistoryPreview(null);
                          return;
                        }
                        seekVersion(Array.isArray(value) ? value[0] : value);
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
                disabled={busy || !p || p.cursor === 0}
                onClick={() => action('undo')}
              >
                <Undo2 />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Refazer"
                disabled={busy || !p || p.cursor === p.revisions.length - 1}
                onClick={() => action('redo')}
              >
                <Redo2 />
              </Button>
            </div>
          </div>
          {p && (
            <div className="dimension-summary">
              <span className={changed.has('width') ? 'changed' : ''}>
                {cm(visualParams!.width)}
                <small>largura</small>
              </span>
              <b>×</b>
              <span className={changed.has('height') ? 'changed' : ''}>
                {cm(visualParams!.height)}
                <small>altura</small>
              </span>
              <b>×</b>
              <span className={changed.has('depth') ? 'changed' : ''}>
                {cm(visualParams!.depth)}
                <small>profundidade</small>
              </span>
              <i>cm</i>
            </div>
          )}
        </section>
        <aside className="inspector">
          <nav>
            {[
              ['params', 'Ajustes'],
              ['parts', 'Peças'],
              ['history', 'Histórico'],
            ].map(([id, label]) => (
              <button
                className={tab === id ? 'active' : ''}
                onClick={() => setTab(id)}
                key={id}
              >
                {label}
              </button>
            ))}
          </nav>
          {p && (
            <div className="inspector-content">
              {tab === 'params' && <><ModularEditor design={visualParams!} selected={selected} onSelect={setSelected} onOp={op} busy={busy||historyPreview!==null} onOpen={toggleOpening} opened={opened}/><label className="wide-field">Nome do projeto<input key={p.id+p.name} defaultValue={p.name} maxLength={80} disabled={busy} onBlur={e=>{if(e.target.value.trim()&&e.target.value!==p.name)void action('rename',{name:e.target.value.trim()});}}/></label></>}
              {tab === 'parts' && p && (
                <>
                  <div className="section-label">
                    PEÇAS{selected.length > 0 ? ` · ${selected.length} selecionada${selected.length > 1 ? 's' : ''}` : ''}
                    {selected.length > 0 && (
                      <button type="button" className="link-button" onClick={() => setSelected([])}>
                        limpar
                      </button>
                    )}
                  </div>
                  {p.params.modules.length===1 && p.params.modules[0].legacyIds ? (
                    <ShelfPanel />
                  ) : (
                    <p className="shelf-hint">
                      As ferramentas de prateleira desta versão valem para a
                      estante única original. Neste projeto, use os comandos do
                      compartimento em Ajustes: Dividir ↕ cria uma prateleira e
                      Distribuir iguala os vãos.
                    </p>
                  )}
                  {p.parts.map((v) => (
                    <button
                      className={
                        'part-row ' + (selected.includes(v.id) ? 'selected' : '')
                      }
                      key={v.id}
                      onClick={() => toggleSelected(v.id)}
                    >
                      <span>
                        <strong>{v.name}</strong>
                        <small>{v.material}</small>
                      </span>
                      <code>
                        {mm(v.c)} × {mm(v.l)} × {mm(v.thickness)}
                      </code>
                    </button>
                  ))}
                  <p className="warning">
                    Medidas nominais. O CSV não é um plano de aproveitamento de
                    chapas. A exportação Cortecloud lista peças; posições de montagem e furação não estão incluídas.
                  </p>
                </>
              )}
              {tab === 'history' && (
                <>
                  <div className="section-label">VERSÕES SALVAS</div>
                  {p.revisions.map((r, i) => (
                    <button
                      disabled={busy}
                      onClick={() => seekVersion(i)}
                      className={
                        'history-row ' + (i === p.cursor ? 'current' : '')
                      }
                      key={i}
                    >
                      <span>{i + 1}</span>
                      <div>
                        <strong>{r.label}</strong>
                        <small>{new Date(r.at).toLocaleString('pt-BR')}</small>
                        {i === p.cursor && <em>Versão atual</em>}
                        {(historyPreview ?? p.cursor) === i && historyPreview !== null && historyPreview !== p.cursor && <em>Prévia exibida</em>}
                      </div>
                    </button>
                  ))}
                  {p.origin && (
                    <p className="warning">
                      Alternativa criada da versão {p.origin.revision}. Original preservado.
                    </p>
                  )}
                  <div className="fork-box">
                    <div className="section-label">CRIAR ALTERNATIVA</div>
                    <p className="shelf-hint">
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
                  <p className="warning">
                    Arraste o slider ou clique numa versão para voltar. Uma nova edição
                    substitui o caminho desfeito.
                  </p>
                </>
              )}
            </div>
          )}
        </aside>
      </div>
      {p && (
        <section className="print-sheet">
          <h1>{p.name}</h1>
          <p>
            Composição modular · {p.params.width} × {p.params.height} ×{' '}
            {p.params.depth} mm · Versão {p.cursor + 1}
          </p>
          <p>Vista superior, frentes fechadas.</p>
          <svg viewBox={`${generateDesign(p.params).bounds.min[0]-30} ${generateDesign(p.params).bounds.min[2]-30} ${p.params.width+60} ${p.params.depth+60}`} width="600" height="300">
            {p.parts.map(part=><rect key={part.id} x={-part.size[0]/2} y={-part.size[2]/2} width={part.size[0]} height={part.size[2]} transform={`translate(${part.position[0]},${part.position[2]}) rotate(${-(part.rotation??0)*180/Math.PI})`} fill="white" stroke="black" strokeWidth={2}/>) }
          </svg>
          <table>
            <thead>
              <tr>
                <th>Peça</th>
                <th>Quantidade</th>
                <th>C × L × E (mm)</th>
                <th>Material</th>
              </tr>
            </thead>
            <tbody>
              {sheetRows.map((row) => (
                <tr key={row.key}>
                  <td>
                    {row.name}
                    {row.duplicates > 1 && (
                      <small className="sheet-note">{row.duplicates} posições</small>
                    )}
                  </td>
                  <td>{row.count}</td>
                  <td>
                    {mm(row.c)} × {mm(row.l)} × {mm(row.thickness)}
                  </td>
                  <td>{row.material}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{sheetRows.length} itens distintos</th>
                <th>{p.parts.length} peças</th>
                <th>{areaM2} m² de chapa</th>
                <th>Revisão {p.cursor + 1}</th>
              </tr>
            </tfoot>
          </table>
          <p>
            Desenho de revisão. Sem furação ou fixações. Conferir medidas,
            materiais, bordas e estabilidade antes de produzir.
          </p>
        </section>
      )}
    </main>
  );
}
