'use client';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { CutSheet, Placement, SheetSpec } from '@/lib/cutplan';
import { materials } from '@/lib/furniture';

/** Rótulo dentro da peça: medidas de corte ou nome. O número aparece sempre que cabe. */
export type CutLabel = 'dims' | 'name';

export function pieceTone(materialId: string | null) {
  return materials.find((m) => m.id === materialId)?.color ?? '#d9d3c7';
}

/** "Coluna 1 / Lateral esquerda" → "Lateral esquerda": o módulo sobra na chapa. */
export function shortName(name: string) {
  return name.includes(' / ') ? name.split(' / ').slice(1).join(' / ') : name;
}

export function mmText(v: number) {
  return String(Math.round(v * 10) / 10).replace('.', ',');
}

/** Margem do desenho, em px de tela, para as réguas da chapa. */
const RULER_PX = 22;

/**
 * Uma chapa desenhada em escala, com réguas, refilo, veio, peças numeradas e
 * sobras. A mesma na aba Corte e no PDF: quem imprime vê o que viu na tela.
 *
 * O texto tem tamanho fixo em px: o desenho mede a própria largura e converte
 * para mm, então o rótulo não vira letreiro na janela ampliada nem some na
 * miniatura. `pxWidth` fixa a largura quando não há como medir (impressão).
 */
