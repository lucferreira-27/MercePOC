'use client';
import { useEffect, useMemo } from 'react';
import { FilePlus2, X } from 'lucide-react';
import { buildTemplate, templates } from '@/lib/templates';
import { generateComposition } from '@/lib/composition';
import { PlanThumb } from './plan-thumb';

/**
 * Começar um projeto: em branco (a estante de sempre) ou a partir de um
 * modelo. A miniatura é o desenho do modelo montado pelo motor, não uma
 * ilustração: o que aparece aqui é o que abre no estúdio.
 */
export function TemplateGallery({
  open,
  busy,
  onClose,
  onBlank,
  onPick,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onBlank: () => void;
  onPick: (id: string) => void;
}) {
  const previews = useMemo(
    () =>
      open
        ? templates.map((t) => {
            try {
              return { t, parts: generateComposition(buildTemplate(t)).parts };
            } catch {
              return { t, parts: [] };
            }
          })
        : [],
    [open],
  );
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <dialog open className="modal gallery" aria-modal="true" aria-labelledby="gallery-title">
        <header className="modal-head">
          <div>
            <span className="eyebrow">Novo projeto</span>
            <h2 id="gallery-title">Por onde começar?</h2>
            <p>Escolha um modelo pronto e ajuste pela conversa, ou comece do zero.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="gallery-grid">
          <button type="button" className="gallery-card blank" disabled={busy} onClick={onBlank}>
            <span className="gallery-art">
              <FilePlus2 size={30} strokeWidth={1.4} />
            </span>
            <strong>Em branco</strong>
            <small>Uma estante simples de 80 × 180 cm para começar do jeito que quiser</small>
          </button>
          {previews.map(({ t, parts }) => (
            <button type="button" className="gallery-card" key={t.id} disabled={busy} onClick={() => onPick(t.id)}>
              <span className="gallery-art">
                <PlanThumb parts={parts} width={260} height={170} />
              </span>
              <strong>{t.name}</strong>
              <small>{t.summary}</small>
              {t.room && <em className="tag">com quarto de exemplo</em>}
            </button>
          ))}
        </div>
      </dialog>
    </div>
  );
}
