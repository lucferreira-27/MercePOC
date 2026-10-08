'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Trash2 } from 'lucide-react';

export type ProjectSummary = {
  id: string;
  name: string;
  updated?: string;
  revisions?: number;
  version?: number;
  modules?: number;
  /** Posição na vitrine, quando é um projeto de demonstração (`npm run demos`). */
  demo?: number;
};

/** Compara ignorando acentos e maiúsculas: "estante" acha "Estante". */
function fold(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Resumo curto do projeto na lista. Dois projetos homônimos só se distinguem
 * pela hora e pelos números, por isso a data vem com hora.
 */
function summarize(v: ProjectSummary) {
  const parts: string[] = [];
  if (v.version) parts.push(`Versão ${v.version}`);
  parts.push(
    `${v.revisions ?? 1} ${v.revisions === 1 ? 'versão salva' : 'versões salvas'}`,
  );
  if (v.modules)
    parts.push(`${v.modules} ${v.modules === 1 ? 'módulo' : 'módulos'}`);
  if (v.updated)
    parts.push(
      new Date(v.updated).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  return parts.join(' · ');
}

/**
 * Busca e lista de projetos, com exclusão por linha. Mora no menu do seletor
 * no desktop e na folha Projeto do app no celular.
 */
export function ProjectList({
  projects,
  current,
  onSelect,
  onDelete,
  autoFocus = false,
  compact = false,
}: {
  projects: ProjectSummary[];
  current?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  autoFocus?: boolean;
  /** Uma linha por projeto (barra lateral): o resumo vai na dica. */
  compact?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const found = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return projects;
    return projects.filter((v) => fold(v.name).includes(needle));
  }, [projects, query]);
  useEffect(() => {
    if (autoFocus) search.current?.focus();
  }, [autoFocus]);
  return (
    <>
      <label className="project-search">
        <Search size={13} />
        <input
          ref={search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar projeto…"
          aria-label="Buscar projeto"
          maxLength={80}
        />
        <small>
          {found.length} de {projects.length}
        </small>
      </label>
      <div className={'project-list' + (compact ? ' compact' : '')} role="listbox" aria-label="Projetos">
        {found.map((v) => (
          <div key={v.id} className={'project-row' + (v.id === current ? ' current' : '')}>
            {confirming === v.id ? (
              <div className="project-confirm">
                <span>Excluir “{v.name}”?</span>
                <button
                  type="button"
                  className="danger"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      await onDelete(v.id);
                      setConfirming(null);
                    } finally {
                      setDeleting(false);
                    }
                  }}
                >
                  Excluir
                </button>
                <button type="button" disabled={deleting} onClick={() => setConfirming(null)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  role="option"
                  aria-selected={v.id === current}
                  className="project-name"
                  title={compact ? `${v.name}\n${summarize(v)}` : undefined}
                  onClick={() => onSelect(v.id)}
                >
                  <strong>{v.name}</strong>
                  {!compact && <small>{summarize(v)}</small>}
                </button>
                <button
                  type="button"
                  className="project-delete"
                  aria-label={`Excluir ${v.name}`}
                  title="Excluir projeto"
                  onClick={() => setConfirming(v.id)}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        ))}
        {!found.length && <p className="project-empty">Nenhum projeto com esse nome.</p>}
      </div>
    </>
  );
}

export function ProjectPicker({
  projects,
  current,
  disabled,
  onSelect,
  onDelete,
}: {
  projects: ProjectSummary[];
  current?: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const active = projects.find((v) => v.id === current);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="project-picker" ref={wrap}>
      <button
        type="button"
        className="project-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Projeto atual"
        title={active?.name}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{active?.name ?? 'Escolha um projeto'}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="project-menu">
          <ProjectList
            projects={projects}
            current={current}
            autoFocus
            onDelete={onDelete}
            onSelect={(id) => {
              setOpen(false);
              if (id !== current) onSelect(id);
            }}
          />
        </div>
      )}
    </div>
  );
}
