'use client';
import { materials } from '@/lib/furniture';

/**
 * Amostras de acabamento no lugar de uma lista suspensa: com nove acabamentos
 * a pessoa escolhe pela cor. São rádios nativos com o mesmo `name`, então o
 * formulário continua lendo o valor por FormData, como lia do select.
 */
export function FinishPicker({ name, defaultValue }: { name: string; defaultValue: string }) {
  return (
    <span className="finish-picker" role="radiogroup">
      {materials.map((m) => (
        <label key={m.id} className="finish-swatch" title={m.name}>
          <input type="radio" name={name} value={m.id} defaultChecked={m.id === defaultValue} />
          <span
            className={'swatch-chip' + (m.finish === 'wood' ? ' wood' : '')}
            style={{ '--swatch': m.color } as React.CSSProperties}
          />
          <span className="swatch-name">{m.name}</span>
        </label>
      ))}
    </span>
  );
}
