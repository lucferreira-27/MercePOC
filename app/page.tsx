/* oxlint-disable react/react-compiler -- Analyzer internal invariant on Base UI callbacks; React Compiler is not enabled. */
/* oxlint-disable next/no-img-element -- Uploaded references are local, normalized WebP assets. */
'use client';
import Link from 'next/link';
import { ChatProgress } from '@/components/chat-progress';
import { readEvents } from '@/lib/sse';
import { describeChanges, type Progress } from '@/lib/progress';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Box,
  Check,
  ChevronDown,
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
} from 'lucide-react';
import { useProjectTools } from '@/hooks/use-project-tools';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import type { ImageRef } from '@/lib/images';
import FurnitureView, { type ViewMode } from '@/components/furniture-view';
import {
  generate,
  materials,
  cutCSV,
  cortecloud,
  type Params,
  type Part,
  paramsSchema,
} from '@/lib/furniture';
import type { Project } from '@/lib/store';
type State = Project & {
  params: Params;
  parts: Part[];
  openings: number[];
  warnings: string[];
  area: number;
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
export default function Home() {
  const [p, setP] = useState<State | null>(null),
    [projects, setProjects] = useState<{ id: string; name: string }[]>([]),
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
    [draft, setDraft] = useState<Params | null>(null),
    [online, setOnline] = useState(false);
  const [attachment, setAttachment] = useState<ImageRef | null>(null);
  const [pendingImage, setPendingImage] = useState<ImageRef | null>(null);
  const [uploading, setUploading] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
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
        (Object.keys(p?.revisions[p.cursor].params ?? {}) as (keyof Params)[]).filter(
          (key) => p && visualParams && p.revisions[p.cursor].params[key] !== visualParams[key],
        ),
      ),
    [p, visualParams],
  );
  const visualParts = useMemo(() => visualParams ? generate(visualParams).parts : [], [visualParams]);
  const historyCount = p?.revisions.length ?? 0;
  const historyMax = Math.max(1, historyCount - 1);
  const historyView = historyPreview ?? p?.cursor ?? 0;
  const messages = useRef<HTMLDivElement>(null);
  const accept = (d: State) => {
    setP(d);
    setHistoryPreview(null);
    setDraft(d.params);
    setSelected((s) => s.filter((id) => d.parts.some((v) => v.id === id)));
  };
  const toggleSelected = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((v) => v !== id) : [...s, id]));
  const refresh = async () =>
    setProjects(await api<{ id: string; name: string }[]>('/api/projects'));
  useEffect(() => {
    void (async () => {
      try {
        const all = await api<{ id: string; name: string }[]>('/api/projects');
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
        setError((e as Error).message);
      }
    })();
  }, []);
  useEffect(() => cancelPreview, []);
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
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setHistoryPreview(null);
    }
  }
  async function upload(file?: File) {
    if (!file || busy) return;
    setBusy(true); setUploading(true); setError('');
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('A imagem deve ter até 10 MB.');
      const body = new FormData(); body.append('image', file);
      const response = await fetch('/api/images', { method: 'POST', body });
      const result = await response.json() as ImageRef & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível anexar a imagem.');
      setAttachment(result);
    } catch (e) { setError((e as Error).message); }
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
  async function send(value = text) {
    if ((!value.trim() && !attachment) || !p || busy) return;
    const sentImage = attachment;
    value = value.trim() || 'Use esta imagem como referência para a estante.';
    setPendingImage(sentImage);
    setAttachment(null);
    setBusy(true);
    setError('');
    setPending(value);
    setProgress([]);
    setStarted(Date.now());
    setText('');
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'X-Chat-Preview': 'hidden',
        },
        body: JSON.stringify({
          id: p.id,
          version: p.version,
          message: value,
          imageId: sentImage?.id,
          selected,
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
        } else if (event === 'done') {
          accept(JSON.parse(data) as State);
          completed = true;
        } else if (event === 'error')
          throw new Error((JSON.parse(data) as { error: string }).error);
      });
      if (!completed)
        throw new Error(
          'A conexão terminou antes da confirmação. Recarregue o projeto para conferir a última versão.',
        );
    } catch (e) {
      setError((e as Error).message);
      setText(value);
      setAttachment(sentImage);
    } finally {
      setPending('');
      setPendingImage(null);
      setProgress([]);
      setBusy(false);
    }
  }
  useProjectTools(
    () =>
      p
        ? { id: p.id, version: p.version, params: p.params, parts: p.parts }
        : null,
    async (input) => {
      if (!p || busy) throw new Error('Aguarde o projeto.');
      const changes = paramsSchema.partial().parse(input);
      if (!Object.keys(changes).length)
        throw new Error('Informe um parâmetro.');
      setBusy(true);
      try {
        const updated = await api('/api/projects', {
          id: p.id,
          version: p.version,
          action: 'update',
          changes,
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
  const selectedNames = selected.map((id) => p?.parts.find((v) => v.id === id)?.name ?? id);
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
        <div className="project-picker">
          <select
            aria-label="Projeto atual"
            value={p?.id || ''}
            disabled={busy}
            onChange={async (e) => {
              setBusy(true);
              try {
                accept(await api('/api/projects?id=' + e.target.value));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {projects.map((v) => (
              <option value={v.id} key={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
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
        <div className="export-wrap">
          <Button
            className="export-button"
            onClick={() => setExportOpen(!exportOpen)}
            disabled={!p}
          >
            <Download />
            Exportar
          </Button>
          {exportOpen && p && (
            <div className="export-menu">
              <button
                onClick={() =>
                  download(
                    'merce-pecas.csv',
                    cutCSV(p.params),
                    'text/csv;charset=utf-8',
                  )
                }
              >
                Lista de peças · CSV
              </button>
              <button
                onClick={() =>
                  download(
                    'merce-cortecloud.json',
                    JSON.stringify(cortecloud(p.params), null, 2),
                  )
                }
              >
                Cortecloud · JSON
              </button>
              <button
                onClick={() =>
                  download(
                    'merce-projeto.json',
                    JSON.stringify(
                      { schemaVersion: 1, template: 'open_bookcase_v1', ...p },
                      null,
                      2,
                    ),
                  )
                }
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
                importação.
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
          <div className="chat-messages" ref={messages}>
            <div className="intro">
              <span className="eyebrow">DA IDEIA ÀS PEÇAS</span>
              <h1>
                Vamos dar forma
                <br />à sua ideia.
              </h1>
              <p>Converse, ajuste e veja sua estante ganhar forma.</p>
            </div>
            {p?.messages.map((m, i) => (
              <div className={'message ' + m.role} key={i}>
                {m.role === 'assistant' && (
                  <span className="avatar">
                    <Sparkles size={14} />
                  </span>
                )}
                <div>
                  {m.image && <img className="chat-image" src={m.image.url} alt={m.image.name} loading="lazy" />}
                  {m.content}
                  {m.report && (
                    <details className="change-report">
                      <summary>
                        {m.report.outcome === 'updated'
                          ? 'Alterações aplicadas'
                          : m.report.outcome === 'clarification'
                            ? 'Aguardando sua resposta'
                            : m.report.outcome === 'rejected'
                              ? 'Projeto preservado'
                              : 'Sem alteração nas medidas'}{' '}
                        · {(m.report.durationMs / 1000).toFixed(1)}s
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
                </div>
              </div>
            ))}
            {!p && !error && <p>Carregando seu estúdio…</p>}
            {pending && (
              <>
                <div className="message user">
                  <div>{pendingImage && <img className="chat-image" src={pendingImage.url} alt={pendingImage.name} />}{pending}</div>
                </div>
                <ChatProgress events={progress} started={started} />
              </>
            )}
            {p?.messages.length === 1 && (
              <div className="suggestions">
                {[
                  'Quero ela branca',
                  'Aumente a largura para 1 metro',
                  'Deixe o vão de baixo com 45 cm',
                ].map((v) => (
                  <button key={v} disabled={busy} onClick={() => send(v)}>
                    {v}
                    <ArrowUp size={14} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="composer-wrap">
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
              <div className="error" role="alert">
                {error}
                <button onClick={() => window.location.reload()}>
                  Recarregar projeto
                </button>
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
                <Button type="button" variant="ghost" size="icon" disabled={busy || !p} title="Anexar imagem (JPG, PNG ou WebP, até 10 MB)" aria-label="Anexar imagem" onClick={() => fileInput.current?.click()}><ImagePlus /></Button><span>Imagem ou texto · Enter para enviar</span>
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
              GLM 5.3 Flash <span>via Merge Gateway</span>
            </div>
          </div>
        </aside>
        <section className="viewport">
          <div className="viewport-heading">
            <div>
              <span className="eyebrow">ESTANTE ABERTA</span>
              <h2>{p?.name || 'Minha estante'}</h2>
            </div>
            <span className="revision">Versão {p ? (historyPreview ?? p.cursor) + 1 : 1}{historyPreview !== null && p && historyPreview !== p.cursor ? ' · Prévia' : ''}</span>
          </div>
          {p && (
            <FurnitureView
              params={visualParams!}
              parts={visualParts}
              scrub={scrubbing}
              selected={selected}
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
                  className={spin ? 'active' : ''}
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
                {visualParams!.width / 10}
                <small>largura</small>
              </span>
              <b>×</b>
              <span className={changed.has('height') ? 'changed' : ''}>
                {visualParams!.height / 10}
                <small>altura</small>
              </span>
              <b>×</b>
              <span className={changed.has('depth') ? 'changed' : ''}>
                {visualParams!.depth / 10}
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
          {p && draft && (
            <div className="inspector-content">
              {tab === 'params' && (
                <>
                  <div className="section-label">
                    DIMENSÕES <span>milímetros</span>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action('update', { changes: draft });
                    }}
                  >
                    <div className="fields">
                      {(
                        [
                          ['width', 'Largura', 300, 1200],
                          ['height', 'Altura', 400, 2400],
                          ['depth', 'Profundidade', 200, 600],
                          ['shelfCount', 'Prateleiras', 0, 8],
                        ] as const
                      ).map(([key, label, min, max]) => (
                        <label key={key}>
                          {label}
                          <input
                            type="number"
                            min={min}
                            max={max}
                            step={1}
                            required
                            value={draft[key]}
                            disabled={busy}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                [key]: Number(e.target.value),
                                ...(key === 'shelfCount'
                                  ? { bottomOpening: null }
                                  : {}),
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <label className="wide-field">
                      Vão inferior livre (mm)
                      <input
                        type="number"
                        min="100"
                        max="1500"
                        placeholder="Distribuir igualmente"
                        value={draft.bottomOpening ?? ''}
                        disabled={busy}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            bottomOpening: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                      />
                    </label>
                    <Button
                      type="submit"
                      variant="outline"
                      className="apply"
                      disabled={
                        busy ||
                        JSON.stringify(draft) === JSON.stringify(p.params)
                      }
                    >
                      Aplicar medidas
                    </Button>
                  </form>
                  <div className="section-label">
                    MATERIAL <span>MDF · 18 mm</span>
                  </div>
                  <div className="materials">
                    {materials.map((m) => (
                      <button
                        key={m.id}
                        className={p.params.materialId === m.id ? 'chosen' : ''}
                        disabled={busy}
                        onClick={() =>
                          action('update', { changes: { materialId: m.id } })
                        }
                      >
                        <span style={{ background: m.color }} />
                        {m.name}
                        {p.params.materialId === m.id && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                  <div className="section-label">RESUMO DO PROJETO</div>
                  <div className="stats">
                    <div>
                      <strong>{p.parts.length}</strong>
                      <span>peças</span>
                    </div>
                    <div>
                      <strong>{p.area.toFixed(2).replace('.', ',')}</strong>
                      <span>m² de peças</span>
                    </div>
                  </div>
                  <div className="construction">
                    <strong>Construção do modelo</strong>
                    <p>
                      Laterais inteiras · Fundo sobreposto de 6 mm · Prateleiras
                      com 2 mm de folga lateral total.
                    </p>
                  </div>
                  {p.warnings.map((w) => (
                    <p className="warning" key={w}>
                      {w}
                    </p>
                  ))}
                  <label className="wide-field">
                    Nome do projeto
                    <input
                      key={p.id + p.name}
                      defaultValue={p.name}
                      maxLength={80}
                      disabled={busy}
                      onBlur={(e) => {
                        if (e.target.value.trim() && e.target.value !== p.name)
                          void action('rename', {
                            name: e.target.value.trim(),
                          });
                      }}
                    />
                  </label>
                </>
              )}
              {tab === 'parts' && (
                <>
                  <div className="section-label">
                    PEÇAS{selected.length > 0 ? ` · ${selected.length} selecionada${selected.length > 1 ? 's' : ''}` : ''}
                    {selected.length > 0 && (
                      <button type="button" className="link-button" onClick={() => setSelected([])}>
                        limpar
                      </button>
                    )}
                  </div>
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
                        {v.c} × {v.l} × {v.thickness}
                      </code>
                    </button>
                  ))}
                  <p className="warning">
                    Medidas nominais. O CSV não é um plano de aproveitamento de
                    chapas.
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
                      </div>
                    </button>
                  ))}
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
            Estante aberta · {p.params.width} × {p.params.height} ×{' '}
            {p.params.depth} mm · Versão {p.cursor + 1}
          </p>
          <svg viewBox="0 0 600 500" width="600" height="500">
            <g transform="translate(100,30)">
              <rect
                x="0"
                y="0"
                width={(p.params.width / p.params.height) * 400}
                height="400"
                fill="none"
                stroke="black"
              />
              {p.parts
                .filter((v) => v.id.startsWith('shelf'))
                .map((v) => (
                  <line
                    key={v.id}
                    x1="0"
                    x2={(p.params.width / p.params.height) * 400}
                    y1={400 - (v.position[1] / p.params.height) * 400}
                    y2={400 - (v.position[1] / p.params.height) * 400}
                    stroke="black"
                  />
                ))}
              <text x="0" y="430">
                Largura {p.params.width} mm · Altura {p.params.height} mm
              </text>
            </g>
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
              {p.parts.map((v) => (
                <tr key={v.id}>
                  <td>{v.name}</td>
                  <td>1</td>
                  <td>
                    {v.c} × {v.l} × {v.thickness}
                  </td>
                  <td>{v.material}</td>
                </tr>
              ))}
            </tbody>
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
