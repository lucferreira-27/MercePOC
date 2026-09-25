'use client';
import { useEffect, useState } from 'react';

/**
 * O robô mercenário da Merce, em pixel art, trabalhando numa bancada enquanto
 * a IA pensa: martela, serra ou fura. Poucos quadros por segundo, de propósito:
 * o indicador antigo girava rápido e distraía. A cena muda a cada tantos
 * ciclos, e a luz da antena pisca quando chega algo do provedor (`beat`).
 */
const W = 40;
const H = 24;

const C = {
  line: '#1b1f22',
  steel: '#c3cad0',
  steelDark: '#8b959d',
  visor: '#1f2a30',
  eye: '#ff5a4e',
  eyeHi: '#ffb4ad',
  band: '#3fae78',
  bandDark: '#2b7c55',
  plate: '#3fae78',
  belt: '#6b4526',
  gold: '#f2c14e',
  wood: '#d9a66a',
  woodHi: '#ecc48f',
  woodDark: '#a5743f',
  bench: '#8a5a2e',
  benchDark: '#6a431f',
  tool: '#aab4bc',
  handle: '#7a4a24',
  drill: '#f0a53a',
  drillDark: '#c47d1c',
  spark: '#ffd166',
  dust: '#e9c795',
  shadow: 'rgba(0,0,0,0.22)',
};

type Px = [x: number, y: number, w: number, h: number, color: string];
type Frame = { ms: number; px: Px[]; blink?: boolean; tail?: 0 | 1 };

/** Robô parado; o braço da frente e a ferramenta vêm de cada cena. */
function robot(blink: boolean, tail: 0 | 1): Px[] {
  return [
    [4, 23, 12, 1, C.shadow],
    // Antena (a ponta é desenhada à parte, para piscar).
    [9, 1, 1, 2, C.steelDark],
    // Cabeça com contorno.
    [5, 3, 10, 8, C.line],
    [6, 4, 8, 6, C.steel],
    [6, 9, 8, 1, C.steelDark],
    // Bandana com o nó atrás e as pontas ao vento.
    [5, 4, 10, 2, C.band],
    [5, 5, 10, 1, C.bandDark],
    [4, 4, 1, 2, C.band],
    ...(tail ? ([[2, 4, 2, 1, C.band], [1, 5, 2, 1, C.bandDark]] as Px[]) : ([[2, 5, 2, 1, C.band], [1, 6, 2, 1, C.bandDark]] as Px[])),
    // Visor e o olho único.
    [7, 6, 7, 2, C.visor],
    ...(blink ? ([[11, 7, 2, 1, C.eye]] as Px[]) : ([[11, 6, 2, 2, C.eye], [12, 6, 1, 1, C.eyeHi]] as Px[])),
    // Cicatriz e boca.
    [7, 8, 1, 1, C.steelDark],
    [9, 9, 3, 1, C.line],
    // Pescoço, corpo, placa do peito, cinto de ferramentas.
    [8, 11, 4, 1, C.steelDark],
    [5, 12, 10, 7, C.line],
    [6, 13, 8, 5, C.steel],
    [7, 14, 3, 2, C.plate],
    [6, 17, 8, 1, C.belt],
    [9, 17, 1, 1, C.gold],
    [12, 17, 1, 2, C.tool],
    // Braço de trás, pernas e botas.
    [4, 13, 1, 4, C.steelDark],
    [7, 19, 2, 3, C.steelDark],
    [11, 19, 2, 3, C.steelDark],
    [6, 22, 4, 1, C.line],
    [10, 22, 4, 1, C.line],
  ];
}

const bench = (): Px[] => [
  [17, 17, 20, 2, C.bench],
  [17, 18, 20, 1, C.benchDark],
  [18, 19, 2, 4, C.benchDark],
  [34, 19, 2, 4, C.benchDark],
  [17, 23, 20, 1, C.shadow],
];

/** Martelo: sobe, desce, faísca, e o prego afunda um pouco a cada batida. */
function hammer(): Frame[] {
  const frames: Frame[] = [];
  const plank: Px[] = [
    [19, 15, 14, 2, C.wood],
    [21, 15, 3, 1, C.woodHi],
    [28, 16, 3, 1, C.woodDark],
  ];
  const nail = (top: number): Px[] => [
    [22, top, 3, 1, C.tool],
    [23, top + 1, 1, 14 - top, C.steelDark],
  ];
  [12, 13].forEach((top, i) => {
    const base = [...bench(), ...plank, ...nail(top)];
    frames.push({
      ms: 420,
      blink: i === 1,
      tail: 0,
      px: [
        ...base,
        [15, 12, 1, 1, C.steelDark],
        [15, 11, 1, 1, C.steelDark],
        [16, 10, 1, 1, C.steelDark],
        [17, 8, 1, 2, C.handle],
        [18, 7, 1, 1, C.handle],
        [18, 4, 3, 3, C.line],
        [19, 5, 1, 1, C.tool],
      ],
    });
    frames.push({
      ms: 140,
      tail: 1,
      px: [
        ...base,
        [15, 12, 1, 1, C.steelDark],
        [16, 11, 1, 1, C.steelDark],
        [17, 10, 2, 1, C.handle],
        [19, 9, 1, 1, C.handle],
        [20, 7, 3, 3, C.line],
        [21, 8, 1, 1, C.tool],
      ],
    });
    frames.push({
      ms: 240,
      tail: 1,
      px: [
        ...base,
        [15, 12, 1, 1, C.steelDark],
        [16, 11, 1, 1, C.steelDark],
        [17, top - 2, 4, 1, C.handle],
        [21, top - 3, 3, 3, C.line],
        [22, top - 2, 1, 1, C.tool],
        [20, top - 1, 1, 1, C.spark],
        [25, top - 1, 1, 1, C.spark],
        [25, top - 4, 1, 1, C.spark],
        [26, top - 2, 1, 1, C.spark],
      ],
    });
    frames.push({
      ms: 300,
      tail: 0,
      px: [
        ...bench(),
        ...plank,
        ...nail(top + 1),
        [15, 12, 1, 1, C.steelDark],
        [16, 11, 1, 1, C.steelDark],
        [17, top - 3, 4, 1, C.handle],
        [21, top - 5, 3, 3, C.line],
        [22, top - 4, 1, 1, C.tool],
      ],
    });
  });
  return frames;
}

