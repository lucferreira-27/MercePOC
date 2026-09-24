'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type { Progress } from '@/lib/progress';
import { modelInfo, tokensLabel, usd, type ModelKey, type TurnUsage } from '@/lib/models';

/** Sinal de vida do provedor: quanto já chegou, sem o conteúdo privado. */
export type Pulse = { bytes: number; reasoning: number; answer: number; attempt: number };

type StepId = 'send' | 'think' | 'write' | 'check' | 'review' | 'apply';
const STEPS: { id: StepId; label: string; active: string }[] = [
  { id: 'send', label: 'Pedido enviado', active: 'Enviando o pedido e o projeto' },
  { id: 'think', label: 'Raciocínio', active: 'Pensando no seu pedido' },
  { id: 'write', label: 'Proposta escrita', active: 'Escrevendo a proposta' },
  { id: 'check', label: 'Medidas conferidas', active: 'Conferindo medidas e encaixes' },
  { id: 'review', label: 'Desenho comparado', active: 'Comparando o desenho com a foto' },
  { id: 'apply', label: 'Versão salva', active: 'Aplicando e salvando a versão' },
];

/** Evento de progresso com a hora em que chegou ao navegador. */
export type TimedProgress = Progress & { at?: number };

function stepOfStage(stage: Progress['stage'] | undefined): StepId {
  if (stage === 'applying' || stage === 'saving') return 'apply';
  if (stage === 'reviewing') return 'review';
  if (stage === 'validating') return 'check';
  if (stage === 'proposing') return 'write';
  if (stage === 'interpreting' || stage === 'connecting' || stage === 'retrying') return 'think';
  return 'send';
}
/** Em que passo o turno está, pelo último evento e pelo que já chegou. */
function stepOf(events: Progress[], pulse: Pulse | null): StepId {
  const step = stepOfStage(events.at(-1)?.stage);
  if (step === 'think' && pulse && pulse.answer > 0) return 'write';
  if (step === 'send' && pulse) return 'think';
  return step;
}

/** Frase do passo atual: a mesma no cartão da conversa e no selo da cena. */
export function turnLabel(events: Progress[], pulse: Pulse | null) {
  const step = stepOf(events, pulse);
  return STEPS.find((s) => s.id === step)?.active ?? 'Trabalhando';
}

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

function clock(ms: number) {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1).replace('.', ',')} s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export function TurnProgress({
  events,
  started,
  pulse,
  usage,
  model,
  withPhoto,
}: {
  events: TimedProgress[];
  started: number;
  pulse: Pulse | null;
  usage: TurnUsage | null;
  model: ModelKey;
  withPhoto: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  const current = stepOf(events, pulse);
  const steps = STEPS.filter((s) => s.id !== 'review' || withPhoto);
  const index = steps.findIndex((s) => s.id === current);
  // Quando cada passo terminou: é a chegada do primeiro evento de um passo
  // seguinte. O tempo aparece ao lado do passo concluído.
  const doneAt = (i: number) => {
    const next = events.find((e) => steps.findIndex((s) => s.id === stepOfStage(e.stage)) > i);
    return next?.at !== undefined ? next.at - started : undefined;
  };
  const info = modelInfo(model);
  // Tokens estimados pelo texto recebido (≈4 caracteres por token) até o
  // provedor mandar a conta exata, no fim de cada chamada.
  const streamedTokens = pulse ? (pulse.reasoning + pulse.answer) / 4 : 0;
  const exactTokens = usage ? usage.outputTokens : 0;
  const tokens = useTween(Math.max(streamedTokens, exactTokens));
  const liveCost = usage ? usage.costUsd : (streamedTokens * info.price.output) / 1_000_000;
  const kb = useTween((pulse?.bytes ?? 0) / 1024);
  const retry = events.filter((e) => e.stage === 'retrying').length;
  const approach = [...events].reverse().find((e) => e.stage === 'proposing')?.detail;
  const elapsed = now - started;
  const latest = events.at(-1);
  return (
    <output className="turn-progress" aria-live="polite">
      <div className="tp-head">
        {/* Cada pulso do provedor remonta o indicador e dá uma batida: o
            movimento acompanha o que está chegando, não é enfeite. */}
        <span className="tp-orb" key={pulse?.bytes ?? 0} aria-hidden="true">
          <i />
        </span>
        <div className="tp-title">
          <strong>{steps[Math.max(0, index)]?.active ?? 'Trabalhando'}</strong>
          <small>
            {info.label}
            {info.reasoning ? ' · raciocínio baixo' : ''}
            {retry ? ` · nova tentativa ${retry}` : ''}
          </small>
        </div>
        <time className="tp-clock">{clock(elapsed)}</time>
      </div>
      <ol className="tp-steps">
        {steps.map((s, i) => {
          const state = i < index ? 'done' : i === index ? 'active' : 'todo';
          return (
            <li key={s.id} className={state}>
              <span className="tp-dot" aria-hidden="true">
                {state === 'done' ? <Check size={11} strokeWidth={3} /> : state === 'active' && s.id === 'think' && retry ? <RotateCcw size={10} /> : null}
              </span>
              <span className="tp-label">{state === 'active' ? s.active : s.label}</span>
              {state === 'done' && doneAt(i) !== undefined && (
                <span className="tp-time">{clock(doneAt(i)!)}</span>
              )}
            </li>
          );
        })}
      </ol>
      {approach && (
        <p className="tp-approach">
          {approach}
          {current === 'write' && <span className="text-caret" />}
        </p>
      )}
      {!approach && latest?.detail && current !== 'think' && <p className="tp-detail">{latest.detail}</p>}
      <div className="tp-stats">
        <span title="Dados recebidos do provedor, incluindo o raciocínio que não é exibido">
          <b>{kb.toFixed(1).replace('.', ',')} kB</b> recebidos
        </span>
        <span title={usage ? 'Tokens de saída contados pelo provedor' : 'Estimativa pelo texto recebido; o número exato chega no fim da chamada'}>
          <b>{usage ? '' : '≈ '}{tokensLabel(tokens)}</b> tokens
        </span>
        <span title="Custo estimado pela tabela de preços do modelo">
          <b>{usage ? '' : '≈ '}{usd(liveCost)}</b>
        </span>
      </div>
      <div className="tp-bar" aria-hidden="true">
        <span style={{ width: `${Math.min(96, ((index + 0.5) / steps.length) * 100)}%` }} />
      </div>
      {elapsed > 25000 && (
        <p className="tp-slow">
          {elapsed > 60000
            ? 'Está levando mais que o habitual. Você pode parar e tentar de novo; nada muda no projeto até a validação.'
            : 'Pedidos com várias peças levam mais tempo. O projeto só muda depois da validação.'}
        </p>
      )}
    </output>
  );
}
