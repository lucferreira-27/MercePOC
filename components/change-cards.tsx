'use client';
import type { ChangeHighlight } from '@/lib/progress';

/**
 * Desenho isométrico do módulo a partir das medidas reais: três faces com
 * sombra diferente, proporção preservada e o maior lado ocupando a caixa. É
 * SVG puro de propósito: aparece em qualquer navegador (WebGL inclusive) e não
 * custa uma renderização 3D por mensagem.
 */
function ModuleSketch({ size, box = 84 }: { size: [number, number, number]; box?: number }) {
  const [width, height, depth] = size;
  const scale = box / Math.max(width, height, depth, 1);
  const w = width * scale;
  const h = height * scale;
  const d = depth * scale;
  const cos = Math.cos(Math.PI / 6);
  const sin = Math.sin(Math.PI / 6);
  const project = (x: number, y: number, z: number): [number, number] => [
    (x - z) * cos,
    (x + z) * sin - y,
  ];
  const faces: { points: [number, number][]; fill: string }[] = [
    {
      // topo
      points: [project(0, h, 0), project(w, h, 0), project(w, h, d), project(0, h, d)],
      fill: '#eef4e6',
    },
    {
      // lateral direita
      points: [project(w, 0, 0), project(w, 0, d), project(w, h, d), project(w, h, 0)],
      fill: '#e0e9d5',
    },
    {
      // frente
      points: [project(0, 0, 0), project(w, 0, 0), project(w, h, 0), project(0, h, 0)],
      fill: '#f5f8f1',
    },
  ];
  const todos = faces.flatMap((face) => face.points);
  const minX = Math.min(...todos.map((p) => p[0]));
  const maxX = Math.max(...todos.map((p) => p[0]));
  const minY = Math.min(...todos.map((p) => p[1]));
  const maxY = Math.max(...todos.map((p) => p[1]));
  const pad = 5;
  return (
    <svg
      className="change-card-sketch"
      viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`}
      role="img"
      aria-label={`Módulo de ${width} por ${height} por ${depth} milímetros`}
      width="96"
      height="96"
    >
      {faces.map((face) => (
        <polygon
          key={face.fill}
          points={face.points.map((p) => p.join(',')).join(' ')}
          fill={face.fill}
          stroke="#8aa872"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/**
 * O resultado do turno como conteúdo principal: título, o que aconteceu, as
 * medidas do que mudou e os fatos que interessam.
 *
 * Quando o lote repete a mesma mudança em vários alvos, o cartão agrupa e
 * desenha uma barra proporcional por linha: três divisões com o mesmo vão de um
 * lado e restos diferentes (1296, 828 e 360 mm) ficam visivelmente diferentes,
 * em vez de três cartões idênticos.
 */
export function ChangeCards({ highlights }: { highlights: ChangeHighlight[] }) {
  return (
    <div className="change-cards">
      {highlights.map((card, i) => (
        <article className="change-card" key={`${card.tool}-${i}`}>
          <strong>{card.title}</strong>
          <p>{card.summary}</p>
          {card.rows && card.rows.length > 0 && (
            <ul className="change-card-rows">
              {card.rows.map((row, r) => (
                <li className="change-card-row" key={`${row.label}-${r}`}>
                  <span className="change-row-label">{row.label}</span>
                  <span className="change-row-value">{row.value}</span>
                  {row.parts && row.parts.length > 1 && (
                    <span className="change-row-bar" aria-hidden="true">
                      {row.parts.map((part, p) => (
                        <span
                          key={p}
                          className={p === 0 ? 'seg first' : 'seg'}
                          style={{ flexGrow: part }}
                        />
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {(card.size || card.measures || card.facts) && (
            <div className="change-card-body">
              {card.size && <ModuleSketch size={card.size} />}
              <div className="change-card-data">
                {card.measures && card.measures.length > 0 && (
                  <dl className="change-card-measures">
                    {card.measures.map((m) => (
                      <div key={m.label}>
                        <dt>{m.label}</dt>
                        <dd>{m.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {card.facts && card.facts.length > 0 && (
                  <dl className="change-card-facts">
                    {card.facts.map((f) => (
                      <div key={f.label}>
                        <dt>{f.label}</dt>
                        <dd>{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
