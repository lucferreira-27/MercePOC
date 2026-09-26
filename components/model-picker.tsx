'use client';
import { useEffect, useRef, useState } from 'react';
import { Bug, Check, ChevronDown, Cpu } from 'lucide-react';
import { DEFAULT_MODEL, MODELS, modelInfo, reasoningLabel, type ModelKey } from '@/lib/models';

/** Preço por milhão de tokens em uma linha curta: "US$ 0,14 / 0,56". */
function priceLine(key: ModelKey) {
  const p = modelInfo(key).price;
  const n = (v: number) => v.toFixed(2).replace('.', ',');
  return `US$ ${n(p.input)} entrada · ${n(p.output)} saída por mi tokens`;
}

/**
 * Escolha do modelo no compositor. Substitui o botão "Rápido": são três
 * modelos com custo e jeito diferentes, e a pessoa escolhe sabendo o preço. A
 * transmissão de depuração mora aqui também, longe do caminho principal.
 */
export function ModelPicker({
  value,
  available,
  onChange,
  live,
  onToggleLive,
  disabled,
}: {
  value: ModelKey;
  /** Modelos com credencial no servidor; vazio enquanto não se sabe. */
  available: ModelKey[];
  onChange: (key: ModelKey) => void;
  live: boolean;
  onToggleLive: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const info = modelInfo(value);
  return (
    <div className="model-picker" ref={wrap}>
      <button
        type="button"
        className="model-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={disabled ? 'Aguarde a resposta atual para trocar de modelo' : 'Escolher o modelo de IA'}
        onClick={() => setOpen((v) => !v)}
      >
        <Cpu size={13} />
        <span>{info.label}</span>
        {info.reasoning && <em>{info.reasoning === 'high' ? 'alto' : 'baixo'}</em>}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="model-menu" role="menu">
          <div className="model-menu-head">Modelo de IA</div>
          {MODELS.map((m) => {
            const usable = !available.length || available.includes(m.key);
            return (
              <button
                key={m.key}
                type="button"
                role="menuitemradio"
                aria-checked={m.key === value}
                disabled={!usable}
                className={m.key === value ? 'on' : ''}
                onClick={() => {
                  onChange(m.key);
                  setOpen(false);
                }}
              >
                <span className="model-check">{m.key === value && <Check size={14} />}</span>
                <span className="model-text">
                  <strong>
                    {m.label}
                    {m.reasoning && <em>{reasoningLabel(m)}</em>}
                    {m.fastProfile && <em>rápido</em>}
                    {m.key === DEFAULT_MODEL && <em className="model-default">padrão</em>}
                  </strong>
                  <small>{usable ? m.blurb : 'Sem credencial neste servidor (.env)'}</small>
                  <small className="model-price">{priceLine(m.key)}</small>
                </span>
              </button>
            );
          })}
          <label className="model-debug">
            <input type="checkbox" checked={live} onChange={onToggleLive} />
            <Bug size={13} />
            <span>
              Transmissão ao vivo (depuração)
              <small>Mostra o texto parcial e o raciocínio enquanto chegam</small>
            </span>
          </label>
          <p className="model-foot">
            Preços de tabela para estimar o custo. Ajuste em <code>.env</code> com MERCE_PRICE_*.
          </p>
        </div>
      )}
    </div>
  );
}
