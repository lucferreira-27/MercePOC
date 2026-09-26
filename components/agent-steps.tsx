'use client';
import { createElement, useState } from 'react';
import { ArrowRight, Brain, ChevronDown, ListChecks, RotateCcw } from 'lucide-react';
import type { AgentStep } from '@/lib/agent/types';
import type { ChatReport } from '@/lib/progress';
import { clock, runningLabel, toolIcon, type RunningTool } from './turn-activity';

/** Etapa vista ao vivo: quanto levou desde a anterior (IA pensando + ferramenta). */
export type LiveStep = AgentStep & { ms?: number };

/** Leituras repetidas não contam história: só a primeira de cada tipo aparece. */
const QUIET = ['state_read', 'history_list', 'project_list'];

/**
 * Pergunta barrada pelo app não é erro da IA: ela seguiu sem perguntar.
 * Mensagens antigas gravaram "Dispensei a pergunta".
 */
function kindOf(s: AgentStep) {
  if (s.tool === 'ask_user' && !s.ok) return 'info';
  return s.ok ? 'done' : 'warn';
}
function labelOf(s: AgentStep) {
  return s.tool === 'ask_user' && !s.ok ? 'Segui sem perguntar' : s.label;
}

/**
 * O que o assistente fez no pedido, uma linha por ferramenta com o ícone
 * dela: ao vivo no cartão de progresso (com a etapa em curso ou a IA
 * decidindo a próxima) e recolhido na resposta. Etapas que falharam e foram
 * refeitas ficam visíveis: a conferência é parte do valor, não um erro.
 */
export function AgentSteps({
  steps,
  plan = [],
  running = null,
  thinking = false,
  compact = false,
  limit = 0,
}: {
  steps: readonly LiveStep[];
  plan?: readonly string[];
  running?: RunningTool | null;
  /** Entre duas ferramentas: a IA está escolhendo o próximo passo. */
  thinking?: boolean;
  compact?: boolean;
  /** Quantas linhas mostrar do fim; as anteriores ficam atrás de um botão. */
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  const shown = steps.filter((s, i) => s.ok === false || !QUIET.includes(s.tool) || steps.findIndex((v) => v.tool === s.tool) === i);
  const hidden = limit && !all ? Math.max(0, shown.length - limit) : 0;
  return (
    <div className={'agent-steps' + (compact ? ' compact' : '')}>
      {plan.length > 0 && (
        <div className="agent-plan">
          <span className="agent-plan-title">
            <ListChecks size={12} /> Plano
          </span>
          <ol>
            {plan.map((p, i) => (
              <li key={i}>
                <span>{i + 1}</span>
                {p}
              </li>
            ))}
          </ol>
        </div>
      )}
      <ol className="agent-list">
        {hidden > 0 && (
          <li className="more">
            <button type="button" onClick={() => setAll(true)}>
              <ChevronDown size={12} />
              {hidden} {hidden === 1 ? 'etapa anterior' : 'etapas anteriores'}
            </button>
          </li>
        )}
        {shown.slice(hidden).map((s, i) => {
          const kind = kindOf(s);
          return (
            <li key={i + hidden} className={kind} title={s.detail}>
              <span className="agent-icon" aria-hidden="true">
                {createElement(toolIcon(s.tool), { size: 12, strokeWidth: 2.1 })}
              </span>
              <span className="agent-label">{labelOf(s)}</span>
              {kind === 'warn' ? (
                <span className="agent-end warn">
                  <RotateCcw size={11} /> refeito
                </span>
              ) : s.ms !== undefined && s.ms >= 1000 ? (
                <span className="agent-end">{clock(s.ms)}</span>
              ) : null}
            </li>
          );
        })}
        {(running || thinking) && (
          <li className={running ? 'running' : 'thinking'}>
            <span className="agent-icon" aria-hidden="true">
              {createElement(running ? toolIcon(running.tool) : Brain, { size: 12, strokeWidth: 2.1 })}
            </span>
            <span className="agent-label">{running ? runningLabel(running) : 'Decidindo o próximo passo'}</span>
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
  const failed = steps.filter((s) => kindOf(s) === 'warn').length;
  return (
    <details className="agent-summary">
      <summary>
        <ListChecks size={13} />
        {steps.length} {steps.length === 1 ? 'etapa' : 'etapas'}
        {failed ? ` · ${failed} ${failed === 1 ? 'refeita' : 'refeitas'}` : ''}
      </summary>
      <AgentSteps steps={steps} plan={plan} compact />
    </details>
  );
}
