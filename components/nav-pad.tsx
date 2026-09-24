'use client';
import { useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Minimize2, Move, Rotate3d } from 'lucide-react';

export type NavMode = 'orbit' | 'pan';
/** Raio do curso do botão central, em px: empurrar até a borda é velocidade máxima. */
const REACH = 30;
/** Um toque pelo teclado (Enter/Espaço numa seta) anda por este tempo. */
const TAP_MS = 220;

const ARROWS = [
  { dir: 'up', x: 0, y: -1, icon: <ChevronUp size={15} />, orbit: 'Girar para cima', pan: 'Mover para cima' },
  { dir: 'down', x: 0, y: 1, icon: <ChevronDown size={15} />, orbit: 'Girar para baixo', pan: 'Mover para baixo' },
  { dir: 'left', x: -1, y: 0, icon: <ChevronLeft size={15} />, orbit: 'Girar para a esquerda', pan: 'Mover para a esquerda' },
  { dir: 'right', x: 1, y: 0, icon: <ChevronRight size={15} />, orbit: 'Girar para a direita', pan: 'Mover para a direita' },
] as const;

/**
 * Controle de movimento da cena, no canto do estúdio: um direcional com um
 * botão central que se arrasta como um joystick (quanto mais longe do centro,
 * mais rápido) e setas que andam enquanto ficam pressionadas. O modo decide o
 * que o direcional e o arrasto com o botão esquerdo no 3D fazem: girar em
 * volta do móvel ou mover a vista de lado.
 *
 * `onDrive` recebe a direção na tela, de -1 a 1 (y cresce para baixo); 0, 0
 * para o movimento.
 */
export function NavPad({
  mode,
  onMode,
  onDrive,
}: {
  mode: NavMode;
  onMode: (mode: NavMode) => void;
  onDrive: (x: number, y: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem('merce.navpad') === 'closed';
    } catch {
      return false;
    }
  });
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const ring = useRef<HTMLDivElement>(null);
  // Arrastando agora: ref, e não o estado, porque o primeiro pointermove pode
  // chegar antes do React desenhar o pointerdown.
  const dragging = useRef(false);
  const collapse = (value: boolean) => {
    setCollapsed(value);
    try {
      window.localStorage.setItem('merce.navpad', value ? 'closed' : 'open');
    } catch {
      // Sem armazenamento o controle só não lembra da escolha.
    }
  };
  const steer = (e: React.PointerEvent) => {
    const box = ring.current?.getBoundingClientRect();
    if (!box) return;
    let x = e.clientX - (box.left + box.width / 2);
    let y = e.clientY - (box.top + box.height / 2);
    const length = Math.hypot(x, y);
    if (length > REACH) {
      x = (x / length) * REACH;
      y = (y / length) * REACH;
    }
    setKnob({ x, y });
    onDrive(x / REACH, y / REACH);
  };
  /** Segura o ponteiro no controle mesmo saindo dele; sem suporte, segue sem. */
  const capture = (e: React.PointerEvent<HTMLElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ponteiro que já terminou: o movimento para no próximo pointerup.
    }
  };
  const release = () => {
    dragging.current = false;
    setKnob(null);
    onDrive(0, 0);
  };
  if (collapsed)
    return (
      <button
        type="button"
        className="nav-pad-open"
        onClick={() => collapse(false)}
        title="Mostrar o controle de movimento"
        aria-label="Mostrar o controle de movimento"
      >
        <Move size={17} />
      </button>
    );
  const label = mode === 'pan' ? 'pan' : 'orbit';
  return (
    <fieldset className="nav-pad">
      <legend className="sr-only">Controle de movimento da vista</legend>
      <div
        ref={ring}
        className={'nav-ring' + (knob ? ' driving' : '')}
        title="Arraste o centro para mover a vista. Setas do teclado também funcionam (Shift troca girar e mover)."
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button') || e.button !== 0) return;
          capture(e);
          dragging.current = true;
          steer(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current) steer(e);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={() => dragging.current && release()}
      >
        {ARROWS.map((a) => (
          <button
            key={a.dir}
            type="button"
            className={'nav-arrow ' + a.dir}
            aria-label={a[label]}
            title={a[label]}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              capture(e);
              onDrive(a.x * 0.7, a.y * 0.7);
            }}
            onPointerUp={() => onDrive(0, 0)}
            onPointerCancel={() => onDrive(0, 0)}
            onClick={(e) => {
              // Enter ou Espaço: um passo curto, já que não há "segurar".
              if (e.detail !== 0) return;
              onDrive(a.x * 0.7, a.y * 0.7);
              setTimeout(() => onDrive(0, 0), TAP_MS);
            }}
          >
            {a.icon}
          </button>
        ))}
        <span
          className="nav-knob"
          aria-hidden="true"
          style={knob ? { transform: `translate(${knob.x}px, ${knob.y}px)` } : undefined}
        >
          {mode === 'pan' ? <Move size={14} /> : <Rotate3d size={14} />}
        </span>
      </div>
      <div className="nav-modes">
        <button
          type="button"
          aria-pressed={mode === 'orbit'}
          className={mode === 'orbit' ? 'active' : ''}
          onClick={() => onMode('orbit')}
          title="Girar em volta do móvel (M alterna)"
        >
          <Rotate3d size={13} /> Girar
        </button>
        <button
          type="button"
          aria-pressed={mode === 'pan'}
          className={mode === 'pan' ? 'active' : ''}
          onClick={() => onMode('pan')}
          title="Mover a vista de lado, arrastando com o botão esquerdo (M alterna)"
        >
          <Move size={13} /> Mover
        </button>
      </div>
      <button
        type="button"
        className="nav-pad-close"
        onClick={() => collapse(true)}
        title="Recolher o controle"
        aria-label="Recolher o controle de movimento"
      >
        <Minimize2 size={11} />
      </button>
    </fieldset>
  );
}
