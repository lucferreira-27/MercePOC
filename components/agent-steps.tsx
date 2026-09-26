'use client';
import { ArrowRight, Check, ListChecks, Loader2, X } from 'lucide-react';
import type { AgentStep } from '@/lib/agent/types';
import type { ChatReport } from '@/lib/progress';

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

const CAUSE: Record<NonNullable<ChatReport['failure']>['cause'], string> = {
  cancelled: 'Interrompido',
  timeout: 'Tempo esgotado',
  provider: 'Falha do provedor',
  internal: 'Erro no app',
};

/**
 * O que o app conferiu no estado gravado, separado do texto da IA: os fatos
 * do objetivo antes e depois (chapas, orçamento) e como o pedido terminou,
 * quando não terminou inteiro. A resposta dizia "o plano ainda usa 25 mm"
 * com o plano já em 18 mm; aqui o número é do app.
 */
export function TurnFacts({ report }: { report: ChatReport }) {
  const facts = report.facts ?? [];
  const failure = report.failure;
  const partial = report.completion === 'partial';
  const back = report.completion === 'rolled-back';
  if (!facts.length && !partial && !back && !failure) return null;
  return (
    <div className="turn-facts">
      {facts.map((f) => (
        <span key={f.label} className="turn-fact">
          <em>{f.label}</em>
          <span className="turn-fact-before">{f.before}</span>
          <ArrowRight size={11} aria-label="para" />
          <strong>{f.after}</strong>
        </span>
      ))}
      {partial && <span className="turn-fact warn">Parcial: o tempo acabou e ficou gravado só o que está acima</span>}
      {back && <span className="turn-fact warn">Rascunho descartado: o projeto ficou como estava</span>}
      {failure && (
        <span className="turn-fact bad" title={`Pedido ${failure.requestId}`}>
          {CAUSE[failure.cause]} · {failure.committed === 'none' ? 'nada foi gravado' : 'o que foi salvo antes ficou'}
          {failure.draftOperations ? ` · ${failure.draftOperations} operações descartadas` : ''}
        </span>
      )}
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
