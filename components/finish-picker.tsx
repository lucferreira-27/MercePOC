'use client';
import { materials, type MaterialCategory } from '@/lib/furniture';

/**
 * Amostras de acabamento no lugar de uma lista suspensa: a pessoa escolhe
 * pela cor. São rádios nativos com o mesmo `name`, então o formulário continua
 * lendo o valor por FormData, como lia do select. Só aparecem os materiais que
 * a peça aceita: corpo e frente são de chapa; pé, tampo e puxador têm os seus.
 */
export function FinishPicker({
  name,
  defaultValue,
  categories = ['sheet'],
}: {
  name: string;
  defaultValue: string;
  categories?: MaterialCategory[];
}) {
  return (
    <span className="finish-picker" role="radiogroup">
      {materials
        .filter((m) => categories.includes(m.category))
        .map((m) => (
          <label key={m.id} className="finish-swatch" title={m.name}>
            <input type="radio" name={name} value={m.id} defaultChecked={m.id === defaultValue} />
            <span
              className={'swatch-chip' + (m.finish === 'wood' ? ' wood' : m.category !== 'sheet' ? ` ${m.finish}` : '')}
              style={{ '--swatch': m.color } as React.CSSProperties}
            />
            <span className="swatch-name">{m.name}</span>
          </label>
        ))}
    </span>
  );
}
