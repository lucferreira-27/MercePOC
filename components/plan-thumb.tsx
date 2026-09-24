import { planView, type ViewKind } from '@/lib/plan-geometry';
import type { ModularPart } from '@/lib/composition';

/**
 * Miniatura em SVG do móvel, com o mesmo desenho que a IA confere. Serve para
 * galerias (modelos, projetos) sem abrir uma cena WebGL por cartão.
 */
export function PlanThumb({
  parts,
  view = 'iso',
  width = 220,
  height = 150,
}: {
  parts: readonly ModularPart[];
  view?: ViewKind;
  width?: number;
  height?: number;
}) {
  const g = planView(parts, view, { width, height });
  return (
    <svg className="plan-thumb" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {g.ground.length > 0 && (
        <polygon className="plan-thumb-ground" points={g.ground.map((p) => p.join(',')).join(' ')} />
      )}
      {g.panels.map((panel, i) => (
        <polygon
          key={i}
          points={panel.points.map((p) => p.join(',')).join(' ')}
          fill={panel.tone}
          stroke="rgba(40,32,24,.35)"
          strokeWidth={0.6}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
