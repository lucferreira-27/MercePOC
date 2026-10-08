/* oxlint-disable next/no-img-element -- A foto do móvel é um data URL gerado na hora. */
import { memo } from 'react';
import type { ModularPart } from '@/lib/composition';
import { groupParts } from '@/lib/parts-group';
import { planView } from '@/lib/plan-geometry';
import { money, quantity, type Quote } from '@/lib/quote';
import { CutSheetDrawing, mmText, pieceTone, shortName } from './cut-sheet-drawing';
import { PlanThumb } from './plan-thumb';

/** Milímetros para exibição: duas casas no máximo, sem dízima. */
function mm(millimetres: number) {
  return String(Math.round(millimetres * 100) / 100);
}
function cm(millimetres: number) {
  return (Math.round(millimetres) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}
function m2(value: number) {
  return value.toFixed(2).replace('.', ',');
}

export { groupParts } from '@/lib/parts-group';

/** Largura do desenho da chapa no PDF, em px CSS (~112 mm no A4). */
const SHEET_PX = 424;

/** Folha de impressão: fica no DOM, escondida; só redesenha quando o projeto muda. */
export const PrintSheet = memo(PrintSheetView);

function PrintSheetView({
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
  /** Foto enquadrada do móvel (renderPrintShot); sem ela, a vista isométrica em traço. */
  snapshot?: string | null;
}) {
  const rows = groupParts(parts);
  const area = rows.reduce((a, r) => a + r.area, 0);
  const { plan } = quote;
  const today = new Date().toLocaleDateString('pt-BR');
  // Mesma ordem do plano de corte: chapas de corpo primeiro, finas depois.
  const order = (material: string) => {
    const i = plan.groups.findIndex((g) => g.key === material);
    return i < 0 ? plan.groups.length : i;
  };
  const byMaterial = [...new Set(rows.map((r) => r.material))].sort((a, b) => order(a) - order(b)).map((material) => ({
    material,
    rows: rows.filter((r) => r.material === material),
  }));
  const sections = quote.sections.filter((s) => quote.lines.some((l) => l.section === s.section));
  const head = (n: string, title: string) => (
    <header className="pr-section">
      <span>{n}</span>
      <h2>{title}</h2>
    </header>
  );
  const running = (
    <div className="pr-running">
      <span className="print-brand">merce.</span>
      <span>
        {name} · versão {version} · {today}
      </span>
    </div>
  );
  return (
    <section className="print-sheet" aria-hidden="true">
      <div className="print-page pr-cover">
        <header className="pr-head">
          <span className="print-brand">merce.</span>
          <span>
            Projeto de marcenaria · versão {version} · {today}
          </span>
        </header>
        <div className="pr-title">
          <h1>{name}</h1>
          <p>
            {cm(size[0])} × {cm(size[1])} × {cm(size[2])} cm <small>(L × A × P)</small> · {moduleCount}{' '}
            {moduleCount === 1 ? 'módulo' : 'módulos'} · {parts.length} {parts.length === 1 ? 'peça' : 'peças'}
          </p>
        </div>
        <figure className="pr-hero">
          {snapshot ? (
            <img src={snapshot} alt="" />
          ) : (
            <PlanThumb parts={drawing} view="iso" width={720} height={400} />
          )}
        </figure>
        <div className="pr-cover-grid">
          <figure className="pr-front">
            <FrontElevation parts={drawing} size={size} />
            <figcaption>Vista frontal, frentes fechadas · medidas em mm</figcaption>
          </figure>
          <dl className="pr-facts">
            <div>
              <dt>Largura</dt>
              <dd>{mm(size[0])} mm</dd>
            </div>
            <div>
              <dt>Altura</dt>
              <dd>{mm(size[1])} mm</dd>
            </div>
            <div>
              <dt>Profundidade</dt>
              <dd>{mm(size[2])} mm</dd>
            </div>
            <div className="pr-materials">
              <dt>Chapas</dt>
              <dd>
                {plan.groups.map((g) => (
                  <span key={g.key}>
                    <i style={{ background: pieceTone(g.materialId) }} />
                    {g.material} {g.thickness} mm <b>{g.sheets}×</b>
                  </span>
                ))}
              </dd>
            </div>
            <div className="pr-total">
              <dt>Estimativa</dt>
              <dd>{money(quote.total)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="print-page">
        {running}
        {head('01', 'Orçamento estimado')}
        <table className="pr-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Qtd.</th>
              <th className="num">Unitário</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          {sections.map((s) => (
            <tbody key={s.section}>
              <tr className="pr-group">
                <th colSpan={3}>{s.section}</th>
                <th className="num">{money(s.total)}</th>
              </tr>
              {quote.lines
                .filter((l) => l.section === s.section)
                .map((l) => (
                  <tr key={l.section + l.label}>
                    <td>{l.label}</td>
                    <td className="num">
                      {quantity(l.qty)} {l.unit}
                    </td>
                    <td className="num">{money(l.unitPrice)}</td>
                    <td className="num">{money(l.total)}</td>
                  </tr>
                ))}
            </tbody>
          ))}
          <tbody className="pr-sum">
            <tr>
              <th colSpan={3}>Custo</th>
              <th className="num">{money(quote.cost)}</th>
            </tr>
            <tr>
              <th colSpan={3}>Margem</th>
              <th className="num">{money(quote.marginValue)}</th>
            </tr>
            <tr className="pr-grand">
              <th colSpan={3}>Total estimado</th>
              <th className="num">{money(quote.total)}</th>
            </tr>
          </tbody>
        </table>

        {head('02', 'Lista de peças')}
        <table className="pr-table">
          <thead>
            <tr>
              <th>Peça</th>
              <th className="num">Qtd.</th>
              <th className="num">C × L × E (mm)</th>
              <th className="num">Área (m²)</th>
            </tr>
          </thead>
          {byMaterial.map((g) => (
            <tbody key={g.material}>
              <tr className="pr-group">
                <th colSpan={2}>{g.material}</th>
                <th className="num">{g.rows.reduce((a, r) => a + r.count, 0)} peças</th>
                <th className="num">{m2(g.rows.reduce((a, r) => a + r.area, 0))}</th>
              </tr>
              {g.rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.name}</td>
                  <td className="num">{row.count}</td>
                  <td className="num">
                    {mm(row.c)} × {mm(row.l)} × {mm(row.thickness)}
                  </td>
                  <td className="num">{m2(row.area)}</td>
                </tr>
              ))}
            </tbody>
          ))}
          <tbody className="pr-sum">
            <tr>
              <th>{rows.length} itens distintos</th>
              <th className="num">{parts.length}</th>
              <th className="num">área total</th>
              <th className="num">{m2(area)}</th>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="print-page">
        {running}
        {head('03', 'Plano de corte')}
        <p className="pr-lead">
          Chapa {plan.spec.length} × {plan.spec.width} mm, disco de {plan.spec.kerf} mm, refilo de {plan.spec.trim} mm.
          Cortes em guilhotina; madeira com o veio no comprimento da chapa. Os números nas peças são os mesmos da
          aba Corte e do CSV. Área hachurada: sobra com os dois lados de 15 cm ou mais.
        </p>
        <table className="pr-table pr-cut-summary">
          <thead>
            <tr>
              <th>Material</th>
              <th className="num">Chapas</th>
              <th className="num">Peças</th>
              <th className="num">Área de peças</th>
              <th className="num">Aproveitamento</th>
            </tr>
          </thead>
          <tbody>
            {plan.groups.map((g) => (
              <tr key={g.key}>
                <td>
                  <i className="pr-swatch" style={{ background: pieceTone(g.materialId) }} />
                  {g.material} · {g.thickness} mm
                </td>
                <td className="num">{g.sheets}</td>
                <td className="num">{g.parts}</td>
                <td className="num">{m2(g.area)} m²</td>
                <td className="num">{Math.round(g.efficiency * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {plan.oversize.length > 0 && (
          <p className="pr-alert">
            Fora da chapa (precisa de emenda ou chapa maior):{' '}
            {plan.oversize.map((o) => `${o.name} (${o.c} × ${o.l})`).join(', ')}.
          </p>
        )}
        {plan.sheets.map((s) => (
          <article className="pr-sheet" key={s.key + s.index}>
            <header>
              <strong>
                {s.material} · {s.thickness} mm
              </strong>
              <span>
                chapa {s.index} de {plan.groups.find((g) => g.key === s.key)?.sheets ?? 1} · {s.placements.length}{' '}
                peças · {Math.round(s.efficiency * 100)}% usada
              </span>
            </header>
            <div className="pr-sheet-body">
              <CutSheetDrawing spec={plan.spec} sheet={s} pxWidth={SHEET_PX} print />
              <table className="pr-legend">
                <tbody>
                  {s.placements.map((p) => (
                    <tr key={p.id}>
                      <td className="pr-n">{p.n}</td>
                      <td>
                        {shortName(p.name)}
                        {p.rotated && <em> ↻</em>}
                      </td>
                      <td className="num">
                        {mmText(p.w)} × {mmText(p.h)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
        <p className="print-foot">
          ↻ peça girada na chapa. Desenho de revisão gerado no Merce. Sem furação, fixações ou certificação
          estrutural. Conferir medidas, materiais, bordas e estabilidade antes de produzir.
        </p>
      </div>
    </section>
  );
}

/** Vista frontal em traço, com as cotas de largura e altura do conjunto. */
function FrontElevation({ parts, size }: { parts: readonly ModularPart[]; size: [number, number, number] }) {
  const W = 400,
    H = 300;
  const g = planView(parts, 'front', { width: W - 40, height: H - 34 });
  const pts = g.panels.flatMap((p) => p.points);
  if (!pts.length) return null;
  const x0 = Math.min(...pts.map((p) => p[0])) + 34,
    x1 = Math.max(...pts.map((p) => p[0])) + 34,
    y0 = Math.min(...pts.map((p) => p[1])),
    y1 = Math.max(...pts.map((p) => p[1]));
  const dimY = y1 + 16,
    dimX = x0 - 16;
  return (
    <svg className="pr-elevation" viewBox={`0 0 ${W} ${H}`}>
      <g transform="translate(34 0)">
        {g.panels.map((panel, i) => (
          <polygon
            key={i}
            points={panel.points.map((p) => p.join(',')).join(' ')}
            fill={panel.tone}
            stroke="#3a342c"
            strokeOpacity={0.55}
            strokeWidth={0.6}
            strokeLinejoin="round"
          />
        ))}
      </g>
      <g className="pr-dim">
        <line x1={x0} x2={x1} y1={dimY} y2={dimY} />
        <line x1={x0} x2={x0} y1={y1 + 4} y2={dimY + 5} />
        <line x1={x1} x2={x1} y1={y1 + 4} y2={dimY + 5} />
        <text x={(x0 + x1) / 2} y={dimY}>
          {mm(size[0])}
        </text>
        <line x1={dimX} x2={dimX} y1={y0} y2={y1} />
        <line x1={dimX - 5} x2={x0 - 4} y1={y0} y2={y0} />
        <line x1={dimX - 5} x2={x0 - 4} y1={y1} y2={y1} />
        <text x={dimX} y={(y0 + y1) / 2} transform={`rotate(-90 ${dimX} ${(y0 + y1) / 2})`}>
          {mm(size[1])}
        </text>
      </g>
    </svg>
  );
}
