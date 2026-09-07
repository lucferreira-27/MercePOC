/* oxlint-disable react/react-compiler -- Analyzer internal invariant on Base UI callbacks; React Compiler is not enabled. */
'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Box,
  Check,
  ChevronDown,
  Download,
  Layers,
  Plus,
  Redo2,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { useProjectTools } from '@/hooks/use-project-tools';
import { Button } from '@/components/ui/button';
import FurnitureView from '@/components/furniture-view';
import {
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
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [exploded, setExploded] = useState(false),
    [front, setFront] = useState(false),
    [tab, setTab] = useState('params'),
    [exportOpen, setExportOpen] = useState(false),
    [draft, setDraft] = useState<Params | null>(null),
    [online, setOnline] = useState(false);
  const messages = useRef<HTMLDivElement>(null);
  const accept = (d: State) => {
    setP(d);
    setDraft(d.params);
    setSelected((s) => (d.parts.some((v) => v.id === s) ? s : null));
  };
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
            : await api('/api/projects', { action: 'create' }),
        );
        await refresh();
        const h = await api<{ configured: boolean }>('/api/health');
        setOnline(h.configured);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);
  useEffect(() => {
    messages.current?.scrollTo({
      top: messages.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [p?.messages.length, pending]);
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
    }
  }
  async function send(value = text) {
    if (!value.trim() || !p || busy) return;
    setBusy(true);
    setError('');
    setPending(value);
    setText('');
    try {
      accept(
        await api('/api/chat', {
          id: p.id,
          version: p.version,
          message: value,
          selected,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
      setText(value);
    } finally {
      setPending('');
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
  const part = p?.parts.find((v) => v.id === selected);
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
                <div>{m.content}</div>
              </div>
            ))}
            {!p && !error && <p>Carregando seu estúdio…</p>}
            {pending && (
              <>
                <div className="message user">
                  <div>{pending}</div>
                </div>
                <div className="thinking">
                  <span />
                  Ajustando seu projeto…
                </div>
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
            {selected && (
              <div className="selection-chip">
                Selecionado: {part?.name}
                <button
                  aria-label="Limpar seleção"
                  onClick={() => setSelected(null)}
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
              <textarea
                aria-label="Mensagem para o assistente"
                placeholder="Descreva seu móvel ou uma alteração…"
                value={text}
                maxLength={4000}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div>
                <span>Enter para enviar</span>
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Enviar mensagem"
                  disabled={busy || !p || !text.trim()}
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
            <span className="revision">Versão {p ? p.cursor + 1 : 1}</span>
          </div>
          {p && (
            <FurnitureView
              params={p.params}
              parts={p.parts}
              selected={selected}
              onSelect={setSelected}
              exploded={exploded}
              front={front}
            />
          )}
          <div className="scene-toolbar">
            <button
              className={!front ? 'active' : ''}
              onClick={() => setFront(false)}
            >
              <Box size={16} />
              Perspectiva
            </button>
            <button
              className={front ? 'active' : ''}
              onClick={() => setFront(true)}
            >
              Frontal
            </button>
            <span />
            <button
              className={exploded ? 'active' : ''}
              onClick={() => setExploded(!exploded)}
            >
              <Layers size={16} />
              Explodir
            </button>
          </div>
          <div className="scene-bottom">
            <span>
              Arraste para girar · Role para aproximar · Clique em uma peça
            </span>
            <div>
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
              <span>
                {p.params.width / 10}
                <small>largura</small>
              </span>
              <b>×</b>
              <span>
                {p.params.height / 10}
                <small>altura</small>
              </span>
              <b>×</b>
              <span>
                {p.params.depth / 10}
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
                    {p.parts.length} PEÇAS <span>C × L × E · mm</span>
                  </div>
                  {p.parts.map((v) => (
                    <button
                      className={
                        'part-row ' + (selected === v.id ? 'selected' : '')
                      }
                      key={v.id}
                      onClick={() =>
                        setSelected(selected === v.id ? null : v.id)
                      }
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
                    <div
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
                    </div>
                  ))}
                  <p className="warning">
                    Use desfazer e refazer para navegar. Uma nova edição
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
