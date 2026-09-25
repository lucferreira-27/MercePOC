'use client';
import { useEffect, useRef } from 'react';
import { GitBranch, History, Trash2 } from 'lucide-react';

export type BranchConfirmData = {
  /** Versão que está na tela, de onde a edição parte. */
  from: number;
  /** Número que a edição vai ganhar se descartar. */
  next: number;
  /** O que a pessoa pediu: "Moveu Porta esquerda + 1". */
  what: string;
  /** Versões que saem do histórico ao descartar. */
  lost: { number: number; label: string }[];
};

/**
 * Editar a partir de uma versão antiga apaga as seguintes. Janela no centro
 * da tela, por cima de tudo: a escolha entre abrir uma alternativa (nada se
 * perde) e descartar o futuro, com as versões que somem à vista.
 */
export function BranchConfirm({
  data,
  busy,
  onCancel,
  onFork,
  onDiscard,
}: {
  data: BranchConfirmData;
  busy: boolean;
  onCancel: () => void;
  onFork: () => void;
  onDiscard: () => void;
}) {
  const safe = useRef<HTMLButtonElement>(null);
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  });
  // Foco na opção que não perde nada; Esc cancela (antes dos outros atalhos).
  useEffect(() => {
    safe.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancel.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const count = data.lost.length;
  const first = data.lost[0]?.number;
  const last = data.lost.at(-1)?.number;
  const range = count === 1 ? `a versão ${first}` : `as versões ${first} a ${last}`;
  return (
    <div
      className="modal-backdrop centered"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <dialog open className="modal branch-confirm" aria-modal="true" aria-labelledby="bc-title" aria-describedby="bc-lead">
        <header className="bc-head">
          <span className="bc-icon" aria-hidden="true">
            <History size={18} />
          </span>
          <div>
            <span className="eyebrow">Editando uma versão antiga</span>
            <h2 id="bc-title">Continuar a partir da versão {data.from}?</h2>
          </div>
        </header>
        <p id="bc-lead" className="bc-lead">
          <b>{data.what}</b> vira a versão {data.next}. {count === 1 ? 'A versão que vinha' : `As ${count} versões que vinham`} depois
          deste ponto {count === 1 ? 'sai' : 'saem'} do histórico.
        </p>
        <section className="bc-lost" aria-label="Versões que saem do histórico">
          <span className="bc-lost-head">
            Saem do histórico <b>{count}</b>
          </span>
          <ol>
            {data.lost.map((v) => (
              <li key={v.number}>
                <span className="bc-num">v{v.number}</span>
                <span className="bc-label">{v.label}</span>
              </li>
            ))}
          </ol>
        </section>
        <div className="bc-choices">
          <button ref={safe} type="button" className="bc-choice keep" disabled={busy} onClick={onFork}>
            <span className="bc-choice-icon" aria-hidden="true">
              <GitBranch size={16} />
            </span>
            <span>
              <strong>
                Criar alternativa <em>nada se perde</em>
              </strong>
              <small>
                Abre uma cópia a partir da versão {data.from} para você refazer a mudança lá. Este projeto fica como está.
              </small>
            </span>
          </button>
          <button type="button" className="bc-choice drop" disabled={busy} onClick={onDiscard}>
            <span className="bc-choice-icon" aria-hidden="true">
              <Trash2 size={16} />
            </span>
            <span>
              <strong>Descartar e continuar</strong>
              <small>Aplica a mudança aqui e apaga {range}.</small>
            </span>
          </button>
        </div>
        <footer className="bc-foot">
          <button type="button" className="bc-cancel" onClick={onCancel}>
            Cancelar <kbd>Esc</kbd>
          </button>
        </footer>
      </dialog>
    </div>
  );
}
