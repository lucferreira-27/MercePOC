'use client';
import { useRef, useState } from 'react';
import { Check, Copy, FileDown, Loader2, Maximize2, Minus, Plus, Receipt, RotateCcw, Undo2, X } from 'lucide-react';
import { money, quantity, type Quote, type QuoteLine } from '@/lib/quote';
import { setQty, setRemoved, removeExtra } from '@/lib/quote-draft';
import type { WidgetBlock } from '@/lib/rich';
import { quoteText } from '../quote-panel';
import { useRich } from './rich-context';
import { BlockStatus, WidgetHead } from './widget-parts';
import { GoneCard } from './cut-widget';

const ROWS = 5;
const TONE: Record<string, string> = {
  Chapas: 'var(--chart-1)',
  'Fita de borda': 'var(--chart-2)',
  Materiais: 'var(--chart-5)',
  Ferragens: 'var(--chart-3)',
  'Mão de obra': 'var(--chart-4)',
  Outros: 'var(--wood)',
};

/**
 * Orçamento dentro da resposta. Na versão vigente o cartão é o orçamento de
 * verdade: lê a mesma conta da aba e edita o mesmo rascunho (tirar item,
 * quantidade), que só vira versão em "Salvar". Numa versão antiga ele vira
 * histórico, com os números de quando saiu e o total de agora ao lado.
 */
export function QuoteWidget({ block }: { block: WidgetBlock }) {
  const rich = useRich();
  if (block.snapshot.widget !== 'quote') return null;
  // O cartão mais novo do orçamento é o orçamento de agora; os de antes, histórico.
  if (rich.isLive(block)) return <QuoteLive block={block} />;
  if (rich.revisionIndex(block.revisionId) < 0) return <GoneCard block={block} />;
  return <QuoteHistory block={block} />;
}

