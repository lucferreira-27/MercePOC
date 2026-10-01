'use client';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { assetById, buildAsset } from '@/lib/assets';
import type { ModularPart } from '@/lib/composition';
import { drawingParts } from '@/lib/fittings';
import { STYLE_IDS, type StyleId } from '@/lib/look';
import { searchStyles, STYLE_FAMILIES, STYLES, styleChips, styleSwatch } from '@/lib/styles';
import { PlanThumb } from './plan-thumb';
import { Button } from './ui/button';

/** Amostra redonda do estilo: o corpo e a cor que marca o estilo. */
export function StyleSwatch({ style }: { style: StyleId }) {
  const [body, accent] = styleSwatch(style);
  return <span className="style-swatch" aria-hidden="true" style={{ background: `linear-gradient(135deg, ${body} 0 55%, ${accent} 55% 100%)` }} />;
}

/**
 * Desenho de referência de cada estilo: o mesmo aparador, montado pelo motor
 * no estilo. Vale mais que o nome para comparar base, puxador e frente; fica
 * guardado depois do primeiro desenho. Desenha grande e o CSS reduz: a margem
 * do desenho é fixa, numa caixa pequena o móvel sumia.
 */
const thumbs = new Map<string, readonly ModularPart[]>();
function thumbParts(style: StyleId | null) {
  const key = style ?? 'livre';
  let parts = thumbs.get(key);
  if (!parts) {
    try {
      parts = drawingParts(buildAsset(assetById('aparador')!, { width: 1300, ...(style ? { style } : {}) }));
    } catch {
      parts = [];
    }
    thumbs.set(key, parts);
  }
  return parts;
}

/**
 * Todos os estilos, em cartões com o desenho de referência, agrupados por
 * família e com busca (nome, dica e as palavras da pessoa: "nórdico" acha o
 * escandinavo). Serve ao painel do projeto e à galeria, e cresce sem virar
 * uma fileira sem fim. `none` dá a opção de montar sem estilo.
 */
export function StyleGrid({
  value,
  onPick,
  none,
  disabled,
  label = 'Estilos',
  autoFocus,
}: {
  value: StyleId | null;
  onPick: (style: StyleId | null) => void;
  none?: string;
  disabled?: boolean;
  label?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  // Foco na busca só com mouse: no celular, abriria o teclado por cima dos cartões.
  useEffect(() => {
    if (autoFocus && window.matchMedia('(pointer: fine)').matches) search.current?.focus();
  }, [autoFocus]);
  const q = query.trim();
  const found = useMemo(() => new Set(searchStyles(q)), [q]);
  const families = STYLE_FAMILIES.map((f) => ({ ...f, ids: STYLE_IDS.filter((id) => STYLES[id].family === f.id && found.has(id)) })).filter((f) => f.ids.length);
  return (
    <div className="style-grid" role="group" aria-label={label}>
      <div className="style-grid-head">
        <label className="style-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={search}
            type="search"
            value={query}
            placeholder="Buscar estilo: boho, nórdico, latão…"
            aria-label="Buscar estilo"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {none && (
          <button type="button" className={`style-none${value === null ? ' active' : ''}`} aria-pressed={value === null} disabled={disabled} onClick={() => onPick(null)}>
            {value === null && <Check size={13} aria-hidden="true" />}
            {none}
          </button>
        )}
      </div>
      {families.map((f) => (
        <section key={f.id} className="style-family" aria-label={f.name}>
          <h4>{f.name}</h4>
          <div className="style-cards">
            {f.ids.map((id) => (
              <button
                type="button"
                key={id}
                className={`style-card${value === id ? ' active' : ''}`}
                aria-pressed={value === id}
                disabled={disabled}
                title={STYLES[id].summary}
                onClick={() => onPick(id)}
              >
                <span className="style-card-art">
                  <PlanThumb parts={thumbParts(id)} width={360} height={200} />
                </span>
                <span className="style-card-name">
                  <StyleSwatch style={id} />
                  {STYLES[id].name}
                  {value === id && <Check size={13} className="style-card-check" aria-hidden="true" />}
                </span>
                <small>{STYLES[id].hint}</small>
              </button>
            ))}
          </div>
        </section>
      ))}
      {!families.length && <p className="style-empty">Nenhum estilo com “{q}”. Descreva na conversa o que imagina.</p>}
    </div>
  );
}

/**
 * Estilo da galeria: um botão com o escolhido que abre os cartões por cima
 * da lista de modelos. Esc e clique fora fecham só o seletor.
 */
export function StyleSelect({
  value,
  onChange,
  none,
  label = 'Estilo',
}: {
  value: StyleId | null;
  onChange: (style: StyleId | null) => void;
  none?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    // Em captura, antes da galeria: o Esc fecha o seletor, não a galeria.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div className="style-select" ref={root}>
      <button type="button" className={`style-select-trigger${value ? ' chosen' : ''}`} aria-expanded={open} aria-haspopup="dialog" aria-label={`${label}: ${value ? STYLES[value].name : (none ?? 'livre')}`} onClick={() => setOpen((v) => !v)}>
        {value && <StyleSwatch style={value} />}
        <span>{value ? STYLES[value].name : (none ?? 'Livre')}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="style-popover" role="dialog" aria-label={label}>
          <StyleGrid
            value={value}
            none={none}
            label={label}
            autoFocus
            onPick={(style) => {
              onChange(style);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

export type StyleScope = 'project' | 'piece';

/**
 * Estilo do projeto no painel: o estilo atual numa linha, com o desenho de
 * referência; "Trocar" abre os cartões ali mesmo. Escolher um estilo mostra
 * a prévia na cena (o móvel vestido, com orçamento) antes de gravar;
 * "Aplicar" grava como qualquer edição, com desfazer. Com um módulo
 * selecionado, dá para vestir só a peça dele (a fileira de painel
 * compartilhado vai junto).
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
  const [browsing, setBrowsing] = useState(false);
  const shown = preview ?? current ?? null;
  const target =
    scope === 'piece' && piece ? `em ${piece}${changed > 1 ? ` e na fileira dela (${changed} módulos com painel compartilhado)` : ''}` : 'no projeto todo';
  return (
    <section className="style-picker" aria-label="Estilo do projeto">
      <div className="section-label">
        <span>Estilo</span>
        {preview && current !== preview && <small>atual: {current ? STYLES[current].name : 'livre'}</small>}
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
      <button type="button" className={`style-current${browsing ? ' open' : ''}`} aria-expanded={browsing} disabled={busy} onClick={() => setBrowsing((v) => !v)}>
        <span className="style-current-art">
          <PlanThumb parts={thumbParts(shown)} width={320} height={200} />
        </span>
        <span className="style-current-text">
          <strong>
            {shown && <StyleSwatch style={shown} />}
            {shown ? STYLES[shown].name : 'Livre'}
          </strong>
          <small>{shown ? STYLES[shown].hint : 'Cada móvel como a receita monta'}</small>
        </span>
        <span className="style-current-action">
          {browsing ? 'Fechar' : shown ? 'Trocar' : 'Escolher'}
          <ChevronDown size={14} aria-hidden="true" />
        </span>
      </button>
      {browsing && (
        <StyleGrid
          value={shown}
          disabled={busy}
          label="Estilos do projeto"
          onPick={(style) => {
            if (!style) return;
            onPreview(style);
            setBrowsing(false);
          }}
        />
      )}
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
