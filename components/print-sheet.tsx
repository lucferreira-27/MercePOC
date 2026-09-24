/* oxlint-disable next/no-img-element -- A foto da cena é um data URL gerado na hora. */
import type { ModularPart } from '@/lib/composition';
import type { Part } from '@/lib/furniture';
import { money, type Quote } from '@/lib/quote';
import { materials } from '@/lib/furniture';
import { PlanThumb } from './plan-thumb';

/** Milímetros para exibição: duas casas no máximo, sem dízima. */
function mm(millimetres: number) {
  return String(Math.round(millimetres * 100) / 100);
}

/**
 * Agrupa peças idênticas para a folha impressa: quatro prateleiras iguais são
 * uma linha com quantidade 4, não quatro linhas com quantidade 1.
 */
export function groupParts(parts: readonly Part[]) {
  const rows = new Map<
    string,
    { key: string; name: string; count: number; c: number; l: number; thickness: number; material: string; area: number }
  >();
  for (const part of parts) {
    // O nome do módulo sai do agrupamento: "Coluna 1 / Base" e "Coluna 2 /
    // Base" de mesma medida são a mesma peça na oficina.
    const name = part.name.includes(' / ') ? part.name.split(' / ').slice(1).join(' / ') : part.name;
    const key = [name, part.c, part.l, part.thickness, part.material].join('|');
    const row = rows.get(key);
    if (row) {
      row.count += 1;
      row.area += (part.c * part.l) / 1_000_000;
    } else
      rows.set(key, {
        key,
        name,
        count: 1,
        c: part.c,
        l: part.l,
        thickness: part.thickness,
        material: part.material,
        area: (part.c * part.l) / 1_000_000,
      });
  }
  return [...rows.values()].sort((a, b) => a.material.localeCompare(b.material) || b.c * b.l - a.c * a.l);
}

export function PrintSheet({
  name,
  version,
  size,
  moduleCount,
  parts,
  drawing = parts,
  quote,
  snapshot,
}: {
  name: string;
  version: number;
  size: [number, number, number];
  moduleCount: number;
  parts: readonly ModularPart[];
  /** Peças do desenho (com os pés); ausente, desenha as de corte. */
  drawing?: readonly ModularPart[];
  quote: Quote;
  /** Foto da cena 3D, quando a pessoa tirou uma antes de imprimir. */
  snapshot?: string | null;
}) {
  const rows = groupParts(parts);
  const area = rows.reduce((a, r) => a + r.area, 0);
  const { plan } = quote;
  const today = new Date().toLocaleDateString('pt-BR');
  return (
    <section className="print-sheet" aria-hidden="true">
      <div className="print-page">
        <header className="print-head">
          <div>
            <span className="print-brand">merce.</span>
            <h1>{name}</h1>
            <p>
              {mm(size[0])} × {mm(size[1])} × {mm(size[2])} mm · {moduleCount}{' '}
              {moduleCount === 1 ? 'módulo' : 'módulos'} · {parts.length} peças · versão {version}
            </p>
          </div>
          <div className="print-meta">
            <span>{today}</span>
            <strong>{money(quote.total)}</strong>
            <small>estimativa</small>
          </div>
        </header>
        {snapshot ? (
          <img className="print-snapshot" src={snapshot} alt="" />
        ) : (
          <div className="print-views">
            <figure>
              <PlanThumb parts={drawing} view="front" width={420} height={300} />
              <figcaption>Vista frontal, frentes fechadas</figcaption>
            </figure>
            <figure>
              <PlanThumb parts={drawing} view="iso" width={420} height={300} />
              <figcaption>Vista isométrica</figcaption>
            </figure>
          </div>
        )}
        <h2>Orçamento estimado</h2>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qtd.</th>
              <th>Unitário</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((l) => (
              <tr key={l.section + l.label}>
                <td>
                  {l.label}
                  <small className="sheet-note">{l.section}</small>
                </td>
                <td>
                  {l.qty} {l.unit}
                </td>
                <td>{money(l.unitPrice)}</td>
                <td>{money(l.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={3}>Custo</th>
              <th>{money(quote.cost)}</th>
            </tr>
            <tr>
              <th colSpan={3}>Margem</th>
              <th>{money(quote.marginValue)}</th>
            </tr>
            <tr>
              <th colSpan={3}>Total</th>
              <th>{money(quote.total)}</th>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="print-page">
        <h2>Lista de peças</h2>
        <table>
          <thead>
            <tr>
              <th>Peça</th>
              <th>Qtd.</th>
              <th>C × L × E (mm)</th>
              <th>Material</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.name}</td>
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
              <th>{rows.length} itens distintos</th>
              <th>{parts.length} peças</th>
              <th colSpan={2}>{area.toFixed(2).replace('.', ',')} m² de chapa</th>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="print-page">
        <h2>Plano de corte</h2>
        <p>
          Chapa {plan.spec.length} × {plan.spec.width} mm, disco {plan.spec.kerf} mm, refilo {plan.spec.trim} mm.{' '}
          {plan.sheets.length} {plan.sheets.length === 1 ? 'chapa' : 'chapas'} no total.
        </p>
        <div className="print-cuts">
          {plan.sheets.map((s) => (
            <figure key={s.key + s.index}>
              <svg viewBox={`0 0 ${plan.spec.length} ${plan.spec.width}`}>
                <rect x={0} y={0} width={plan.spec.length} height={plan.spec.width} fill="#fff" stroke="#000" strokeWidth={6} />
                {s.placements.map((p) => (
                  <g key={p.id}>
                    <rect
                      x={p.x}
                      y={p.y}
                      width={p.w}
                      height={p.h}
                      fill={materials.find((m) => m.id === s.materialId)?.color ?? '#ddd'}
                      fillOpacity={0.35}
                      stroke="#000"
                      strokeWidth={4}
                    />
                    {p.w > 220 && p.h > 90 && (
                      <text x={p.x + p.w / 2} y={p.y + p.h / 2} fontSize={Math.min(60, p.h / 3, p.w / 8)} textAnchor="middle" dominantBaseline="middle">
                        {Math.round(p.w)}×{Math.round(p.h)}
                      </text>
                    )}
                  </g>
                ))}
              </svg>
              <figcaption>
                {s.material} {s.thickness} mm · chapa {s.index} · {Math.round(s.efficiency * 100)}%
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="print-foot">
          Desenho de revisão gerado no Merce. Sem furação, fixações ou certificação estrutural. Conferir
          medidas, materiais, bordas e estabilidade antes de produzir.
        </p>
      </div>
    </section>
  );
}
