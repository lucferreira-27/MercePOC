'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Minimize2,
  Move,
  RotateCw,
} from 'lucide-react';

export type NudgeDir = 'left' | 'right' | 'back' | 'front' | 'up' | 'down';
/** Segurar uma seta: o primeiro passo sai na hora, os seguintes depois disto. */
const HOLD_DELAY = 320;
const HOLD_EVERY = 70;

const PAD: { dir: NudgeDir; className: string; label: string; icon: React.ReactNode }[] = [
  { dir: 'back', className: 'up', label: 'Para o fundo', icon: <ChevronUp size={15} /> },
  { dir: 'front', className: 'down', label: 'Para a frente', icon: <ChevronDown size={15} /> },
  { dir: 'left', className: 'left', label: 'Para a esquerda', icon: <ChevronLeft size={15} /> },
  { dir: 'right', className: 'right', label: 'Para a direita', icon: <ChevronRight size={15} /> },
];

/**
 * Controle para mover o móvel selecionado sem arrastar: setas andam 1 cm
 * (10 cm com Shift) e repetem enquanto seguradas, "Subir" e "Descer" levam
 * o móvel na altura (aéreos e painéis) e o centro gira 90°. O arrasto direto
 * na cena faz o mesmo com o mouse; este controle é para o ajuste fino.
 *
 * As setas seguem a câmera: "para a direita" é a direita de quem olha.
 */
export function MovePad({
  target,
  disabled,
  status,
  onNudge,
  onRotate,
}: {
  /** Nome do conjunto selecionado; sem seleção, o controle só ensina o gesto. */
  target: string | null;
  disabled: boolean;
  status: { text: string; bad?: boolean } | null;
  onNudge: (dir: NudgeDir, big: boolean) => void;
  onRotate: () => void;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem('merce.movepad') === 'closed';
    } catch {
      return false;
    }
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const collapse = (value: boolean) => {
    setCollapsed(value);
    try {
      window.localStorage.setItem('merce.movepad', value ? 'closed' : 'open');
    } catch {
      // Sem armazenamento o controle só não lembra da escolha.
    }
  };
  const hold = (dir: NudgeDir, big: boolean) => {
    stop();
    onNudge(dir, big);
    const repeat = () => {
      onNudge(dir, big);
      timer.current = setTimeout(repeat, HOLD_EVERY);
    };
    timer.current = setTimeout(repeat, HOLD_DELAY);
  };
  const arrow = (dir: NudgeDir, className: string, label: string, icon: React.ReactNode) => (
    <button
      key={dir}
      type="button"
      className={className}
      disabled={disabled || !target}
      aria-label={label}
      title={`${label} (seta do teclado; Shift anda 10 cm)`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        hold(dir, e.shiftKey);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={(e) => {
        // Enter ou Espaço: um passo, já que pelo teclado não há "segurar".
        if (e.detail === 0) onNudge(dir, e.shiftKey);
      }}
    >
      {icon}
    </button>
  );
  if (collapsed)
    return (
      <button
        type="button"
        className="move-pad-open"
        onClick={() => collapse(false)}
        title="Mostrar o controle para mover o móvel"
        aria-label="Mostrar o controle para mover o móvel"
      >
        <Move size={17} />
      </button>
    );
  return (
    <fieldset className={'move-pad' + (target ? '' : ' idle')}>
      <legend className="move-pad-title">
        <Move size={13} aria-hidden="true" />
        {target ? (
          <>
            Mover <b title={target}>{target}</b>
          </>
        ) : (
          'Mover móvel'
        )}
      </legend>
      {target ? (
        <>
          <div className="move-pad-body">
            <div className="move-ring">
              {PAD.map((a) => arrow(a.dir, 'move-arrow ' + a.className, a.label, a.icon))}
              <button
                type="button"
                className="move-rotate"
                disabled={disabled}
                onClick={onRotate}
                aria-label="Girar 90°"
                title="Girar 90° no lugar"
              >
                <RotateCw size={15} />
              </button>
            </div>
            <div className="move-lift">
              {arrow('up', 'move-arrow', 'Subir', <ArrowUpToLine size={14} />)}
              {arrow('down', 'move-arrow', 'Descer', <ArrowDownToLine size={14} />)}
            </div>
          </div>
          <output className={'move-status' + (status?.bad ? ' bad' : '')}>
            {status?.text ?? 'Ou arraste o móvel na cena'}
          </output>
        </>
      ) : (
        <p className="move-hint">Selecione um móvel e arraste-o na cena para mudar o lugar dele.</p>
      )}
      <button
        type="button"
        className="move-pad-close"
        onClick={() => collapse(true)}
        title="Recolher o controle"
        aria-label="Recolher o controle para mover o móvel"
      >
        <Minimize2 size={11} />
      </button>
    </fieldset>
  );
}