function QuoteLive({ block }: { block: WidgetBlock }) {
  const rich = useRich();
  const opener = useRef<HTMLButtonElement>(null);
  const [all, setAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const draft = rich.draft?.revisionId === rich.current.id ? rich.draft : null;
  const q: Quote = (draft && rich.draftQuote) || rich.quoteAt(rich.current.index);
  const base = rich.quoteAt(rich.current.index);
  const focus = new Set(block.focus ?? []);
  const ordered = [...q.lines].sort((a, b) => Number(focus.has(b.key!)) - Number(focus.has(a.key!)) || b.total - a.total);
  const shown = all ? q.lines : ordered.slice(0, ROWS);
  // O rascunho parte do ajuste gravado na versão vigente.
  const editBase = draft ? draft.adjust : rich.savedAdjust;
  const edit = (next: ReturnType<typeof setQty>) => rich.setDraft(next);
  const sectionTotal = q.sections.reduce((a, s) => a + s.total, 0) || 1;
  const generatingPdf = rich.generating.includes('quote-pdf');
  return (
    <article className={'rich-card quote-widget' + (draft ? ' has-draft' : '')} data-block={block.id} aria-label={`Orçamento da versão ${block.revision}`}>
      <WidgetHead icon={<Receipt size={15} />} title="Orçamento" sub={rich.projectName} status={<BlockStatus block={block} draft={draft?.changes} />} />
      <div className="qw-total">
        <strong>{money(q.total)}</strong>
        {draft && q.total !== base.total && <span className="qw-was">salvo: {money(base.total)}</span>}
        <span className="qw-split">
          custo {money(q.cost)} · margem {money(q.marginValue)}
        </span>
      </div>
      <div className="quote-bar qw-bar" aria-hidden="true">
        {q.sections.map((s) => (
          <span key={s.section} style={{ width: `${(s.total / sectionTotal) * 100}%`, background: TONE[s.section] }} />
        ))}
      </div>
      <ul className="qw-lines" aria-label={all ? 'Todos os itens' : 'Itens que mais pesam'}>
        {shown.map((l) => (
          <QuoteRow
            key={l.key}
            line={l}
            focused={focus.has(l.key!)}
            busy={rich.busy}
            onQty={(qty) => edit(setQty(editBase, l, qty))}
            onRemove={() => edit(l.extra ? removeExtra(editBase, l.extra) : setRemoved(editBase, l.key!, true))}
          />
        ))}
      </ul>
      {q.lines.length > ROWS && (
        <button type="button" className="link-button rc-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Mostrar só os principais' : `Ver todos os ${q.lines.length} itens`}
        </button>
      )}
      {q.removed.length > 0 && (
        <p className="qw-removed">
          <span>Fora do orçamento:</span>
          {q.removed.map((l) => (
            <button key={l.key} type="button" className="qw-chip" disabled={rich.busy} onClick={() => edit(setRemoved(editBase, l.key!, false))} title={`Voltar ${l.label} (${money(l.total)})`}>
              {l.label} <Undo2 size={11} />
            </button>
          ))}
        </p>
      )}
      {!draft && rich.staleDraft && (
        <output className="qw-draft stale">
          <span>
            Há um rascunho não salvo {rich.staleDraft.revision ? `da v${rich.staleDraft.revision}` : 'de uma versão descartada'} ({rich.staleDraft.changes}{' '}
            {rich.staleDraft.changes === 1 ? 'mudança' : 'mudanças'}). O projeto mudou depois dele.
          </span>
          <span className="qw-draft-actions">
            <button type="button" className="rc-action" disabled={rich.busy} onClick={rich.discardDraft}>
              <RotateCcw size={13} /> Descartar
            </button>
            <button type="button" className="rc-action primary" disabled={rich.busy} onClick={rich.adoptDraft}>
              <Undo2 size={13} /> Retomar na v{rich.current.number}
            </button>
          </span>
        </output>
      )}
      {draft && (
        <output className="qw-draft">
          <span>
            {draft.changes} {draft.changes === 1 ? 'mudança não salva' : 'mudanças não salvas'}. O PDF sai do orçamento salvo.
          </span>
          <span className="qw-draft-actions">
            <button type="button" className="rc-action" disabled={rich.busy} onClick={rich.discardDraft}>
              <RotateCcw size={13} /> Descartar
            </button>
            <button type="button" className="rc-action primary" disabled={rich.busy} onClick={() => void rich.saveDraft()}>
              <Check size={13} /> Salvar como v{rich.revisionNumber(rich.current.index) + 1}
            </button>
          </span>
        </output>
      )}
      <footer className="rc-actions">
        <button ref={opener} type="button" className="rc-action primary" onClick={() => rich.open({ kind: 'quote', focus: block.focus }, opener.current)}>
          <Maximize2 size={14} /> {rich.mode === 'split' ? 'Abrir no Orçamento' : 'Abrir o orçamento'}
        </button>
        <button
          type="button"
          className="rc-action"
          disabled={rich.busy || generatingPdf || !!draft}
          title={draft ? 'Salve ou descarte o rascunho antes: o PDF sai da versão salva' : 'Gera o PDF do orçamento como arquivo na conversa'}
          onClick={() => void rich.generate('quote-pdf')}
        >
          {generatingPdf ? <Loader2 size={14} className="spin" /> : <FileDown size={14} />} Gerar PDF
        </button>
        <button
          type="button"
          className="rc-action"
          onClick={() =>
            void navigator.clipboard?.writeText(quoteText(rich.projectName, q)).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            })
          }
        >
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar'}
        </button>
      </footer>
    </article>
  );
}

