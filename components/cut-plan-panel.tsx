'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Maximize2, RotateCw, X } from 'lucide-react';
import type { CutPlan, CutSheet, Placement } from '@/lib/cutplan';
import { CutSheetDrawing, mmText, pieceTone, shortName, type CutLabel } from './cut-sheet-drawing';

/** Posições de cada peça em cada chapa, para a serra ou para outro software. */
export function cutPlanCSV(plan: CutPlan) {
  const q = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
  const rows = [
    ['Nº', 'Chapa', 'Material', 'Espessura (mm)', 'Peça', 'ID', 'X (mm)', 'Y (mm)', 'Comprimento (mm)', 'Largura (mm)', 'Girada'],
    ...plan.sheets.flatMap((s) =>
      s.placements.map((p) => [
        p.n,
        `${s.material} ${s.thickness} #${s.index}`,
        s.material,
        s.thickness,
        p.name,
        p.id,
        Math.round(p.x * 10) / 10,
        Math.round(p.y * 10) / 10,
        p.w,
        p.h,
        p.rotated ? 'sim' : 'não',
      ]),
    ),
  ];
  return '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n');
}

function percent(v: number) {
  return `${Math.round(v * 100)}%`;
}
function m2(mm2: number) {
  return (mm2 / 1e6).toFixed(2).replace('.', ',');
}
const offcutArea = (s: CutSheet) => s.offcuts.reduce((a, o) => a + o.w * o.h, 0);

/** Preferências de leitura do plano, lembradas neste navegador. */
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

