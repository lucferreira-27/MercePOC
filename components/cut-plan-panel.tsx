'use client';
import { Download } from 'lucide-react';
import type { CutPlan } from '@/lib/cutplan';
import { materials } from '@/lib/furniture';

/** Posições de cada peça em cada chapa, para a serra ou para outro software. */
export function cutPlanCSV(plan: CutPlan) {
  const q = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
  const rows = [
    ['Chapa', 'Material', 'Espessura (mm)', 'Peça', 'ID', 'X (mm)', 'Y (mm)', 'Comprimento (mm)', 'Largura (mm)', 'Girada'],
    ...plan.sheets.flatMap((s) =>
      s.placements.map((p) => [
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

function tone(materialId: string | null) {
  return materials.find((m) => m.id === materialId)?.color ?? '#d9d3c7';
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
  const totalSheets = plan.sheets.length;
  const used = plan.sheets.reduce((a, s) => a + s.usedArea, 0);
  const efficiency = totalSheets ? used / (totalSheets * spec.length * spec.width) : 0;
  return (
    <div className="cut-panel">
      <div className="cut-summary">
        <div>
          <strong>{totalSheets}</strong>
          <span>{totalSheets === 1 ? 'chapa' : 'chapas'}</span>
        </div>
        <div>
          <strong>{Math.round(efficiency * 100)}%</strong>
          <span>aproveitamento</span>
        </div>
        <div>
          <strong>{(used / 1e6).toFixed(2).replace('.', ',')}</strong>
          <span>m² de peças</span>
        </div>
      </div>
      <p className="hint">
        Chapa {spec.length} × {spec.width} mm, disco de {spec.kerf} mm e refilo de {spec.trim} mm.
        Cortes em guilhotina, como na serra de painel. Madeira mantém o veio no comprimento da chapa.
      </p>
      <button type="button" className="ghost-button" onClick={onDownload}>
        <Download size={14} /> Baixar posições (CSV)
      </button>
      {plan.oversize.length > 0 && (
        <p className="field-error" role="alert">
          {plan.oversize.length === 1 ? 'Uma peça não cabe' : `${plan.oversize.length} peças não cabem`} na
          chapa útil com o veio no sentido certo:{' '}
          {plan.oversize.map((o) => `${o.name} (${o.c} × ${o.l})`).join(', ')}. Precisa de emenda ou chapa maior.
        </p>
      )}
      {plan.groups.map((g) => (
        <section className="cut-group" key={g.key}>
          <div className="section-label">
            <span>
              <i className={'swatch-dot' + (g.grain ? ' wood' : '')} style={{ '--swatch': tone(g.materialId) } as React.CSSProperties} />
              {g.material} · {g.thickness} mm
            </span>
            <span>
              {g.sheets} × · {Math.round(g.efficiency * 100)}%
            </span>
          </div>
          {plan.sheets
            .filter((s) => s.key === g.key)
            .map((s) => (
              <figure className="cut-sheet" key={s.key + s.index}>
                <svg viewBox={`0 0 ${spec.length} ${spec.width}`}>
                  <title>{`Chapa ${s.index} de ${g.material}`}</title>
                  <rect className="sheet-bg" x={0} y={0} width={spec.length} height={spec.width} />
                  <rect className="sheet-trim" x={spec.trim} y={spec.trim} width={spec.length - 2 * spec.trim} height={spec.width - 2 * spec.trim} />
                  {s.placements.map((p) => {
                    const on = selected.includes(p.id);
                    const big = p.w > 260 && p.h > 110;
                    return (
                      <g
                        key={p.id}
                        className={'cut-piece' + (on ? ' on' : '')}
                        onClick={(e) => onSelect(p.id, e.shiftKey)}
                      >
                        <title>
                          {p.name} · {p.w} × {p.h} mm{p.rotated ? ' · girada' : ''}
                        </title>
                        <rect x={p.x} y={p.y} width={p.w} height={p.h} style={{ '--piece': tone(s.materialId) } as React.CSSProperties} />
                        {big && (
                          <text x={p.x + p.w / 2} y={p.y + p.h / 2} fontSize={Math.min(64, p.h / 3.2, p.w / 9)}>
                            {Math.round(p.w)} × {Math.round(p.h)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
                <figcaption>
                  Chapa {s.index} · {s.placements.length} peças · {Math.round(s.efficiency * 100)}% aproveitada
                </figcaption>
              </figure>
            ))}
        </section>
      ))}
    </div>
  );
}
