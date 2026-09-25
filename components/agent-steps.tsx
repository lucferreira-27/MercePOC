'use client';
import { Check, ListChecks, Loader2, X } from 'lucide-react';
import type { AgentStep } from '@/lib/agent/types';

/**
 * O que o assistente fez no pedido, uma linha por ferramenta: ao vivo no
 * cartão de progresso (com a etapa em curso) e recolhido na resposta, para
 * quem quer conferir o caminho. Etapas que falharam e foram corrigidas ficam
 * visíveis: a conferência é parte do valor, não um erro escondido.
 */
export function AgentSteps({
  steps,
  plan = [],
  running = null,
  compact = false,
}: {
  steps: readonly AgentStep[];
  plan?: readonly string[];
  running?: string | null;
  compact?: boolean;
}) {
  // Leituras repetidas não contam história: só a primeira de cada tipo aparece.
  const shown = steps.filter((s, i) => s.ok === false || !['state_read', 'history_list', 'project_list'].includes(s.tool) || steps.findIndex((v) => v.tool === s.tool) === i);
  return (
    <div className={'agent-steps' + (compact ? ' compact' : '')}>
      {plan.length > 0 && (
        <ol className="agent-plan" aria-label="Plano">
          {plan.map((p, i) => (
            <li key={i}>
              <span>{i + 1}</span>
              {p}
            </li>
          ))}
        </ol>
      )}
      <ol className="agent-list">
        {shown.map((s, i) => (
          <li key={i} className={s.ok ? 'ok' : 'bad'} title={s.detail}>
            <span className="agent-icon" aria-hidden="true">
              {s.ok ? <Check size={11} strokeWidth={3} /> : <X size={11} strokeWidth={3} />}
            </span>
            <span className="agent-label">{s.label}</span>
          </li>
        ))}
        {running && (
          <li className="running">
            <span className="agent-icon" aria-hidden="true">
              <Loader2 size={11} className="spin" />
            </span>
            <span className="agent-label">{running}</span>
          </li>
        )}
      </ol>
    </div>
  );
}

/** Na resposta gravada: as etapas recolhidas atrás de uma linha. */
export function AgentStepsSummary({ steps, plan }: { steps: readonly AgentStep[]; plan?: readonly string[] }) {
  const failed = steps.filter((s) => !s.ok).length;
  return (
    <details className="agent-summary">
      <summary>
        <ListChecks size={13} />
        {steps.length} {steps.length === 1 ? 'etapa' : 'etapas'}
        {failed ? ` · ${failed} ${failed === 1 ? 'corrigida' : 'corrigidas'}` : ''}
      </summary>
      <AgentSteps steps={steps} plan={plan} compact />
    </details>
  );
}