function QuoteRow({
  line: l,
  focused,
  busy,
  onQty,
  onRemove,
}: {
  line: QuoteLine;
  focused: boolean;
  busy: boolean;
  onQty: (qty: number | undefined) => void;
  onRemove: () => void;
}) {
  const whole = Number.isInteger(l.qty);
  const adjusted = l.computedQty !== undefined;
  return (
    <li className={'qw-row' + (focused ? ' focus' : '') + (adjusted ? ' adjusted' : '') + (l.extra ? ' extra' : '')}>
      <span className="qw-label">
        <span className="qw-name" title={l.label}>
          {l.label}
        </span>
        <span className="qw-qty">
          <span className="qw-amount" title={adjusted ? `Ajustado à mão; o app calcula ${quantity(l.computedQty!)}` : undefined}>
            {quantity(l.qty)} {l.unit}
          </span>
          {whole && (
            <button type="button" className="qw-step" aria-label={`Menos ${l.label}`} disabled={busy || l.qty <= 0} onClick={() => onQty(Math.max(0, l.qty - 1))}>
              <Minus size={11} />
            </button>
          )}
          {whole && (
            <button type="button" className="qw-step" aria-label={`Mais ${l.label}`} disabled={busy} onClick={() => onQty(l.qty + 1)}>
              <Plus size={11} />
            </button>
          )}
          {adjusted && (
            <button type="button" className="qw-step" aria-label={`Voltar ${l.label} à conta do app`} title={`Voltar à conta do app (${quantity(l.computedQty!)})`} disabled={busy} onClick={() => onQty(undefined)}>
              <RotateCcw size={11} />
            </button>
          )}
          {(adjusted || l.extra) && <small>{adjusted ? 'à mão' : 'à parte'}</small>}
        </span>
      </span>
      <b className="qw-sum">{money(l.total)}</b>
      <button type="button" className="qw-remove" aria-label={`Tirar ${l.label} do orçamento`} title="Tirar do orçamento" disabled={busy} onClick={onRemove}>
        <X size={13} />
      </button>
    </li>
  );
}

function QuoteHistory({ block }: { block: WidgetBlock }) {
  const rich = useRich();
  const opener = useRef<HTMLButtonElement>(null);
  const s = block.snapshot.widget === 'quote' ? block.snapshot : null;
  if (!s) return null;
  const now = rich.quoteAt(rich.current.index).total;
  const delta = Math.round((now - s.total) * 100) / 100;
  const index = rich.revisionIndex(block.revisionId);
  return (
    <article className="rich-card quote-widget old" data-block={block.id} aria-label={`Orçamento da versão ${block.revision}, histórico`}>
      <WidgetHead icon={<Receipt size={15} />} title="Orçamento" sub={rich.projectName} status={<BlockStatus block={block} />} />
      <div className="qw-total">
        <strong>{money(s.total)}</strong>
        <span className="qw-split">
          custo {money(s.cost)} · margem {money(s.margin)} · {s.lines} itens{s.adjusted ? ` · ${s.adjusted} à mão` : ''}
        </span>
      </div>
      <ul className="qw-lines">
        {s.top.map((l) => (
          <li key={l.label} className="qw-row static">
            <span className="qw-label">
              <span className="qw-name" title={l.label}>
                {l.label}
              </span>
              <span className="qw-qty">
                <span className="qw-amount">
                  {quantity(l.qty)} {l.unit}
                </span>
              </span>
            </span>
            <b className="qw-sum">{money(l.total)}</b>
          </li>
        ))}
      </ul>
      <p className="rc-note">
        Agora, na v{rich.current.number}: <b>{money(now)}</b>
        {delta !== 0 && <span className={'qw-delta ' + (delta > 0 ? 'up' : 'down')}>{`${delta > 0 ? '+' : '−'}${money(Math.abs(delta))}`}</span>}
      </p>
      <footer className="rc-actions">
        <button ref={opener} type="button" className="rc-action primary" onClick={() => rich.open({ kind: 'quote' }, opener.current)}>
          <Maximize2 size={14} /> Ver o atual
        </button>
        {index >= 0 && (
          <button type="button" className="rc-action" disabled={rich.busy} onClick={() => rich.seek(index)}>
            Voltar para a v{block.revision}
          </button>
        )}
      </footer>
    </article>
  );
}
