'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Faixa de sugestões acima do campo: uma linha só, que rola de lado. As
 * setas aparecem quando há mais sugestões fora da vista (mouse sem rolagem
 * lateral também chega nelas); Tab também rola até o chip com foco.
 */
export function SuggestionStrip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges((v) => (v.left === left && v.right === right ? v : { left, right }));
  }, []);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  }, [measure, children]);
  const by = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.7, behavior: 'smooth' });
  return (
    <div className={'suggest-strip' + (edges.left ? ' more-left' : '') + (edges.right ? ' more-right' : '')}>
      {edges.left && (
        <button type="button" className="ss-arrow left" aria-label="Sugestões anteriores" tabIndex={-1} onClick={() => by(-1)}>
          <ChevronLeft size={14} />
        </button>
      )}
      <div className="suggestions" ref={row} onScroll={measure} aria-label={label}>
        {children}
      </div>
      {edges.right && (
        <button type="button" className="ss-arrow right" aria-label="Mais sugestões" tabIndex={-1} onClick={() => by(1)}>
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}
