'use client';
import { useEffect, useRef, useState } from 'react';
import { Coins } from 'lucide-react';
import { modelInfo, percent, sumUsage, tokensLabel, usageBreakdown, usd, type TurnUsage } from '@/lib/models';

/**
 * Quanto a conversa está custando. O selo mostra o total desta conversa e abre
 * o detalhe: por modelo, tokens e o total desde que o estúdio foi aberto nesta
 * aba (que pode somar vários projetos).
 */
export function UsageMeter({
  conversation,
  session,
  live,
}: {
  /** Uso gravado nas respostas deste projeto. */
  conversation: (TurnUsage | undefined)[];
  /** Uso dos turnos feitos nesta aba, em qualquer projeto. */
  session: TurnUsage[];
  /** Turno em andamento: soma ao total enquanto a resposta não chega. */
  live: TurnUsage | null;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const talk = sumUsage([...conversation, ...(live ? [live] : [])]);
  const tab = sumUsage([...session, ...(live ? [live] : [])]);
  const split = usageBreakdown(talk.byModel);
  const rows = [
    { key: 'fresh', label: 'Entrada nova', hint: 'Preço cheio: o que o provedor leu pela primeira vez', ...split.fresh },
    { key: 'cached', label: 'Entrada do cache', hint: 'Reaproveitada de chamadas anteriores, com preço de cache', ...split.cached },
    { key: 'output', label: 'Saída', hint: 'Resposta e raciocínio da IA', ...split.output },
  ];
  return (
    <div className="usage-meter" ref={wrap}>
      <button
        type="button"
        className={'usage-pill' + (live ? ' live' : '')}
        aria-expanded={open}
        title="Custo estimado da conversa"
        onClick={() => setOpen((v) => !v)}
      >
        <Coins size={13} />
        {usd(talk.costUsd)}
      </button>
      {open && (
        <dialog open className="usage-pop" aria-label="Custo da conversa">
          <div className="usage-total">
            <span className="eyebrow">Esta conversa</span>
            <strong>{usd(talk.costUsd)}</strong>
            <small>
              {talk.turns} {talk.turns === 1 ? 'pedido' : 'pedidos'} à IA · {tokensLabel(talk.tokens)} tokens
              {talk.byModel.length === 1 ? ` · ${modelInfo(talk.byModel[0].model).label}` : ''}
            </small>
          </div>
          {talk.turns > 0 && (
            <>
              <div className="usage-cache" title={`Economia do cache nesta conversa: ${usd(split.savedUsd)}`}>
                <span className="usage-cache-bar" aria-hidden="true">
                  <i style={{ width: percent(split.hitRate) }} />
                </span>
                <span>
                  <b>{percent(split.hitRate)}</b> da entrada veio do cache
                  {split.savedUsd > 0 && (
                    <>
                      {' · economizou '}
                      <span className="nowrap">{usd(split.savedUsd)}</span>
                    </>
                  )}
                </span>
              </div>
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>Parte</th>
                    <th>Tokens</th>
                    <th>Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className={r.key} title={r.hint}>
                      <td>
                        <i className="usage-swatch" aria-hidden="true" />
                        {r.label}
                      </td>
                      <td>{tokensLabel(r.tokens)}</td>
                      <td>{usd(r.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {talk.byModel.length > 1 && (
                <ul className="usage-models">
                  {talk.byModel.map((u) => (
                    <li key={u.model}>
                      <span>{modelInfo(u.model).label}</span>
                      <small>{percent(usageBreakdown([u]).hitRate)} em cache</small>
                      <b>{usd(u.costUsd)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="usage-session">
            <span>Nesta aba, todos os projetos</span>
            <b>{usd(tab.costUsd)}</b>
          </div>
          <p className="hint">
            Estimativa com os tokens contados pelo provedor e a tabela de preços de cada modelo.
            {live ? ' O pedido em andamento já entra na conta.' : ''}
          </p>
        </dialog>
      )}
    </div>
  );
}