export function CutSheetDrawing({
  spec,
  sheet,
  label = 'dims',
  offcuts = true,
  selected = [],
  hovered = null,
  onPiece,
  onHover,
  pxWidth,
  print = false,
  title,
}: {
  spec: SheetSpec;
  sheet: CutSheet;
  label?: CutLabel;
  offcuts?: boolean;
  selected?: readonly string[];
  hovered?: string | null;
  onPiece?: (p: Placement, extend: boolean) => void;
  onHover?: (id: string | null) => void;
  pxWidth?: number;
  print?: boolean;
  title?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [measured, setMeasured] = useState(pxWidth ?? 320);
  useLayoutEffect(() => {
    if (pxWidth || !ref.current) return;
    const el = ref.current;
    const read = () => setMeasured(el.getBoundingClientRect().width || 320);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pxWidth]);
  const width = pxWidth ?? measured;
  const pad = RULER_PX;
  // mm por px: a chapa mais a margem da régua ocupam a largura toda.
  const u = spec.length / Math.max(width - pad - 4, 40);
  const m = pad * u;
  const vb = `${-m} ${-m} ${spec.length + m + 4 * u} ${spec.width + m + 4 * u}`;
  const hatch = useId().replace(/:/g, '');
  const font = 11 * u;
  const small = 9.5 * u;
  const tone = pieceTone(sheet.materialId);
  return (
    <svg
      ref={ref}
      className={'cut-drawing' + (print ? ' print' : '')}
      viewBox={vb}
      aria-label={title ?? `Chapa ${sheet.index} de ${sheet.material} ${sheet.thickness} mm`}
    >
      <defs>
        <pattern id={hatch} width={9 * u} height={9 * u} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={9 * u} className="cd-hatch" strokeWidth={1.2 * u} />
        </pattern>
      </defs>
      {/* Réguas: comprimento em cima, largura à esquerda. */}
      <g className="cd-ruler" strokeWidth={u}>
        <line x1={0} x2={spec.length} y1={-m / 2} y2={-m / 2} />
        <line x1={0} x2={0} y1={-m * 0.8} y2={-m * 0.2} />
        <line x1={spec.length} x2={spec.length} y1={-m * 0.8} y2={-m * 0.2} />
        <line y1={0} y2={spec.width} x1={-m / 2} x2={-m / 2} />
        <line y1={0} y2={0} x1={-m * 0.8} x2={-m * 0.2} />
        <line y1={spec.width} y2={spec.width} x1={-m * 0.8} x2={-m * 0.2} />
      </g>
      <text className="cd-ruler-text" x={spec.length / 2} y={-m / 2} fontSize={small} strokeWidth={6 * u}>
        {spec.length} mm
      </text>
      <text
        className="cd-ruler-text"
        x={-m / 2}
        y={spec.width / 2}
        fontSize={small}
        strokeWidth={6 * u}
        transform={`rotate(-90 ${-m / 2} ${spec.width / 2})`}
      >
        {spec.width} mm
      </text>
      <rect className="cd-sheet" x={0} y={0} width={spec.length} height={spec.width} strokeWidth={u} />
      <rect
        className="cd-trim"
        x={spec.trim}
        y={spec.trim}
        width={spec.length - 2 * spec.trim}
        height={spec.width - 2 * spec.trim}
        strokeWidth={u}
        strokeDasharray={`${4 * u} ${3 * u}`}
      />
      {offcuts &&
        sheet.offcuts.map((o, i) => {
          const text = `sobra ${Math.round(o.w)} × ${Math.round(o.h)}`;
          const fits = text.length * small * 0.56 + 8 * u < o.w && small * 1.8 < o.h;
          return (
            <g key={i} className="cd-offcut">
              <rect x={o.x} y={o.y} width={o.w} height={o.h} fill={`url(#${hatch})`} strokeWidth={u} />
              {fits && (
                <text x={o.x + o.w / 2} y={o.y + o.h / 2} fontSize={small}>
                  {text}
                </text>
              )}
            </g>
          );
        })}
      {sheet.placements.map((p) => (
        <Piece
          key={p.id}
          p={p}
          u={u}
          font={font}
          small={small}
          label={label}
          tone={tone}
          on={selected.includes(p.id)}
          hot={hovered === p.id}
          onPiece={onPiece}
          onHover={onHover}
        />
      ))}
      {sheet.grain && (
        <g className="cd-grain" transform={`translate(${spec.length - 8 * u} ${-m / 2})`}>
          <text x={-22 * u} y={0} fontSize={small} strokeWidth={5 * u}>
            veio
          </text>
          <path d={`M ${-18 * u} 0 H 0 M ${-5 * u} ${-3.5 * u} L 0 0 L ${-5 * u} ${3.5 * u}`} strokeWidth={1.3 * u} />
        </g>
      )}
    </svg>
  );
}

function Piece({
  p,
  u,
  font,
  small,
  label,
  tone,
  on,
  hot,
  onPiece,
  onHover,
}: {
  p: Placement;
  u: number;
  font: number;
  small: number;
  label: CutLabel;
  tone: string;
  on: boolean;
  hot: boolean;
  onPiece?: (p: Placement, extend: boolean) => void;
  onHover?: (id: string | null) => void;
}) {
  const main = label === 'name' ? shortName(p.name) : `${Math.round(p.w)} × ${Math.round(p.h)}`;
  const tag = String(p.n);
  // Largura aproximada do texto: 0,58 em por caractere na fonte da interface.
  const span = (text: string, size: number) => text.length * size * 0.58;
  const gap = 6 * u;
  const cx = p.x + p.w / 2,
    cy = p.y + p.h / 2;
  const tagW = span(tag, small) + 7 * u,
    tagH = small + 5 * u;
  const tagRight = p.x + 5 * u + tagW,
    tagBottom = p.y + 5 * u + tagH;
  const roomForTag = p.w > tagW + 8 * u && p.h > tagH + 8 * u;
  // Onde o rótulo cabe dentro de uma área da peça: deitado, ou em pé na peça
  // alta e estreita. Devolve o centro e se gira.
  const fit = (text: string, x0: number, y0: number, x1: number, y1: number) => {
    const long = span(text, font) + 2 * gap,
      thick = font * 1.5;
    if (long <= x1 - x0 && thick <= y1 - y0) return { text, upright: false, x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    if (long <= y1 - y0 && thick <= x1 - x0) return { text, upright: true, x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    return null;
  };
  const x1 = p.x + p.w,
    y1 = p.y + p.h;
  const centred = fit(main, p.x, p.y, x1, y1);
  // Rótulo no meio sem encostar no número do canto: vale se sobra margem à
  // esquerda do texto deitado ou acima do texto em pé.
  const clearOfTag = (t: NonNullable<typeof centred>) =>
    t.upright
      ? t.x - font * 0.75 >= tagRight || t.y - (span(t.text, font) / 2) >= tagBottom
      : t.x - span(t.text, font) / 2 >= tagRight || t.y - font * 0.75 >= tagBottom;
  // Número no canto e rótulo no meio; se colidem, o rótulo desce (ou vai para
  // a direita) do número; sem lugar, o número entra no rótulo; peça pequena
  // demais fica só com o número.
  let text: ReturnType<typeof fit> = null,
    cornerTag = false;
  if (roomForTag && centred && clearOfTag(centred)) {
    text = centred;
    cornerTag = true;
  } else if (roomForTag && (text = fit(main, p.x, tagBottom, x1, y1) ?? fit(main, tagRight, p.y, x1, y1))) {
    cornerTag = true;
  } else text = fit(`${tag} · ${main}`, p.x, p.y, x1, y1);
  const soloTag = !text && span(tag, font) + 4 * u <= p.w && font * 1.3 <= p.h;
  return (
    <g
      className={'cd-piece' + (on ? ' on' : '') + (hot ? ' hot' : '') + (onPiece ? ' live' : '')}
      style={{ '--piece': tone } as React.CSSProperties}
      onClick={onPiece ? (e) => onPiece(p, e.shiftKey) : undefined}
      onMouseEnter={onHover ? () => onHover(p.id) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
    >
      <title>
        {`${p.n}. ${shortName(p.name)} · ${mmText(p.w)} × ${mmText(p.h)} mm${p.rotated ? ' · girada' : ''}`}
      </title>
      <rect x={p.x} y={p.y} width={p.w} height={p.h} strokeWidth={(on ? 2.4 : hot ? 2 : 1) * u} />
      {hot && onPiece && (
        // "Corte aqui": o mesmo tracejado que aparece na peça do móvel.
        <path
          className="cd-cut"
          d={`M ${p.x + 2.5 * u} ${p.y + 2.5 * u} h ${Math.max(p.w - 5 * u, 0)} v ${Math.max(p.h - 5 * u, 0)} h ${-Math.max(p.w - 5 * u, 0)} Z`}
          strokeWidth={1.6 * u}
          strokeDasharray={`${5 * u} ${3 * u}`}
        />
      )}
      {text && (
        <text
          className="cd-label"
          x={text.x}
          y={text.y}
          fontSize={font}
          transform={text.upright ? `rotate(-90 ${text.x} ${text.y})` : undefined}
        >
          {text.text}
        </text>
      )}
      {cornerTag && (
        <g className="cd-tag">
          <rect
            x={p.x + 3 * u}
            y={p.y + 3 * u}
            width={span(tag, small) + 7 * u}
            height={small + 5 * u}
            rx={3 * u}
          />
          <text x={p.x + 3 * u + (span(tag, small) + 7 * u) / 2} y={p.y + 3 * u + (small + 5 * u) / 2} fontSize={small}>
            {tag}
          </text>
        </g>
      )}
      {soloTag && (
        <text className="cd-label strong" x={cx} y={cy} fontSize={font}>
          {tag}
        </text>
      )}
    </g>
  );
}
