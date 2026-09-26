'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type { Progress } from '@/lib/progress';
import { modelInfo, percent, reasoningLabel, tokensLabel, usageBreakdown, usd, type ModelKey, type TurnUsage } from '@/lib/models';
import { AgentSteps, type LiveStep } from './agent-steps';
import {
  ActivityGlyph,
  STAGES,
  clock,
  currentActivity,
  currentStage,
  stageOf,
  type Activity,
  type Pulse,
  type RunningTool,
} from './turn-activity';

export type { Pulse } from './turn-activity';

/** Evento de progresso com a hora em que chegou ao navegador. */
export type TimedProgress = Progress & { at?: number };

/** Assistente em laço: as ferramentas no lugar das etapas fixas. */
export type AgentLive = { steps: LiveStep[]; plan: string[]; running: RunningTool | null; say: string };

/** Frase do passo atual: a mesma no cartão da conversa, no cabeçalho e no selo da cena. */
export function turnActivity(events: Progress[], pulse: Pulse | null, agent?: AgentLive | null): Activity {
  return currentActivity(events, pulse, agent ? { steps: agent.steps.length, running: agent.running } : null);
}

/** Sem novidade do provedor por tanto tempo: aí sim vale avisar. */
const STALL_MS = 45_000;

/** Número que sobe suavemente até o alvo: o contador parece vivo, não aos saltos. */
function useTween(target: number) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const diff = target - current.current;
      current.current = Math.abs(diff) < 0.5 ? target : current.current + diff * 0.18;
      setValue(current.current);
      if (current.current !== target) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

export function TurnProgress({
  events,
  started,
  pulse,
  usage,
  model,
  withPhoto,
  agent,
  signalAt,
}: {
  events: TimedProgress[];
  started: number;
  pulse: Pulse | null;
  usage: TurnUsage | null;
  model: ModelKey;
  withPhoto: boolean;
  agent?: AgentLive;
  /** Quando chegou o último sinal do servidor (evento, bytes ou etapa). */
  signalAt: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const stage = currentStage(events, pulse);
  // A conferência do desenho só existe no caminho antigo (o laço confere com
  // render_look): a etapa aparece quando ela começa, não em todo pedido com foto.
  const stages = STAGES.filter((s) => s.id !== 'review' || (withPhoto && events.some((e) => e.stage === 'reviewing')));
  const index = stages.findIndex((s) => s.id === stage);
  // Quando cada etapa terminou: a chegada do primeiro evento de uma seguinte.
  const doneAt = (i: number) => {
    const next = events.find((e) => stages.findIndex((s) => s.id === stageOf(e.stage)) > i);
    return next?.at !== undefined ? next.at - started : undefined;
  };
  const info = modelInfo(model);
  // Tokens estimados pelo texto recebido (≈4 caracteres por token) até o
  // provedor mandar a conta exata, no fim de cada chamada.
  const streamedTokens = pulse ? (pulse.reasoning + pulse.answer) / 4 : 0;
  const exact = usage ? usage.inputTokens + usage.outputTokens : 0;
  const tokens = useTween(usage ? exact : streamedTokens);
  const liveCost = usage ? usage.costUsd : (streamedTokens * info.price.output) / 1_000_000;
  const split = usage ? usageBreakdown([usage]) : null;
  const retry = events.filter((e) => e.stage === 'retrying').length;
  const approach = [...events].reverse().find((e) => e.stage === 'proposing')?.detail;
  const elapsed = now - started;
  // O aviso de demora olha o silêncio, não o tempo total: pedido grande com
  // raciocínio alto demora e está tudo bem enquanto a IA continua mandando.
  const silent = now - Math.max(signalAt, started);
  const activity = turnActivity(events, pulse, agent);
  const agentMode = !!agent && (agent.steps.length > 0 || !!agent.running || agent.plan.length > 0);
  const kb = ((pulse?.bytes ?? 0) / 1024).toFixed(1).replace('.', ',');
  return (
    <output className="turn-progress" aria-live="polite">
      <span className="tp-sweep" aria-hidden="true" />
      <div className="tp-head">
        <ActivityGlyph activity={activity} />
        <div className="tp-title">
          <strong key={activity.key}>{activity.label}</strong>
          <small>
            {info.label}
            {info.reasoning ? ` · ${reasoningLabel(info)}` : ''}
            {retry ? ` · nova tentativa ${retry}` : ''}
          </small>
        </div>
        <time className="tp-clock" title="Tempo desde o envio">{clock(elapsed)}</time>
      </div>
      {agent?.say && <p className="tp-say">{agent.say}</p>}
      {agentMode ? (
        <AgentSteps
          steps={agent!.steps}
          plan={agent!.plan}
          running={agent!.running}
          thinking={!agent!.running && (stage === 'think' || stage === 'write')}
          limit={6}
        />
      ) : (
        <ol className="tp-steps">
          {stages.map((s, i) => {
            const state = i < index ? 'done' : i === index ? 'active' : 'todo';
            const Icon = state === 'active' && s.id === 'think' && retry ? RotateCcw : s.icon;
            return (
              <li key={s.id} className={state}>
                <span className="tp-icon" aria-hidden="true">
                  <Icon size={12} strokeWidth={2.1} />
                </span>
                <span className="tp-label">{state === 'active' ? s.active : s.label}</span>
                {state === 'done' &&
                  (doneAt(i) !== undefined ? (
                    <span className="tp-time">{clock(doneAt(i)!)}</span>
                  ) : (
                    <Check className="tp-time" size={12} />
                  ))}
              </li>
            );
          })}
        </ol>
      )}
      {!agentMode && approach && (
        <p className="tp-say">
          {approach}
          {stage === 'write' && <span className="text-caret" />}
        </p>
      )}
      <div className="tp-foot">
        <span
          title={
            usage
              ? `${tokensLabel(usage.inputTokens)} de entrada (${tokensLabel(split!.cached.tokens)} do cache) · ${tokensLabel(usage.outputTokens)} de saída${usage.reasoningTokens ? `, ${tokensLabel(usage.reasoningTokens)} de raciocínio` : ''} · ${usage.calls} ${usage.calls === 1 ? 'chamada' : 'chamadas'} · ${kb} kB recebidos`
              : `Estimativa pelo texto recebido (${kb} kB); a conta exata chega no fim de cada chamada`
          }
        >
          <b>{usage ? '' : '≈ '}{tokensLabel(tokens)}</b> tokens
        </span>
        {split && split.cached.tokens > 0 && (
          <span title={`O provedor reaproveitou ${tokensLabel(split.cached.tokens)} tokens de entrada e cobrou preço de cache: economia de ${usd(split.savedUsd)}`}>
            <b>{percent(split.hitRate)}</b> em cache
          </span>
        )}
        <span className="tp-cost" title="Custo estimado deste pedido pela tabela de preços do modelo">
          <b>{usage ? '' : '≈ '}{usd(liveCost)}</b>
        </span>
      </div>
      {silent > STALL_MS && (
        <p className="tp-slow">
          Sem sinal da IA há {clock(silent)}. Você pode parar e tentar de novo; nada muda no projeto até a validação.
        </p>
      )}
    </output>
  );
}
