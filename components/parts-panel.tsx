'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type { ModularPart } from '@/lib/composition';
import type { CutPlan } from '@/lib/cutplan';
import { edgeSides } from '@/lib/quote';
import { shortName } from './cut-sheet-drawing';

export type PartsGroupBy = 'module' | 'material' | 'kind';

const KIND_LABEL: Record<ModularPart['kind'], string> = {
  side: 'Laterais',
  base: 'Bases',
  top: 'Tampos',
  back: 'Fundos',
  shelf: 'Prateleiras',
  divider: 'Divisórias',
  door: 'Portas',
  drawer: 'Gavetas',
  panel: 'Painéis',
  slab: 'Tampos sobrepostos',
  plinth: 'Rodapés e bases',
  cornice: 'Molduras',
  insert: 'Vidros, telas e palhinha',
};
const KIND_ORDER = Object.keys(KIND_LABEL) as ModularPart['kind'][];

function mm(v: number) {
  return String(Math.round(v * 10) / 10).replace('.', ',');
}
function m2(v: number) {
  return v.toFixed(2).replace('.', ',');
}
const moduleOf = (p: ModularPart) => (p.name.includes(' / ') ? p.name.split(' / ')[0] : 'Peças soltas');
/** Sem acento e sem caixa: "lateral" acha "Lateral", "freijo" acha "Freijó". */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

type Row = { key: string; ids: string[]; part: ModularPart; parts: ModularPart[]; count: number };
type Group = { key: string; label: string; rows: Row[]; parts: ModularPart[] };

/** Preferências da lista, lembradas neste navegador. */
function usePref<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
      return saved ? (JSON.parse(saved) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Sem armazenamento a escolha vale só nesta aba.
    }
  };
  return [value, set] as const;
}

/**
 * Lista de peças para conferir e escolher: busca, grupos (módulo, material ou
 * tipo), peças iguais juntas, fita de borda e o número da peça no plano de
 * corte. Clicar escolhe no móvel; o cabeçalho do grupo escolhe o grupo todo.
 */
