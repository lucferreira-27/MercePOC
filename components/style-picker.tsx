'use client';
import { Check, X } from 'lucide-react';
import { STYLE_IDS, type StyleId } from '@/lib/look';
import { STYLES, styleChips, styleSwatch } from '@/lib/styles';
import { Button } from './ui/button';

/** Amostra redonda do estilo: o corpo e a cor que marca o estilo. */
export function StyleSwatch({ style }: { style: StyleId }) {
  const [body, accent] = styleSwatch(style);
  return <span className="style-swatch" aria-hidden="true" style={{ background: `linear-gradient(135deg, ${body} 0 55%, ${accent} 55% 100%)` }} />;
}

/**
 * Fileira de estilos (galeria e painel do projeto). `none` dá a opção de
 * montar sem estilo: o móvel como a receita sempre fez.
 */
export function StyleChips({
  value,
  onChange,
  none,
  disabled,
  label = 'Estilo',
}: {
  value: StyleId | null;
  onChange: (style: StyleId | null) => void;
  none?: string;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <fieldset className="style-chips" aria-label={label}>
      {none && (
        <button type="button" className={value === null ? 'active' : ''} aria-pressed={value === null} disabled={disabled} onClick={() => onChange(null)}>
          {none}
        </button>
      )}
      {STYLE_IDS.map((id) => (
        <button
          type="button"
          key={id}
          className={value === id ? 'active' : ''}
          aria-pressed={value === id}
          disabled={disabled}
          title={STYLES[id].summary}
          onClick={() => onChange(id)}
        >
          <StyleSwatch style={id} />
          {STYLES[id].name}
        </button>
      ))}
    </fieldset>
  );
}

export type StyleScope = 'project' | 'piece';

/**
 * Estilo do projeto no painel: escolher um estilo mostra a prévia na cena (o
 * móvel vestido, com orçamento) antes de gravar; "Aplicar" grava como
 * qualquer edição, com desfazer. Com um módulo selecionado, dá para vestir só
 * a peça dele (a fileira de painel compartilhado vai junto).
 */
export function StylePicker({
  current,
  piece,
  scope,
  onScope,
  preview,
  changed,
  error,
  busy,
  onPreview,
  onApply,
  onCancel,
}: {
  current?: StyleId;
  /** Nome do módulo selecionado, quando há um. */
  piece: string | null;
  scope: StyleScope;
  onScope: (scope: StyleScope) => void;
  preview: StyleId | null;
  /** Módulos que a prévia muda (a peça e a fileira de painel compartilhado dela). */
  changed: number;
  error: string;
  busy: boolean;
  onPreview: (style: StyleId) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const target =
    scope === 'piece' && piece ? `em ${piece}${changed > 1 ? ` e na fileira dela (${changed} módulos com painel compartilhado)` : ''}` : 'no projeto todo';
  return (
    <section className="style-picker" aria-label="Estilo do projeto">
      <div className="section-label">
        <span>Estilo</span>
        <small>{current ? STYLES[current].name : 'livre'}</small>
      </div>
      {piece && (
        <fieldset className="style-scope" aria-label="Vestir">
          <button type="button" className={scope === 'project' ? 'active' : ''} aria-pressed={scope === 'project'} disabled={busy} onClick={() => onScope('project')}>
            Projeto todo
          </button>
          <button type="button" className={scope === 'piece' ? 'active' : ''} aria-pressed={scope === 'piece'} disabled={busy} onClick={() => onScope('piece')} title={piece}>
            Só {piece}
          </button>
        </fieldset>
      )}
      <StyleChips value={preview} disabled={busy} onChange={(style) => (style ? onPreview(style) : onCancel())} />
      {preview && (
        <div className="style-preview" role="status">
          <p>
            <strong>Prévia: {STYLES[preview].name}</strong> {target}. As medidas por fora não mudam.
          </p>
          <ul>
            {styleChips(preview).map((chip) => (
              <li key={chip}>{chip}</li>
            ))}
          </ul>
          <div className="style-actions">
            <Button className="touch-target" disabled={busy} onClick={onApply}>
              <Check size={15} /> Aplicar estilo
            </Button>
            <Button className="touch-target" variant="outline" disabled={busy} onClick={onCancel}>
              <X size={15} /> Cancelar
            </Button>
          </div>
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
    </section>
  );
}
