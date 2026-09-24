'use client';
import { useEffect, useRef, useState } from 'react';
import { Coins } from 'lucide-react';
import { modelInfo, sumUsage, tokensLabel, usd, type TurnUsage } from '@/lib/models';

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
              {talk.turns} {talk.turns === 1 ? 'turno' : 'turnos'} com IA · {tokensLabel(talk.tokens)} tokens
            </small>
          </div>
          {talk.byModel.length > 0 && (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Entrada</th>
                  <th>Saída</th>
                  <th>Custo</th>
                </tr>
              </thead>
              <tbody>
                {talk.byModel.map((u) => (
                  <tr key={u.model}>
                    <td>{modelInfo(u.model).label}</td>
                    <td>{tokensLabel(u.inputTokens)}</td>
                    <td title={u.reasoningTokens ? `${tokensLabel(u.reasoningTokens)} de raciocínio` : undefined}>
                      {tokensLabel(u.outputTokens)}
                    </td>
                    <td>{usd(u.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="usage-session">
            <span>Nesta aba, todos os projetos</span>
            <b>{usd(tab.costUsd)}</b>
          </div>
          <p className="hint">
            Estimativa com os tokens contados pelo provedor e a tabela de preços de cada modelo.
            {live ? ' O turno em andamento já entra na conta.' : ''}
          </p>
        </dialog>
      )}
    </div>
  );
}
