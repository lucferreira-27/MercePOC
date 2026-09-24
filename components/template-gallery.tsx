'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftToLine, ArrowRightToLine, FilePlus2, Search, X } from 'lucide-react';
import { buildTemplate, templates } from '@/lib/templates';
import { CATEGORY_LABEL, type AssetCategory } from '@/lib/assets';
import { drawingParts } from '@/lib/composition';
import { PlanThumb } from './plan-thumb';

type Filter = 'all' | AssetCategory;
const FILTERS: Filter[] = ['all', 'sala', 'quarto', 'cozinha', 'escritorio', 'servico'];
const cm = (mm: number) => String(Math.round(mm / 10));
const norm = (v: string) => v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * Biblioteca de móveis. Em `new`, cada ativo abre um projeto novo (em branco
 * continua possível); em `add`, o ativo entra no projeto atual, encostado à
 * esquerda ou à direita do que já existe. A miniatura é o desenho do ativo
 * montado pelo motor, não uma ilustração: o que aparece aqui é o que entra.
 */
export function TemplateGallery({
  open,
  busy,
  mode = 'new',
  onClose,
  onBlank,
  onPick,
  onAdd,
}: {
  open: boolean;
  busy: boolean;
  mode?: 'new' | 'add';
  onClose: () => void;
  onBlank: () => void;
  onPick: (id: string) => void;
  onAdd?: (id: string, placement: 'left' | 'right') => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const previews = useMemo(
    () =>
      open
        ? templates.map((t) => {
            try {
              return { t, parts: drawingParts(buildTemplate(t)) };
            } catch {
              return { t, parts: [] };
            }
          })
        : [],
    [open],
  );
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const q = norm(query.trim());
  const shown = previews.filter(
    ({ t }) =>
      (filter === 'all' || t.category === filter) &&
      (!q || norm([t.name, t.summary, ...t.asset.keywords].join(' ')).includes(q)),
  );
  const count = (f: Filter) => (f === 'all' ? templates.length : templates.filter((t) => t.category === f).length);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <dialog open className="modal gallery" aria-modal="true" aria-labelledby="gallery-title">
        <header className="modal-head">
          <div>
            <span className="eyebrow">{mode === 'add' ? 'Biblioteca de móveis' : 'Novo projeto'}</span>
            <h2 id="gallery-title">{mode === 'add' ? 'Adicionar ao projeto' : 'Por onde começar?'}</h2>
            <p>
              {mode === 'add'
                ? 'O móvel entra encostado ao que já existe, alinhado pela parede. Depois ajuste pela conversa ou pelo painel.'
                : 'Escolha um móvel pronto e ajuste pela conversa, ou comece do zero.'}
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="gallery-tools">
          <fieldset className="gallery-filters" aria-label="Categoria">
            {FILTERS.map((f) => (
              <button
                type="button"
                key={f}
                className={filter === f ? 'active' : ''}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'Todos' : CATEGORY_LABEL[f]}
                <small>{count(f)}</small>
              </button>
            ))}
          </fieldset>
          <label className="gallery-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Rack, cômoda, cozinha…"
              aria-label="Buscar na biblioteca"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="gallery-grid">
          {mode === 'new' && filter === 'all' && !q && (
            <button type="button" className="gallery-card blank" disabled={busy} onClick={onBlank}>
              <span className="gallery-art">
                <FilePlus2 size={30} strokeWidth={1.4} />
              </span>
              <strong>Em branco</strong>
              <small>Uma estante simples de 80 × 180 cm para começar do jeito que quiser</small>
            </button>
          )}
          {shown.map(({ t, parts }) => {
            const s = t.asset.size.default;
            const body = (
              <>
                <span className="gallery-art">
                  <PlanThumb parts={parts} width={260} height={170} />
                </span>
                <strong>{t.name}</strong>
                <small>{t.summary}</small>
                <span className="gallery-meta">
                  <em className="tag">{cm(s.width)} × {cm(s.height)} × {cm(s.depth)} cm</em>
                  {t.asset.feet ? <em className="tag">pés</em> : null}
                  {mode === 'new' && t.room ? <em className="tag">com ambiente</em> : null}
                </span>
              </>
            );
            return mode === 'add' ? (
              <div className="gallery-card add" key={t.id}>
                {body}
                <span className="gallery-actions">
                  <button type="button" disabled={busy} onClick={() => onAdd?.(t.id, 'left')} title="Encostar à esquerda do projeto">
                    <ArrowLeftToLine size={14} /> Esquerda
                  </button>
                  <button type="button" className="primary" disabled={busy} onClick={() => onAdd?.(t.id, 'right')} title="Encostar à direita do projeto">
                    Direita <ArrowRightToLine size={14} />
                  </button>
                </span>
              </div>
            ) : (
              <button type="button" className="gallery-card" key={t.id} disabled={busy} onClick={() => onPick(t.id)}>
                {body}
              </button>
            );
          })}
          {!shown.length && <p className="gallery-empty">Nada com “{query}”. Descreva na conversa e eu monto do zero.</p>}
        </div>
      </dialog>
    </div>
  );
}