export function PartsPanel({
  parts,
  plan,
  selected,
  onToggle,
  onSelectMany,
  onClear,
  edgeMeters,
}: {
  parts: readonly ModularPart[];
  plan: CutPlan;
  selected: readonly string[];
  onToggle: (id: string, extend: boolean) => void;
  onSelectMany: (ids: string[], extend: boolean) => void;
  onClear: () => void;
  edgeMeters: number;
}) {
  const [query, setQuery] = useState('');
  const [groupBy, setGroupBy] = usePref<PartsGroupBy>('merce.parts.group', 'module');
  const [merge, setMerge] = usePref('merce.parts.merge', false);
  const [closed, setClosed] = useState<string[]>([]);
  const cutNumber = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of plan.sheets) for (const p of s.placements) map.set(p.id, p.n);
    return map;
  }, [plan]);
  const area = parts.reduce((a, p) => a + (p.c * p.l) / 1e6, 0);
  const distinct = new Set(parts.map((p) => [shortName(p.name), p.c, p.l, p.thickness, p.material].join('|'))).size;

  const groups = useMemo(() => {
    const q = fold(query.trim());
    const hit = (p: ModularPart) =>
      !q ||
      fold(`${p.name} ${p.material} ${mm(p.c)} × ${mm(p.l)} ${mm(p.c)}x${mm(p.l)} ${KIND_LABEL[p.kind]}`).includes(q) ||
      String(cutNumber.get(p.id)) === q;
    const keyOf = (p: ModularPart) =>
      groupBy === 'module' ? moduleOf(p) : groupBy === 'material' ? p.material : p.kind;
    const out = new Map<string, Group>();
    for (const p of parts) {
      if (!hit(p)) continue;
      const key = keyOf(p);
      let g = out.get(key);
      if (!g) {
        g = { key, label: groupBy === 'kind' ? KIND_LABEL[p.kind] : key, rows: [], parts: [] };
        out.set(key, g);
      }
      g.parts.push(p);
      const same = [shortName(p.name), p.c, p.l, p.thickness, p.material].join('|');
      const row = merge ? g.rows.find((r) => r.key === same) : undefined;
      if (row) {
        row.ids.push(p.id);
        row.parts.push(p);
        row.count += 1;
      } else g.rows.push({ key: merge ? same : p.id, ids: [p.id], part: p, parts: [p], count: 1 });
    }
    const list = [...out.values()];
    if (groupBy === 'kind') list.sort((a, b) => KIND_ORDER.indexOf(a.key as ModularPart['kind']) - KIND_ORDER.indexOf(b.key as ModularPart['kind']));
    if (groupBy === 'material') {
      const order = (k: string) => plan.groups.findIndex((g) => g.key === k);
      list.sort((a, b) => order(a.key) - order(b.key));
    }
    return list;
  }, [parts, query, groupBy, merge, cutNumber, plan]);
  const shown = groups.reduce((a, g) => a + g.parts.length, 0);

  // Peça escolhida na cena: o grupo dela abre e a linha aparece na lista.
  const list = useRef<HTMLDivElement>(null);
  const last = selected.at(-1);
  const [seen, setSeen] = useState(last);
  if (seen !== last) {
    setSeen(last);
    const home = last && groups.find((g) => g.parts.some((p) => p.id === last));
    if (home && closed.includes(home.key)) setClosed(closed.filter((k) => k !== home.key));
  }
  useEffect(() => {
    if (!last) return;
    list.current?.querySelector(`[data-ids~="${CSS.escape(last)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [last]);

  return (
    <div className="parts-panel">
      <div className="parts-stats">
        <span>
          <b>{parts.length}</b> peças
        </span>
        <span>
          <b>{distinct}</b> diferentes
        </span>
        <span>
          <b>{m2(area)}</b> m²
        </span>
        <span>
          <b>{edgeMeters}</b> m de fita
        </span>
      </div>
      <label className="parts-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          placeholder="Buscar peça, material, medida ou nº"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.stopPropagation();
              setQuery('');
            }
          }}
        />
        {query && (
          <button type="button" className="icon-button" aria-label="Limpar busca" onClick={() => setQuery('')}>
            <X size={13} />
          </button>
        )}
      </label>
      <div className="parts-controls">
        <div className="cut-seg" aria-label="Agrupar por">
          {(
            [
              ['module', 'Módulo'],
              ['material', 'Material'],
              ['kind', 'Tipo'],
            ] as const
          ).map(([id, text]) => (
            <button
              key={id}
              type="button"
              aria-pressed={groupBy === id}
              className={groupBy === id ? 'on' : ''}
              onClick={() => {
                setGroupBy(id);
                setClosed([]);
              }}
            >
              {text}
            </button>
          ))}
        </div>
        <label className="switch-row cut-switch" title="Peças com mesmo nome, medida e material numa linha só">
          <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
          <span className="switch" aria-hidden="true" />
          Iguais juntas
        </label>
      </div>
      <div className={'parts-selection' + (selected.length ? ' on' : '')} aria-live="polite">
        {selected.length ? (
          <>
            <span>
              <b>{selected.length}</b> {selected.length === 1 ? 'selecionada' : 'selecionadas'}
            </span>
            <button type="button" className="link-button" onClick={onClear}>
              limpar
            </button>
          </>
        ) : (
          <span>
            {query ? `${shown} de ${parts.length} peças` : 'Clique para escolher no móvel · Shift soma'}
          </span>
        )}
      </div>
      <div className="parts-groups" ref={list}>
        {groups.length === 0 && <p className="hint">Nenhuma peça com “{query}”.</p>}
        {groups.map((g) => {
          const open = !closed.includes(g.key) || !!query;
          const ids = g.parts.map((p) => p.id);
          const picked = ids.filter((id) => selected.includes(id)).length;
          return (
            <section className="parts-group" key={g.key}>
              <header className={picked === ids.length ? 'all' : ''}>
                <button
                  type="button"
                  className="parts-fold"
                  aria-expanded={open}
                  aria-label={open ? `Recolher ${g.label}` : `Abrir ${g.label}`}
                  onClick={() => setClosed(open ? [...closed, g.key] : closed.filter((k) => k !== g.key))}
                >
                  <ChevronDown size={14} className={open ? '' : 'shut'} />
                </button>
                <button
                  type="button"
                  className="parts-group-name"
                  title="Escolher o grupo todo · Shift soma à seleção"
                  onClick={(e) => onSelectMany(ids, e.shiftKey)}
                >
                  <span>{g.label}</span>
                  <small>
                    {g.parts.length} {g.parts.length === 1 ? 'peça' : 'peças'}
                    {picked > 0 && picked < ids.length ? ` · ${picked} escolhida${picked > 1 ? 's' : ''}` : ''}
                  </small>
                </button>
                <small className="parts-area">{m2(g.parts.reduce((a, p) => a + (p.c * p.l) / 1e6, 0))} m²</small>
              </header>
              {open && (
                <ul>
                  {g.rows.map((r) => {
                    const on = r.ids.every((id) => selected.includes(id));
                    const p = r.part;
                    // Linha de iguais: os módulos de onde vêm (o material já está no grupo ou abaixo).
                    const modules = [...new Set(r.parts.map(moduleOf))].join(', ');
                    const sub =
                      groupBy === 'module'
                        ? p.material
                        : groupBy === 'material'
                          ? modules
                          : `${modules} · ${p.material}`;
                    const numbers = r.parts
                      .map((v) => cutNumber.get(v.id))
                      .filter((v): v is number => v !== undefined)
                      .sort((a, b) => a - b);
                    return (
                      <li key={r.key}>
                        <button
                          type="button"
                          data-ids={r.ids.join(' ')}
                          className={'parts-row' + (on ? ' on' : '')}
                          onClick={(e) =>
                            r.ids.length === 1 ? onToggle(p.id, e.shiftKey) : onSelectMany(r.ids, e.shiftKey)
                          }
                        >
                          <i className="swatch-dot" style={{ '--swatch': p.color } as React.CSSProperties} />
                          <span className="parts-name">
                            <strong>
                              {shortName(p.name)}
                              {r.count > 1 && <em>×{r.count}</em>}
                            </strong>
                            <small>
                              {numbers.length ? `Nº ${numbers.join(', ')} · ` : ''}
                              {sub}
                            </small>
                          </span>
                          <EdgeMark part={p} />
                          <span className="parts-dim">
                            {mm(p.c)} × {mm(p.l)}
                            <small>{mm(p.thickness)} mm</small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <p className="hint">
        C × L nominais, C no sentido do veio. O quadrinho mostra as bordas com fita: frentes nas quatro, demais peças
        na da frente. Nº é o número da peça no plano de corte.
      </p>
    </div>
  );
}

/** Bordas com fita num retângulo: em cima e embaixo o C, dos lados o L. */
function EdgeMark({ part }: { part: ModularPart }) {
  const e = edgeSides(part);
  const names = [e.c1 && 'frente', e.c2 && 'trás', e.l1 && 'lado esquerdo', e.l2 && 'lado direito'].filter(Boolean);
  const title = names.length === 4 ? 'Fita nas 4 bordas' : names.length ? `Fita: ${names.join(', ')}` : 'Sem fita';
  return (
    <svg className="edge-mark" viewBox="0 0 18 12" aria-label={title}>
      <title>{title}</title>
      <rect x={2} y={2} width={14} height={8} rx={1} className="edge-body" />
      {e.c1 && <line x1={2} x2={16} y1={1.4} y2={1.4} />}
      {e.c2 && <line x1={2} x2={16} y1={10.6} y2={10.6} />}
      {e.l1 && <line x1={1.4} x2={1.4} y1={2} y2={10} />}
      {e.l2 && <line x1={16.6} x2={16.6} y1={2} y2={10} />}
    </svg>
  );
}
