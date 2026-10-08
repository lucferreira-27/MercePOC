'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Crosshair, Minus, Plus, RotateCcw, Undo2, X } from 'lucide-react';
import { addExtra, removeExtra, setQty, setRemoved, updateExtra } from '@/lib/quote-draft';
import { CATEGORY_INFO, materials, type MaterialCategory } from '@/lib/furniture';
import { DEFAULT_PRICES, HARDWARE, HARDWARE_KEYS, money, quantity, type HardwareKey, type PriceRef, type Prices, type Quote, type QuoteAdjust, type QuoteLine, type QuoteSection } from '@/lib/quote';

const SECTION_TONE: Record<QuoteSection, string> = {
  Chapas: 'var(--chart-1)',
  'Fita de borda': 'var(--chart-2)',
  Materiais: 'var(--chart-5)',
  Ferragens: 'var(--chart-3)',
  'Mão de obra': 'var(--chart-4)',
  Outros: 'var(--wood)',
};
const ORDER: QuoteSection[] = ['Chapas', 'Fita de borda', 'Materiais', 'Ferragens', 'Mão de obra', 'Outros'];
const SECTION_NAME = (s: QuoteSection) => (s === 'Outros' ? 'Itens à parte' : s);
const CATEGORIES: MaterialCategory[] = ['sheet', 'solid', 'stone', 'glass', 'metal', 'fiber'];
/** Ferragens da tabela, em grupos: pés e bases, puxadores, o resto. */
const HARDWARE_GROUPS: { label: string; keys: HardwareKey[] }[] = [
  { label: 'Pés e bases (unidade)', keys: HARDWARE_KEYS.filter((k) => k.startsWith('leg-')) },
  { label: 'Puxadores (unidade)', keys: HARDWARE_KEYS.filter((k) => k.startsWith('handle-')) },
  { label: 'LED, usinagem e serralheria', keys: HARDWARE_KEYS.filter((k) => !k.startsWith('leg-') && !k.startsWith('handle-')) },
];

/** Texto do orçamento para colar numa mensagem ao cliente. */
export function quoteText(name: string, q: Quote) {
  const lines = [`Orçamento estimado · ${name}`];
  for (const section of ORDER) {
    const items = q.lines.filter((l) => l.section === section);
    if (!items.length) continue;
    lines.push('', `${section}: ${money(items.reduce((a, l) => a + l.total, 0))}`);
    for (const l of items) lines.push(`  ${l.label}: ${quantity(l.qty)} ${l.unit} × ${money(l.unitPrice)} = ${money(l.total)}`);
  }
  lines.push(
    '',
    `Custo: ${money(q.cost)}`,
    `Margem: ${money(q.marginValue)}`,
    `Total: ${money(q.total)}`,
    '',
    'Estimativa gerada no Merce. Confirme medidas, materiais e ferragens antes de fechar.',
  );
  return lines.join('\n');
}

function num(raw: string) {
  const v = Number(raw.replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? v : null;
}
function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}

/**
 * Edição à mão do orçamento (tirar linha, quantidade, itens à parte). O
 * rascunho mora na página: a aba, a janela grande e o cartão da conversa
 * editam o mesmo, e só "Salvar" grava como versão.
 */
export type QuoteEditing = {
  /** Ajuste de onde o rascunho parte (o rascunho, ou o gravado na versão). */
  base: QuoteAdjust | undefined;
  /** Mudanças ainda não gravadas (0: sem rascunho). */
  changes: number;
  /** Número que a versão nova vai ganhar. */
  nextVersion: number;
  disabled: boolean;
  onDraft: (next: QuoteAdjust | undefined) => void;
  onSave: () => void;
  onDiscard: () => void;
  /** Rascunho de outra versão, guardado: retomar traz para a vigente. */
  stale?: { revision: number | null; changes: number; onAdopt: () => void };
};

