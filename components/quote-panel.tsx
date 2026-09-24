'use client';
import { useState } from 'react';
import { Check, Copy, RotateCcw } from 'lucide-react';
import { materials } from '@/lib/furniture';
import { DEFAULT_PRICES, money, type Prices, type Quote, type QuoteSection } from '@/lib/quote';

const SECTION_TONE: Record<QuoteSection, string> = {
  Chapas: 'var(--chart-1)',
  'Fita de borda': 'var(--chart-2)',
  Ferragens: 'var(--chart-3)',
  'Mão de obra': 'var(--chart-4)',
};

/** Texto do orçamento para colar numa mensagem ao cliente. */
function quoteText(name: string, q: Quote) {
  const lines = [
    `Orçamento estimado · ${name}`,
    '',
    ...q.lines.map(
      (l) => `${l.label}: ${l.qty} ${l.unit} × ${money(l.unitPrice)} = ${money(l.total)}`,
    ),
    '',
    `Custo: ${money(q.cost)}`,
    `Margem: ${money(q.marginValue)}`,
    `Total: ${money(q.total)}`,
    '',
    'Estimativa gerada no Merce. Confirme medidas, materiais e ferragens antes de fechar.',
  ];
  return lines.join('\n');
}

export function QuotePanel({
  name,
  quote: q,
  prices,
  onPrices,
}: {
  name: string;
  quote: Quote;
  prices: Prices;
  onPrices: (next: Prices) => void;
}) {
  const [copied, setCopied] = useState(false);
  const set = <K extends keyof Prices>(key: K, value: Prices[K]) => onPrices({ ...prices, [key]: value });
  const num = (raw: string) => {
    const v = Number(raw.replace(',', '.'));
    return Number.isFinite(v) && v >= 0 ? v : null;
  };
  const priceField = (key: Exclude<keyof Prices, 'sheets' | 'handles'>, label: string, suffix = 'R$') => (
    <label className="price-field" key={key}>
      <span>{label}</span>
      <span className="price-input">
        <em>{suffix}</em>
        <input
          type="number"
          min={0}
          step={key === 'margin' ? 1 : 0.5}
          value={prices[key]}
          onChange={(e) => {
            const v = num(e.target.value);
            if (v !== null) set(key, v);
          }}
        />
      </span>
    </label>
  );
  const sectionTotal = q.sections.reduce((a, s) => a + s.total, 0) || 1;
  return (
    <div className="quote-panel">
      <div className="quote-hero">
        <span className="eyebrow">Orçamento estimado</span>
        <strong className="quote-total">{money(q.total)}</strong>
        <span className="quote-sub">
          Custo {money(q.cost)} + margem {prices.margin}% ({money(q.marginValue)})
        </span>
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
              <b>{money(s.total)}</b>
            </li>
          ))}
        </ul>
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
      </div>
      <div className="stat-grid">
        <span><b>{q.counts.modules}</b>módulos</span>
        <span><b>{q.counts.parts}</b>peças</span>
        <span><b>{q.counts.sheets}</b>chapas</span>
        <span><b>{q.counts.doors}</b>portas</span>
        <span><b>{q.counts.drawers}</b>gavetas</span>
        <span><b>{q.counts.edgeMeters} m</b>de fita</span>
      </div>
      {(['Chapas', 'Fita de borda', 'Ferragens', 'Mão de obra'] as QuoteSection[]).map((section) => {
        const lines = q.lines.filter((l) => l.section === section);
        if (!lines.length) return null;
        return (
          <section className="quote-section" key={section}>
            <div className="section-label">
              <span>
                <i className="dot" style={{ background: SECTION_TONE[section] }} />
                {section}
              </span>
              <span>{money(lines.reduce((a, l) => a + l.total, 0))}</span>
            </div>
            {lines.map((l) => (
              <div className="quote-line" key={l.label}>
                <div>
                  <strong>{l.label}</strong>
                  <small>
                    {l.qty} {l.unit} × {money(l.unitPrice)}
                    {l.note ? ` · ${l.note}` : ''}
                  </small>
                </div>
                <b>{money(l.total)}</b>
              </div>
            ))}
          </section>
        );
      })}
      <details className="price-table">
        <summary>Tabela de preços</summary>
        <p className="hint">
          Valores de partida em reais, salvos neste navegador e usados em todos os projetos.
        </p>
        <div className="section-label">Chapa 18 mm · 2750 × 1840</div>
        <div className="price-grid">
          {materials.map((m) => (
            <label className="price-field" key={m.id}>
              <span>
                <i className={'swatch-dot' + (m.finish === 'wood' ? ' wood' : '')} style={{ '--swatch': m.color } as React.CSSProperties} />
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
        </div>
        <div className="section-label">Ferragens e fita</div>
        <div className="price-grid">
          {priceField('edgePerM', 'Fita de borda (m)')}
          {priceField('hinge', 'Dobradiça')}
          {priceField('slidePair', 'Corrediça (par)')}
          {priceField('handle', 'Puxador')}
          {priceField('moduleKit', 'Kit por módulo')}
        </div>
        <label className="check-label">
          <input type="checkbox" checked={prices.handles} onChange={(e) => set('handles', e.target.checked)} />
          Frentes com puxador
        </label>
        <div className="section-label">Mão de obra e margem</div>
        <div className="price-grid">
          {priceField('labourPerPart', 'Corte e fita (peça)')}
          {priceField('labourPerModule', 'Montagem (módulo)')}
          {priceField('labourPerFront', 'Regulagem (frente)')}
          {priceField('margin', 'Margem', '%')}
        </div>
        <button type="button" className="ghost-button" onClick={() => onPrices(structuredClone(DEFAULT_PRICES))}>
          <RotateCcw size={14} /> Restaurar valores de partida
        </button>
      </details>
      <p className="hint">
        Estimativa para conversa inicial: chapas contadas pelo plano de corte, fita nas frentes
        em 4 bordas e nas demais peças na borda da frente. Não inclui frete, instalação,
        impostos nem acessórios internos.
      </p>
    </div>
  );
}