export function CutPlanPanel({
  plan,
  selected,
  onSelect,
  onDownload,
}: {
  plan: CutPlan;
  selected: string[];
  onSelect: (id: string, extend: boolean) => void;
  onDownload: () => void;
}) {
  const { spec } = plan;
  const [filter, setFilter] = useState<string>('all');
  // Abre na chapa da peça escolhida (na cena ou na aba Peças), se houver.
  const [cursor, setCursor] = useState(() => {
    const last = selected.at(-1);
    return Math.max(0, plan.sheets.findIndex((s) => s.placements.some((p) => p.id === last)));
  });
  const [label, setLabel] = usePref<CutLabel>('merce.cut.label', 'dims');
  const [offcuts, setOffcuts] = usePref('merce.cut.offcuts', true);
  const [hovered, setHovered] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const group = plan.groups.some((g) => g.key === filter) ? filter : 'all';
  const visible = group === 'all' ? plan.sheets : plan.sheets.filter((s) => s.key === group);
  const at = Math.min(cursor, Math.max(visible.length - 1, 0));
  const sheet = visible[at];

  // Peça escolhida na cena (ou na lista de peças) em outra chapa: o plano
  // abre a chapa dela. Só a seleção nova move; navegar à mão não briga.
  const [seen, setSeen] = useState(selected);
  if (seen !== selected) {
    setSeen(selected);
    const fresh = selected.find((id) => !seen.includes(id));
    if (fresh && !sheet?.placements.some((p) => p.id === fresh)) {
      const home = plan.sheets.find((s) => s.placements.some((p) => p.id === fresh));
      if (home) {
        const list = group === 'all' || home.key === group ? visible : plan.sheets;
        if (list !== visible) setFilter('all');
        setCursor(list.indexOf(home));
      }
    }
  }

  const totalSheets = plan.sheets.length;
  const used = plan.sheets.reduce((a, s) => a + s.usedArea, 0);
  const efficiency = totalSheets ? used / (totalSheets * spec.length * spec.width) : 0;
  const pieces = plan.sheets.reduce((a, s) => a + s.placements.length, 0);
  const spare = plan.sheets.reduce((a, s) => a + offcutArea(s), 0);
  const go = (delta: number) => setCursor(Math.min(Math.max(at + delta, 0), visible.length - 1));
  const pick = (p: Placement, extend: boolean) => onSelect(p.id, extend);

  return (
    <div className="cut-panel">
      <div className="cut-summary">
        <div>
          <strong>{totalSheets}</strong>
          <span>{totalSheets === 1 ? 'chapa' : 'chapas'}</span>
        </div>
        <div>
          <strong>{percent(efficiency)}</strong>
          <span>usado</span>
        </div>
        <div>
          <strong>{pieces}</strong>
          <span>peças</span>
        </div>
        <div>
          <strong>{m2(spare)}</strong>
          <span>m² sobra</span>
        </div>
      </div>
      {plan.oversize.length > 0 && (
        <p className="field-error" role="alert">
          {plan.oversize.length === 1 ? 'Uma peça não cabe' : `${plan.oversize.length} peças não cabem`} na
          chapa útil com o veio no sentido certo:{' '}
          {plan.oversize.map((o) => `${o.name} (${o.c} × ${o.l})`).join(', ')}. Precisa de emenda ou chapa maior.
        </p>
      )}
      {plan.groups.length > 1 && (
        <div className="cut-filter" aria-label="Material">
          <button
            type="button"
            aria-pressed={group === 'all'}
            className={group === 'all' ? 'on' : ''}
            onClick={() => {
              setFilter('all');
              setCursor(0);
            }}
          >
            Todas <b>{totalSheets}</b>
          </button>
          {plan.groups.map((g) => (
            <button
              key={g.key}
              type="button"
              aria-pressed={group === g.key}
              className={group === g.key ? 'on' : ''}
              title={`${g.material} ${g.thickness} mm · ${g.parts} peças · ${percent(g.efficiency)}`}
              onClick={() => {
                setFilter(g.key);
                setCursor(0);
              }}
            >
              <i
                className={'swatch-dot' + (g.grain ? ' wood' : '')}
                style={{ '--swatch': pieceTone(g.materialId) } as React.CSSProperties}
              />
              {g.material.split(' ')[0]} {g.thickness} <b>{g.sheets}</b>
            </button>
          ))}
        </div>
      )}
      {sheet && (
        <>
          <SheetCard
            plan={plan}
            sheet={sheet}
            at={at}
            count={visible.length}
            onPrev={() => go(-1)}
            onNext={() => go(1)}
            onExpand={() => setExpanded(true)}
          >
            <CutSheetDrawing
              spec={spec}
              sheet={sheet}
              label={label}
              offcuts={offcuts}
              selected={selected}
              hovered={hovered}
              onPiece={pick}
              onHover={setHovered}
            />
          </SheetCard>
          {visible.length > 1 && (
            <div className="cut-thumbs" role="tablist" aria-label="Chapas">
              {visible.map((s, i) => (
                <button
                  key={s.key + s.index}
                  type="button"
                  role="tab"
                  aria-selected={i === at}
                  className={i === at ? 'on' : ''}
                  title={`${s.material} ${s.thickness} mm · chapa ${s.index} · ${percent(s.efficiency)}`}
                  onClick={() => setCursor(i)}
                >
                  <MiniSheet plan={plan} sheet={s} selected={selected} />
                  <span>
                    {i + 1} · {percent(s.efficiency)}
                  </span>
                </button>
              ))}
            </div>
          )}
          <ViewControls label={label} onLabel={setLabel} offcuts={offcuts} onOffcuts={setOffcuts} />
          <PieceList
            sheet={sheet}
            selected={selected}
            hovered={hovered}
            onHover={setHovered}
            onPick={pick}
          />
        </>
      )}
      <p className="hint cut-spec">
        Chapa {spec.length} × {spec.width} mm, disco de {spec.kerf} mm e refilo de {spec.trim} mm. Cortes em
        guilhotina, como na serra de painel. Madeira mantém o veio no comprimento da chapa. Sobra útil: os dois lados
        com 15 cm ou mais.
      </p>
      <button type="button" className="ghost-button" onClick={onDownload}>
        <Download size={14} /> Baixar posições (CSV)
      </button>
      {expanded && sheet && (
        <CutViewer
          plan={plan}
          visible={visible}
          at={at}
          onAt={setCursor}
          label={label}
          onLabel={setLabel}
          offcuts={offcuts}
          onOffcuts={setOffcuts}
          selected={selected}
          hovered={hovered}
          onHover={setHovered}
          onPick={pick}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  );
}

function SheetCard({
  plan,
  sheet,
  at,
  count,
  onPrev,
  onNext,
  onExpand,
  children,
}: {
  plan: CutPlan;
  sheet: CutSheet;
  at: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
  onExpand?: () => void;
  children: React.ReactNode;
}) {
  const ofMaterial = plan.sheets.filter((s) => s.key === sheet.key).length;
  return (
    <section className="cut-card" aria-label={`Chapa ${sheet.index} de ${sheet.material}`}>
      <header className="cut-card-head">
        <i
          className={'swatch-dot' + (sheet.grain ? ' wood' : '')}
          style={{ '--swatch': pieceTone(sheet.materialId) } as React.CSSProperties}
        />
        <div>
          <strong>
            {sheet.material} · {sheet.thickness} mm
          </strong>
          <span>
            Chapa {sheet.index} de {ofMaterial}
            {count > 1 && ` · ${at + 1}/${count} no plano`}
          </span>
        </div>
        <div className="cut-nav">
          <button type="button" className="icon-button" aria-label="Chapa anterior" disabled={at === 0} onClick={onPrev}>
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Próxima chapa"
            disabled={at >= count - 1}
            onClick={onNext}
          >
            <ChevronRight size={16} />
          </button>
          {onExpand && (
            <button type="button" className="icon-button" aria-label="Ampliar chapa" title="Ampliar" onClick={onExpand}>
              <Maximize2 size={15} />
            </button>
          )}
        </div>
      </header>
      <div className="cut-card-body">{children}</div>
      <footer className="cut-card-foot">
        <span>
          <b>{sheet.placements.length}</b> {sheet.placements.length === 1 ? 'peça' : 'peças'}
        </span>
        <span>
          <b>{percent(sheet.efficiency)}</b> usada
        </span>
        <span>
          <b>{m2(offcutArea(sheet))}</b> m² de sobra útil
        </span>
        <span className="cut-meter" aria-hidden="true">
          <i style={{ width: percent(sheet.efficiency) }} />
        </span>
      </footer>
    </section>
  );
}

function MiniSheet({ plan, sheet, selected }: { plan: CutPlan; sheet: CutSheet; selected: readonly string[] }) {
  const { spec } = plan;
  return (
    <svg viewBox={`0 0 ${spec.length} ${spec.width}`} aria-hidden="true">
      <rect className="cd-sheet" width={spec.length} height={spec.width} />
      {sheet.placements.map((p) => (
        <rect
          key={p.id}
          className={'mini-piece' + (selected.includes(p.id) ? ' on' : '')}
          style={{ '--piece': pieceTone(sheet.materialId) } as React.CSSProperties}
          x={p.x}
          y={p.y}
          width={p.w}
          height={p.h}
        />
      ))}
    </svg>
  );
}

function ViewControls({
  label,
  onLabel,
  offcuts,
  onOffcuts,
}: {
  label: CutLabel;
  onLabel: (v: CutLabel) => void;
  offcuts: boolean;
  onOffcuts: (v: boolean) => void;
}) {
  return (
    <div className="cut-controls">
      <div className="cut-seg" aria-label="Rótulo das peças">
        {(
          [
            ['dims', 'Medidas'],
            ['name', 'Nomes'],
          ] as const
        ).map(([id, text]) => (
          <button key={id} type="button" aria-pressed={label === id} className={label === id ? 'on' : ''} onClick={() => onLabel(id)}>
            {text}
          </button>
        ))}
      </div>
      <label className="switch-row cut-switch">
        <input type="checkbox" checked={offcuts} onChange={(e) => onOffcuts(e.target.checked)} />
        <span className="switch" aria-hidden="true" />
        Sobras
      </label>
    </div>
  );
}

function PieceList({
  sheet,
  selected,
  hovered,
  onHover,
  onPick,
}: {
  sheet: CutSheet;
  selected: readonly string[];
  hovered: string | null;
  onHover: (id: string | null) => void;
  onPick: (p: Placement, extend: boolean) => void;
}) {
  const rows = useRef<HTMLOListElement>(null);
  // Peça apontada no desenho: a linha dela aparece na lista.
  useEffect(() => {
    if (!hovered) return;
    rows.current?.querySelector(`[data-id="${CSS.escape(hovered)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hovered]);
  return (
    <>
      <div className="section-label">
        <span>Peças desta chapa</span>
        <span>C × L (mm)</span>
      </div>
      <ol className="cut-list" ref={rows}>
        {sheet.placements.map((p) => (
          <li key={p.id} data-id={p.id}>
            <button
              type="button"
              className={
                'cut-row' + (selected.includes(p.id) ? ' on' : '') + (hovered === p.id ? ' hot' : '')
              }
              onMouseEnter={() => onHover(p.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(p.id)}
              onClick={(e) => onPick(p, e.shiftKey)}
            >
              <span className="cut-num">{p.n}</span>
              <span className="cut-name">{shortName(p.name)}</span>
              {p.rotated && (
                <span className="cut-rot" title="Girada: o comprimento da peça corre na largura da chapa">
                  <RotateCw size={11} />
                </span>
              )}
              <span className="cut-dim">
                {mmText(p.w)} × {mmText(p.h)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

/** Chapa grande, com a lista ao lado. Setas trocam de chapa; Esc fecha. */
function CutViewer({
  plan,
  visible,
  at,
  onAt,
  label,
  onLabel,
  offcuts,
  onOffcuts,
  selected,
  hovered,
  onHover,
  onPick,
  onClose,
}: {
  plan: CutPlan;
  visible: CutSheet[];
  at: number;
  onAt: (i: number) => void;
  label: CutLabel;
  onLabel: (v: CutLabel) => void;
  offcuts: boolean;
  onOffcuts: (v: boolean) => void;
  selected: readonly string[];
  hovered: string | null;
  onHover: (id: string | null) => void;
  onPick: (p: Placement, extend: boolean) => void;
  onClose: () => void;
}) {
  const sheet = visible[at];
  const latest = useRef({ at, count: visible.length, onAt, onClose });
  useEffect(() => {
    latest.current = { at, count: visible.length, onAt, onClose };
  });
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const l = latest.current;
      if (e.key === 'Escape') {
        e.stopPropagation();
        l.onClose();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        l.onAt(Math.min(Math.max(l.at + (e.key === 'ArrowLeft' ? -1 : 1), 0), l.count - 1));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <div
      className="modal-backdrop centered"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <dialog open className="modal cut-viewer" aria-modal="true" aria-label="Plano de corte ampliado">
        <div className="cut-viewer-main">
          <SheetCard
            plan={plan}
            sheet={sheet}
            at={at}
            count={visible.length}
            onPrev={() => onAt(Math.max(at - 1, 0))}
            onNext={() => onAt(Math.min(at + 1, visible.length - 1))}
          >
            <CutSheetDrawing
              spec={plan.spec}
              sheet={sheet}
              label={label}
              offcuts={offcuts}
              selected={selected}
              hovered={hovered}
              onPiece={onPick}
              onHover={onHover}
            />
          </SheetCard>
          <p className="cut-keys">
            <kbd>←</kbd> <kbd>→</kbd> trocam de chapa · clique na peça para vê-la no móvel · <kbd>Esc</kbd> fecha
          </p>
        </div>
        <aside className="cut-viewer-side">
          <div className="cut-viewer-top">
            <ViewControls label={label} onLabel={onLabel} offcuts={offcuts} onOffcuts={onOffcuts} />
            <button ref={closeRef} type="button" className="icon-button" aria-label="Fechar" onClick={onClose}>
              <X size={17} />
            </button>
          </div>
          <PieceList sheet={sheet} selected={selected} hovered={hovered} onHover={onHover} onPick={onPick} />
        </aside>
      </dialog>
    </div>
  );
}
