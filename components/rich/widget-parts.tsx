'use client';
import { Box, Receipt, Scissors } from 'lucide-react';
import type { WidgetBlock, WidgetKind } from '@/lib/rich';
import { useRich } from './rich-context';

export const WIDGET_ICON: Record<WidgetKind, React.ReactNode> = {
  cut: <Scissors size={15} />,
  quote: <Receipt size={15} />,
  design: <Box size={15} />,
};

/** Cabeçalho comum dos cartões: ícone, título e o estado (atual, histórico…). */
export function WidgetHead({ icon, title, sub, status }: { icon: React.ReactNode; title: string; sub?: string; status?: React.ReactNode }) {
  return (
    <header className="rc-head">
      <span className="rc-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="rc-title">
        <strong>{title}</strong>
        {sub && <small title={sub}>{sub}</small>}
      </span>
      {status}
    </header>
  );
}

/**
 * Selo do que o cartão mostra: a versão vigente (atual, o cartão mais novo
 * do tipo), uma versão antiga (histórico, os cartões anteriores) ou uma que
 * saiu do caminho (descartada). O rascunho do orçamento tem selo próprio.
 */
export function BlockStatus({ block, draft }: { block: WidgetBlock; draft?: number }) {
  const rich = useRich();
  const live = rich.isLive(block);
  const index = rich.revisionIndex(block.revisionId);
  if (live && draft)
    return (
      <span className="rc-status draft" title="Mudanças ainda não gravadas como versão">
        Rascunho · {draft} {draft === 1 ? 'mudança' : 'mudanças'}
      </span>
    );
  if (live)
    return (
      <span
        className="rc-status now"
        title={
          block.revisionId === rich.current.id
            ? 'Mostra a versão vigente do projeto'
            : `O cartão saiu na versão ${block.revision} e acompanha o projeto: mostra a versão ${rich.current.number}, a vigente`
        }
      >
        Atual · v{rich.current.number}
      </span>
    );
  if (index < 0)
    return (
      <span className="rc-status gone" title="A versão deste cartão saiu do caminho do projeto">
        Versão descartada
      </span>
    );
  return (
    <span
      className="rc-status old"
      title={`Mostra a versão ${block.revision}, como era quando o cartão saiu. O projeto está na versão ${rich.current.number}; o cartão mais novo deste tipo, mais abaixo, mostra a atual.`}
    >
      Histórico · v{block.revision}
    </span>
  );
}
