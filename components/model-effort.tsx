'use client';
import { Cpu } from 'lucide-react';
import { EFFORT_LABEL, EFFORTS, modelInfo, type Effort, type ModelKey } from '@/lib/models';

/**
 * O modelo do estúdio no compositor: só o nome, sem trocar (um modelo por
 * enquanto), e o esforço de raciocínio, que a pessoa escolhe por pedido.
 * Mais esforço pensa mais antes de mexer no projeto: demora e custa mais.
 */
export function ModelEffort({
  model,
  effort,
  onEffort,
  disabled,
}: {
  model: ModelKey;
  effort: Effort;
  onEffort: (next: Effort) => void;
  disabled?: boolean;
}) {
  const info = modelInfo(model);
  return (
    <div className="model-effort">
      <span className="model-name" title={`${info.label}: ${info.blurb}`}>
        <Cpu size={13} />
        <span>{info.label}</span>
      </span>
      {info.reasoning && (
        <fieldset className="effort-seg" aria-label="Esforço de raciocínio" disabled={disabled}>
          {EFFORTS.map((e) => (
            <button
              key={e}
              type="button"
              className={effort === e ? 'on' : ''}
              aria-pressed={effort === e}
              title={
                e === 'low'
                  ? 'Esforço baixo: mais rápido e barato, bom para ajustes'
                  : e === 'medium'
                    ? 'Esforço médio: pensa mais em pedidos com várias etapas'
                    : 'Esforço alto: o mais cuidadoso, para composições grandes; demora e custa mais'
              }
              onClick={() => onEffort(e)}
            >
              {EFFORT_LABEL[e]}
            </button>
          ))}
        </fieldset>
      )}
    </div>
  );
}
