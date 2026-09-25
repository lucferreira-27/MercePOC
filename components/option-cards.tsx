'use client';

import { useMemo } from 'react';
import { Check, GitBranch } from 'lucide-react';
import { drawingParts } from '@/lib/composition';
import { canonical, type Design } from '@/lib/studio';
import { money } from '@/lib/quote';
import type { OptionCard } from '@/lib/agent/types';
import { Button } from '@/components/ui/button';
import { PlanThumb } from './plan-thumb';

const cm = (mm: number) => `${Math.round(mm / 10)}`;

/**
 * Opções que o assistente montou para comparar, lado a lado. Os números são
 * do código (orçamento, chapas, peças); a frase é da IA. Aplicar vira uma
 * versão do projeto; "Salvar como alternativa" cria um projeto à parte.
 */
export function OptionCards({
  options,
  current,
  disabled,
  onApply,
  onFork,
}: {
  options: OptionCard[];
  /** Design aberto agora: a opção igual a ele aparece como "Em uso". */
  current: Design | undefined;
  disabled: boolean;
  onApply: (o: OptionCard) => void;
  onFork: (o: OptionCard) => void;
}) {
  const parts = useMemo(() => options.map((o) => drawingParts(canonical(o.params as Design))), [options]);
  const now = current ? JSON.stringify(current) : '';
  const cheapest = Math.min(...options.map((o) => o.total));
  return (
    <div className="option-cards" role="group" aria-label="Opções para comparar">
      {options.map((o, i) => {
        const inUse = now === JSON.stringify(o.params);
        return (
          <article className={'option-card' + (inUse ? ' in-use' : '')} key={o.id}>
            <header>
              <span className="option-letter">{String.fromCharCode(65 + i)}</span>
              <strong title={o.brief}>{o.name}</strong>
            </header>
            <span className="option-art">
              <PlanThumb parts={parts[i]} width={200} height={130} />
            </span>
            <div className="option-price">
              <b>{money(o.total)}</b>
              {o.total === cheapest && options.length > 1 && <em>mais barata</em>}
            </div>
            <dl className="option-facts">
              <div>
                <dt>Medidas</dt>
                <dd>
                  {cm(o.size[0])} × {cm(o.size[1])} × {cm(o.size[2])} cm
                </dd>
              </div>
              <div>
                <dt>Chapas</dt>
                <dd>{o.sheets}</dd>
              </div>
              <div>
                <dt>Peças</dt>
                <dd>{o.parts}</dd>
              </div>
              <div>
                <dt>Frentes</dt>
                <dd>
                  {o.doors} portas · {o.drawers} gavetas
                </dd>
              </div>
            </dl>
            {o.fits !== null && <p className={'option-fit ' + (o.fits ? 'ok' : 'bad')}>{o.fits ? 'Cabe no ambiente' : 'Não cabe no ambiente'}</p>}
            {o.note && (
              <p className="option-note" title={o.note}>
                {o.note}
              </p>
            )}
            <div className="option-actions">
              {inUse ? (
                <span className="option-in-use">
                  <Check size={14} /> Em uso
                </span>
              ) : (
                <Button size="sm" disabled={disabled} onClick={() => onApply(o)}>
                  Aplicar
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={disabled} onClick={() => onFork(o)} title="Cria um projeto à parte com esta opção">
                <GitBranch size={14} /> Salvar como alternativa
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