export function QuotePanel({
  name,
  quote: q,
  prices,
  onPrices,
  previous = null,
  onShowParts,
  editing,
  focus = [],
}: {
  name: string;
  quote: Quote;
  prices: Prices;
  onPrices: (next: Prices) => void;
  /** Total da versão anterior à exibida, para mostrar quanto a última mudança custou. */
  previous?: { version: number; total: number } | null;
  /** Acende no móvel as peças que uma linha conta. */
  onShowParts?: (ids: string[]) => void;
  /** Sem isto o orçamento só lê (versão antiga em prévia). */
  editing?: QuoteEditing;
  /** Linhas citadas pela conversa: ficam em destaque. */
  focus?: readonly string[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const focusKey = focus.join('|');
  // Linha citada pelo cartão da conversa: aparece rolada à vista.
  useEffect(() => {
    if (!focusKey) return;
    root.current?.querySelector('.quote-line.focus')?.scrollIntoView({ block: 'center' });
  }, [focusKey]);
  const edit = (next: QuoteAdjust | undefined) => editing?.onDraft(next);
  const [copied, setCopied] = useState(false);
  const [closed, setClosed] = useState<QuoteSection[]>([]);
  const set = <K extends keyof Prices>(key: K, value: Prices[K]) => onPrices({ ...prices, [key]: value });
  const setRef = (ref: PriceRef, v: number) =>
    'sheet' in ref
      ? onPrices({ ...prices, sheets: { ...prices.sheets, [ref.sheet]: v } })
      : 'hardware' in ref
        ? onPrices({ ...prices, hardware: { ...prices.hardware, [ref.hardware]: v } })
        : onPrices({ ...prices, [ref.key]: v });
  const custom = JSON.stringify(prices) !== JSON.stringify(DEFAULT_PRICES);
  const sectionTotal = q.sections.reduce((a, s) => a + s.total, 0) || 1;
  const delta = previous ? Math.round((q.total - previous.total) * 100) / 100 : 0;
  const margin = (v: number) => set('margin', Math.max(0, Math.min(300, Math.round(v))));
  const priceField = (key: Exclude<keyof Prices, 'sheets' | 'handles' | 'hardware'>, label: string, suffix = 'R$', step = 0.5) => (
    <label className="price-field" key={key}>
      <span>{label}</span>
      <span className="price-input">
        <em>{suffix}</em>
        <input
          type="number"
          min={0}
          step={step}
          value={prices[key]}
          onChange={(e) => {
            const v = num(e.target.value);
            if (v !== null) set(key, v);
          }}
        />
      </span>
    </label>
  );
  return (
    <div className="quote-panel" ref={root}>
      {editing?.stale && editing.changes === 0 && (
        <output className="quote-draft-bar">
          <span>
            <b>Rascunho guardado</b> {editing.stale.revision ? `da v${editing.stale.revision}` : 'de uma versão descartada'} · o projeto mudou depois dele
          </span>
          <span className="quote-draft-actions">
            <button type="button" className="ghost-button" disabled={editing.disabled} onClick={editing.onDiscard}>
              <RotateCcw size={13} /> Descartar
            </button>
            <button type="button" className="ghost-button primary" disabled={editing.disabled} onClick={editing.stale.onAdopt}>
              <Undo2 size={13} /> Retomar
            </button>
          </span>
        </output>
      )}
      {editing && editing.changes > 0 && (
        <output className="quote-draft-bar">
          <span>
            <b>Rascunho</b> · {editing.changes} {editing.changes === 1 ? 'mudança não salva' : 'mudanças não salvas'}
          </span>
          <span className="quote-draft-actions">
            <button type="button" className="ghost-button" disabled={editing.disabled} onClick={editing.onDiscard}>
              <RotateCcw size={13} /> Descartar
            </button>
            <button type="button" className="ghost-button primary" disabled={editing.disabled} onClick={editing.onSave}>
              <Check size={13} /> Salvar como v{editing.nextVersion}
            </button>
          </span>
        </output>
      )}
      <div className="quote-hero">
        <div className="quote-hero-top">
          <span className="eyebrow">Orçamento estimado</span>
          {previous && (
            <span
              className={'quote-delta' + (delta > 0 ? ' up' : delta < 0 ? ' down' : '')}
              title={`Versão ${previous.version}: ${money(previous.total)}`}
            >
              {delta === 0 ? `igual à v${previous.version}` : `${delta > 0 ? '+' : '−'}${money(Math.abs(delta))} vs v${previous.version}`}
            </span>
          )}
        </div>
        <strong className="quote-total">{money(q.total)}</strong>
        <div className="quote-split">
          <span>
            Custo <b>{money(q.cost)}</b>
          </span>
          <span className="quote-margin">
            Margem
            <span className="stepper" aria-label="Margem sobre o custo">
              <button type="button" aria-label="Menos 5%" onClick={() => margin(prices.margin - 5)}>
                <Minus size={12} />
              </button>
              <input
                type="number"
                min={0}
                max={300}
                step={1}
                aria-label="Margem em %"
                value={prices.margin}
                onChange={(e) => {
                  const v = num(e.target.value);
                  if (v !== null) margin(v);
                }}
              />
              <em>%</em>
              <button type="button" aria-label="Mais 5%" onClick={() => margin(prices.margin + 5)}>
                <Plus size={12} />
              </button>
            </span>
            <b>{money(q.marginValue)}</b>
          </span>
        </div>
        <div className="quote-bar" aria-hidden="true">
          {q.sections.map((s) => (
            <span
              key={s.section}
              style={{ width: `${(s.total / sectionTotal) * 100}%`, background: SECTION_TONE[s.section] }}
            />
          ))}
        </div>
        <ul className="quote-legend">
          {q.sections.map((s) => (
            <li key={s.section}>
              <i style={{ background: SECTION_TONE[s.section] }} />
              {s.section}
              <span>{pct(s.total / sectionTotal)}</span>
              <b>{money(s.total)}</b>
            </li>
          ))}
        </ul>
        <div className="quote-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              void navigator.clipboard?.writeText(quoteText(name, q)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              });
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copiado' : 'Copiar orçamento'}
          </button>
          {custom && (
            <button type="button" className="link-button" onClick={() => onPrices(structuredClone(DEFAULT_PRICES))}>
              <RotateCcw size={12} /> preços de partida
            </button>
          )}
        </div>
      </div>
      <div className="stat-strip">
        <span>
          <b>{q.counts.modules}</b> {q.counts.modules === 1 ? 'módulo' : 'módulos'}
        </span>
        <span>
          <b>{q.counts.parts}</b> peças
        </span>
        <span>
          <b>{q.counts.sheets}</b> {q.counts.sheets === 1 ? 'chapa' : 'chapas'}
        </span>
        <span>
          <b>{q.counts.doors}</b> {q.counts.doors === 1 ? 'porta' : 'portas'}
        </span>
        <span>
          <b>{q.counts.drawers}</b> {q.counts.drawers === 1 ? 'gaveta' : 'gavetas'}
        </span>
        <span>
          <b>{q.counts.edgeMeters} m</b> de fita
        </span>
      </div>
      <p className="hint quote-tip">
        Os unitários são editáveis na linha e valem para todos os projetos.{editing ? ' Quantidade, tirar item e itens à parte valem só para este projeto e viram versão ao salvar.' : ''}
      </p>
      {ORDER.map((section) => {
        const lines = q.lines.filter((l) => l.section === section);
        if (!lines.length) return null;
        const total = lines.reduce((a, l) => a + l.total, 0);
        const open = !closed.includes(section);
        return (
          <section className={'quote-section' + (open ? '' : ' closed')} key={section}>
            <button
              type="button"
              className="quote-section-head"
              aria-expanded={open}
              onClick={() => setClosed(open ? [...closed, section] : closed.filter((s) => s !== section))}
            >
              <ChevronDown size={14} className="chev" />
              <i className="dot" style={{ background: SECTION_TONE[section] }} />
              <span>{SECTION_NAME(section)}</span>
              <small>{pct(total / sectionTotal)}</small>
              <b>{money(total)}</b>
            </button>
            {open &&
              lines.map((l) => (
                <Line
                  key={l.key ?? l.label}
                  line={l}
                  focused={!!l.key && focus.includes(l.key)}
                  onPrice={(v) => (l.extra ? edit(updateExtra(editing?.base, l.extra, { unitPrice: v })) : l.price && setRef(l.price, v))}
                  onShow={onShowParts}
                  editing={editing}
                  onQty={(v) => edit(setQty(editing?.base, l, v))}
                  onRemove={() => edit(l.extra ? removeExtra(editing?.base, l.extra) : setRemoved(editing?.base, l.key!, true))}
                />
              ))}
          </section>
        );
      })}
      {q.removed.length > 0 && (
        <section className="quote-removed" aria-label="Fora do orçamento">
          <div className="section-label">
            <span>Fora do orçamento</span>
            <span>{money(q.removed.reduce((a, l) => a + l.total, 0))}</span>
          </div>
          {q.removed.map((l) => (
            <div className="quote-line removed" key={l.key}>
              <div className="quote-line-main">
                <strong>{l.label}</strong>
                <small>
                  {quantity(l.qty)} {l.unit} × {money(l.unitPrice)} · tirado à mão
                </small>
              </div>
              {editing && (
                <button type="button" className="ghost-button" disabled={editing.disabled} onClick={() => edit(setRemoved(editing.base, l.key!, false))}>
                  <Undo2 size={13} /> Voltar
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {editing && <ExtraForm disabled={editing.disabled} onAdd={(e) => edit(addExtra(editing.base, e))} />}
      <details className="price-table">
        <summary>Tabela de preços completa</summary>
        <p className="hint">
          Valores em reais, salvos neste navegador e usados em todos os projetos. Chapas de 15 e 6 mm saem da chapa 18
          do mesmo acabamento pelo fator; madeira maciça por m³, pedra, vidro e palhinha por m², metal por metro de tubo.
        </p>
        {CATEGORIES.map((cat) => (
          <div key={cat}>
            <div className="section-label">
              {CATEGORY_INFO[cat].label} · {CATEGORY_INFO[cat].price}
            </div>
            <div className="price-grid">
              {materials
                .filter((m) => m.category === cat)
                .map((m) => (
                  <label className="price-field" key={m.id}>
                    <span>
                      <i
                        className={'swatch-dot' + (m.finish === 'wood' ? ' wood' : '') + (m.category !== 'sheet' ? ` ${m.finish}` : '')}
                        style={{ '--swatch': m.color } as React.CSSProperties}
                      />
                      {m.name}
                    </span>
                    <span className="price-input">
                      <em>R$</em>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={prices.sheets[m.id]}
                        onChange={(e) => {
                          const v = num(e.target.value);
                          if (v !== null) onPrices({ ...prices, sheets: { ...prices.sheets, [m.id]: v } });
                        }}
                      />
                    </span>
                  </label>
                ))}
              {cat === 'sheet' && priceField('factor15', 'Fator chapa 15 mm', '×', 0.01)}
              {cat === 'sheet' && priceField('factor6', 'Fator chapa 6 mm', '×', 0.01)}
            </div>
          </div>
        ))}
        <div className="section-label">Ferragens e fita</div>
        <div className="price-grid">
          {priceField('edgePerM', 'Fita de borda (m)')}
          {priceField('hinge', 'Dobradiça')}
          {priceField('slidePair', 'Corrediça (par)')}
          {priceField('handle', 'Puxador barra')}
          {priceField('moduleKit', 'Kit por módulo')}
        </div>
        <label className="check-label">
          <input type="checkbox" checked={prices.handles} onChange={(e) => set('handles', e.target.checked)} />
          Frentes com puxador
        </label>
        {HARDWARE_GROUPS.map((g) => (
          <div key={g.label}>
            <div className="section-label">{g.label}</div>
            <div className="price-grid">
              {g.keys.map((k) => (
                <label className="price-field" key={k}>
                  <span>{HARDWARE[k].label}</span>
                  <span className="price-input">
                    <em>{HARDWARE[k].unit === '×' ? '×' : 'R$'}</em>
                    <input
                      type="number"
                      min={0}
                      step={HARDWARE[k].unit === '×' ? 1 : 0.5}
                      value={prices.hardware[k]}
                      onChange={(e) => {
                        const v = num(e.target.value);
                        if (v !== null) onPrices({ ...prices, hardware: { ...prices.hardware, [k]: v } });
                      }}
                    />
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="section-label">Mão de obra</div>
        <div className="price-grid">
          {priceField('labourPerPart', 'Corte e fita (peça)')}
          {priceField('labourPerModule', 'Montagem (módulo)')}
          {priceField('labourPerFront', 'Regulagem (frente)')}
        </div>
        <button type="button" className="ghost-button" onClick={() => onPrices(structuredClone(DEFAULT_PRICES))}>
          <RotateCcw size={14} /> Restaurar valores de partida
        </button>
      </details>
      <p className="hint">
        Estimativa para conversa inicial: chapas contadas pelo plano de corte, fita nas frentes em 4 bordas e nas
        demais peças na borda da frente. Não inclui frete, instalação, impostos nem acessórios internos.
      </p>
    </div>
  );
}

/** Item à parte (frete, instalação): nome, quantidade, unidade e preço. */
function ExtraForm({ disabled, onAdd }: { disabled: boolean; onAdd: (e: { label: string; qty: number; unit: string; unitPrice: number }) => void }) {
  const [label, setLabel] = useState('');
  const [qty, setQtyText] = useState('1');
  const [unit, setUnit] = useState('un');
  const [price, setPrice] = useState('');
  const ok = label.trim() && num(qty) !== null && num(price) !== null && price !== '';
  return (
    <form
      className="quote-extra-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        onAdd({ label: label.trim(), qty: num(qty)!, unit: unit.trim() || 'un', unitPrice: num(price)! });
        setLabel('');
        setQtyText('1');
        setPrice('');
      }}
    >
      <div className="section-label">
        <span>Item à parte</span>
        <span>frete, instalação, projeto</span>
      </div>
      <div className="quote-extra-fields">
        <input aria-label="Nome do item" placeholder="Ex.: Frete e entrega" value={label} maxLength={80} disabled={disabled} onChange={(e) => setLabel(e.target.value)} />
        <input aria-label="Quantidade" inputMode="decimal" value={qty} disabled={disabled} onChange={(e) => setQtyText(e.target.value)} />
        <input aria-label="Unidade" value={unit} maxLength={16} disabled={disabled} onChange={(e) => setUnit(e.target.value)} />
        <span className="price-input">
          <em>R$</em>
          <input aria-label="Preço unitário" inputMode="decimal" placeholder="0" value={price} disabled={disabled} onChange={(e) => setPrice(e.target.value)} />
        </span>
        <button type="submit" className="ghost-button" disabled={disabled || !ok}>
          <Plus size={13} /> Pôr
        </button>
      </div>
    </form>
  );
}

function Line({
  line: l,
  onPrice,
  onShow,
  editing,
  focused = false,
  onQty,
  onRemove,
}: {
  line: QuoteLine;
  onPrice: (v: number) => void;
  onShow?: (ids: string[]) => void;
  editing?: QuoteEditing;
  focused?: boolean;
  onQty?: (v: number | undefined) => void;
  onRemove?: () => void;
}) {
  const adjusted = l.computedQty !== undefined;
  return (
    <div className={'quote-line' + (focused ? ' focus' : '') + (adjusted ? ' adjusted' : '') + (l.extra ? ' extra' : '')}>
      <div className="quote-line-main">
        <strong>{l.label}</strong>
        <span className="quote-calc">
          {editing && onQty ? (
            <span className="inline-price qty" title={adjusted ? `Ajustado à mão; o app calcula ${quantity(l.computedQty!)}` : 'Quantidade (vale só para este projeto)'}>
              <input
                type="number"
                min={0}
                step={Number.isInteger(l.qty) ? 1 : 0.1}
                aria-label={`Quantidade de ${l.label}`}
                value={l.qty}
                disabled={editing.disabled}
                onChange={(e) => {
                  const v = num(e.target.value);
                  if (v !== null) onQty(v);
                }}
              />
              <em>{l.unit}</em>
            </span>
          ) : (
            <>
              {quantity(l.qty)} {l.unit}
            </>
          )}{' '}
          ×{' '}
          {l.price || l.extra ? (
            <span className="inline-price">
              <em>R$</em>
              <input
                type="number"
                min={0}
                step={0.5}
                aria-label={`Unitário de ${l.label}`}
                value={l.unitPrice}
                onChange={(e) => {
                  const v = num(e.target.value);
                  if (v !== null) onPrice(v);
                }}
              />
            </span>
          ) : (
            money(l.unitPrice)
          )}
        </span>
        {adjusted && (
          <small className="quote-adjusted">
            ajustado à mão · o app calcula {quantity(l.computedQty!)}{' '}
            {editing && onQty && (
              <button type="button" className="link-button" disabled={editing.disabled} onClick={() => onQty(undefined)}>
                voltar à conta
              </button>
            )}
          </small>
        )}
        {l.extra && <small>item à parte, só deste projeto</small>}
        {l.note && <small>{l.note}</small>}
      </div>
      <div className="quote-line-side">
        <b>{money(l.total)}</b>
        {editing && onRemove && (
          <button type="button" className="icon-button quote-show" title="Tirar do orçamento" aria-label={`Tirar ${l.label} do orçamento`} disabled={editing.disabled} onClick={onRemove}>
            <X size={14} />
          </button>
        )}
        {onShow && l.parts.length > 0 && (
          <button
            type="button"
            className="icon-button quote-show"
            title={`Ver no móvel (${l.parts.length} ${l.parts.length === 1 ? 'peça' : 'peças'})`}
            aria-label={`Ver ${l.label} no móvel`}
            onClick={() => onShow(l.parts)}
          >
            <Crosshair size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
