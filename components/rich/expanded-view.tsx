'use client';
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Janela grande no centro, por cima da conversa: o editor ou a prévia que um
 * cartão abriu. A conversa continua à vista atrás (fundo só escurecido), Esc
 * fecha, o foco fica preso aqui dentro enquanto ela está aberta e volta para
 * quem abriu ao fechar. Em tela pequena ela ocupa a tela inteira.
 *
 * `size`: `doc` (leitor de documento), `form` (editor de uma coluna),
 * `wide` (editor com desenho grande),
 * `media` (imagem e vídeo), `scene` (a cena 3D, que a página põe por cima).
 */
export function ExpandedView({
  title,
  subtitle,
  size = 'wide',
  actions,
  onClose,
  children,
  bodyClass = '',
}: {
  title: string;
  subtitle?: React.ReactNode;
  size?: 'doc' | 'form' | 'wide' | 'media' | 'scene';
  actions?: React.ReactNode;
  onClose: () => void;
  children?: React.ReactNode;
  bodyClass?: string;
}) {
  const box = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  const titleId = useId();
  useEffect(() => {
    const el = box.current;
    // Foco no primeiro controle do conteúdo; sem nenhum, no botão de fechar.
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('.xv-close');
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      // Outra janela por cima (a chapa ampliada, a confirmação de versão):
      // as teclas são dela.
      const open = document.querySelectorAll('dialog[open]');
      if (open[open.length - 1] !== el) return;
      if (e.key === 'Escape') {
        // Fechar não perde nada: o que se edita aqui (o rascunho do
        // orçamento) mora na página, não na janela.
        e.stopPropagation();
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), video[controls], audio[controls], iframe')].filter(
        (v) => v.offsetParent !== null || v === document.activeElement,
      );
      if (!items.length) return;
      const firstItem = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === firstItem || !el.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <div
      className={'modal-backdrop centered xv-backdrop' + (size === 'scene' ? ' scene' : '')}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <dialog open ref={box} className={`modal xv xv-${size}`} aria-modal="true" aria-labelledby={titleId}>
        <header className="xv-head">
          <div className="xv-title">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="xv-actions">{actions}</div>}
          <button type="button" className="icon-button xv-close" aria-label="Fechar (Esc)" title="Fechar (Esc)" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className={'xv-body ' + bodyClass}>{children}</div>
      </dialog>
    </div>
  );
}