/** Serrote: vai e volta sobre a tábua, e a serragem cai embaixo do corte. */
function saw(): Frame[] {
  const board: Px[] = [
    [19, 15, 18, 2, C.wood],
    [21, 15, 4, 1, C.woodHi],
    [31, 16, 3, 1, C.woodDark],
    [28, 15, 1, 2, C.woodDark],
  ];
  return [0, 2, 4, 2].map((o, f) => ({
    ms: 260,
    blink: f === 3,
    tail: (f % 2) as 0 | 1,
    px: [
      ...bench(),
      ...board,
      // Braço até o cabo, cabo, lâmina e dentes.
      [15, 13, 1 + o, 1, C.steelDark],
      [16 + o, 12, 3, 3, C.handle],
      [17 + o, 13, 1, 1, C.benchDark],
      [19 + o, 13, 9, 1, C.tool],
      [19 + o, 14, 9, 1, C.steelDark],
      ...[0, 2, 4, 6, 8].map((t): Px => [19 + o + t, 14, 1, 1, C.tool]),
      // Serragem caindo e o montinho no chão.
      [28, 18 + (f % 3), 1, 1, C.dust],
      [27, 20 + ((f + 1) % 3), 1, 1, C.dust],
      [29, 19 + ((f + 2) % 3), 1, 1, C.dust],
      [26, 23, 5, 1, C.dust],
    ],
  }));
}

/** Furadeira: a broca gira contra a lateral do armário e solta lascas. */
function drill(): Frame[] {
  const panel: Px[] = [
    [26, 5, 4, 17, C.line],
    [27, 6, 2, 15, C.wood],
    [27, 8, 1, 3, C.woodHi],
    [28, 15, 1, 4, C.woodDark],
    [24, 22, 8, 1, C.shadow],
  ];
  return [0, 1, 2, 3].map((f) => ({
    ms: 200,
    blink: f === 2,
    tail: (f % 2) as 0 | 1,
    px: [
      ...panel,
      [15, 13, 3, 1, C.steelDark],
      // Corpo, cabo e mandril.
      [17, 10, 6, 3, C.drill],
      [17, 12, 6, 1, C.drillDark],
      [18, 13, 2, 3, C.drillDark],
      [23, 11, 1, 1, C.line],
      // Broca girando: os pontos claros trocam de lugar.
      [24, 11, 3, 1, C.steelDark],
      [24 + (f % 2), 11, 1, 1, C.tool],
      [26 - (f % 2), 11, 1, 1, C.tool],
      // Lascas voando para trás.
      [25 - f, 9 + (f % 2), 1, 1, C.dust],
      [24 - ((f + 2) % 4), 13 + ((f + 1) % 2), 1, 1, C.dust],
      [23, 20 + (f % 2), 2, 1, C.dust],
    ],
  }));
}

const SCENES = [hammer(), saw(), drill()];
/** Ciclos de uma cena antes de trocar para a próxima. */
const LOOPS_PER_SCENE = 3;

export function PixelMascot({ beat = 0, size = 2 }: { beat?: number; size?: number }) {
  const [scene, setScene] = useState(() => Math.floor(Math.random() * SCENES.length));
  const [frame, setFrame] = useState(0);
  const [loops, setLoops] = useState(0);
  const [still, setStill] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setStill(q.matches);
    sync();
    q.addEventListener('change', sync);
    return () => q.removeEventListener('change', sync);
  }, []);
  const frames = SCENES[scene];
  const current = frames[Math.min(frame, frames.length - 1)];
  useEffect(() => {
    if (still) return;
    const t = setTimeout(() => {
      if (frame + 1 < frames.length) {
        setFrame(frame + 1);
        return;
      }
      setFrame(0);
      if (loops + 1 >= LOOPS_PER_SCENE) {
        setLoops(0);
        setScene((s) => (s + 1) % SCENES.length);
      } else setLoops(loops + 1);
    }, current.ms);
    return () => clearTimeout(t);
  }, [frame, frames.length, current.ms, loops, still]);
  const px = [...robot(!!current.blink && !still, current.tail ?? 0), ...current.px];
  return (
    <svg
      className="pixel-mascot"
      viewBox={`0 0 ${W} ${H}`}
      width={W * size}
      height={H * size}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {px.map(([x, y, w, h, c], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={c} />
      ))}
      {/* Luz da antena: remonta a cada pulso do provedor e dá uma piscada. */}
      <rect key={beat} className="pm-beacon" x={9} y={0} width={1} height={1} fill={C.eye} />
    </svg>
  );
}
