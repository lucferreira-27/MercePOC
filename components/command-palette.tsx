'use client';
import { useEffect, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';

export type PaletteAction = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keys?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  run: () => void;
};

/**
 * Paleta de comandos (Ctrl+K): tudo o que a interface faz, por nome. Com três
 * painéis e uma cena 3D, procurar o botão certo custava mais do que digitar o
 * que se quer. Uma linha que não é comando vira pedido para a IA.
 */
export function CommandPalette({
  open,
  onClose,
  actions,
  onAsk,
}: {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
  onAsk: (text: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  // A página remonta a paleta a cada abertura (key), então a busca já nasce
  // vazia; aqui só o foco.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => input.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);
  if (!open) return null;
  const groups = [...new Set(actions.map((a) => a.group))];
  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Command
        className="palette"
        label="Paleta de comandos"
        loop
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
          // Nenhum comando corresponde: Enter manda a frase para a IA.
          const text = query.trim();
          if (e.key === 'Enter' && text && !e.currentTarget.querySelector('[cmdk-item]')) {
            e.preventDefault();
            onClose();
            onAsk(text);
          }
        }}
      >
        <div className="palette-input">
          <Search size={16} />
          <Command.Input
            ref={input}
            placeholder="Buscar ação, vista, painel… ou pedir algo para a IA"
            value={query}
            onValueChange={setQuery}
          />
          <kbd>Esc</kbd>
        </div>
        <Command.List className="palette-list">
          <Command.Empty>
            <button
              type="button"
              className="palette-ask"
              onClick={() => {
                const text = query.trim();
                if (!text) return;
                onClose();
                onAsk(text);
              }}
            >
              Pedir para a IA: “{query}” <kbd>Enter</kbd>
            </button>
          </Command.Empty>
          {groups.map((group) => (
            <Command.Group key={group} heading={group}>
              {actions
                .filter((a) => a.group === group)
                .map((a) => (
                  <Command.Item
                    key={a.id}
                    value={`${a.label} ${a.hint ?? ''} ${a.group}`}
                    disabled={a.disabled}
                    onSelect={() => {
                      onClose();
                      a.run();
                    }}
                  >
                    <span className="palette-icon">{a.icon}</span>
                    <span className="palette-label">
                      {a.label}
                      {a.hint && <small>{a.hint}</small>}
                    </span>
                    {a.keys && <kbd>{a.keys}</kbd>}
                  </Command.Item>
                ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
