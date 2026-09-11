'use client';
import { useState } from 'react';
import { Button } from './ui/button';
import { materials } from '@/lib/furniture';
import {
  generateComposition,
  type Cell,
  type Composition,
  type ModularOp,
  type Module,
} from '@/lib/composition';
export function ModularEditor({
  design,
  selected,
  onSelect,
  onOp,
  busy,
  onOpen,
  opened,
}: {
  design: Composition;
  selected: string[];
  onSelect: (ids: string[]) => void;
  onOp: (op: ModularOp, label: string) => Promise<void>;
  busy: boolean;
  onOpen: (id: string) => void;
  opened: Record<string, number>;
}) {
  const [parent, setParent] = useState(''),
    [side, setSide] = useState<'right' | 'left' | 'top'>('right'),
    [shared, setShared] = useState(false),
    [align, setAlign] = useState<'front' | 'back'>('front'),
    [offset, setOffset] = useState('0'),
    [openedSections, setOpenedSections] = useState<Record<string, boolean>>({});
  const g = generateComposition(design),
    target = selected.at(-1);
  const part = g.parts.find((p) => p.id === target);
  const cell =
    (target
      ? g.cells.find(
          (c) =>
            c.id === target ||
            c.node.split?.id === target ||
            c.node.front?.id === target,
        )
      : undefined) || g.cells.find((c) => c.id === part?.cellId);
  const m =
    design.modules.find(
      (m) => m.id === (cell?.moduleId || part?.owners[0] || target),
    ) || design.modules[0];
  const run = (op: ModularOp, label: string) => void onOp(op, label);
  const number = (data: FormData, key: string) => Number(data.get(key));
  const presets = ['shelf', 'niche', 'rack', 'drawers'] as const,
    presetNames = ['Estante', 'Nicho', 'Rack', 'Gaveteiro'];
  const presetIcons: Record<(typeof presets)[number], React.ReactNode> = {
    shelf: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="5" y="3" width="14" height="18" rx="1" />
        <path d="M5 9h14M5 15h14M9 9v6M15 9v6" />
      </svg>
    ),
    niche: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
        <path d="M12 3v9m0 0l8-4.5M12 12L4 7.5" />
      </svg>
    ),
    rack: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="9" width="18" height="9" rx="1" />
        <path d="M12 9v9M3 13.5h18" />
      </svg>
    ),
    drawers: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="5" y="4" width="14" height="16" rx="1" />
        <path d="M5 12h14M10 8h4M10 16h4" />
      </svg>
    ),
  };
  const nodeIcon = (node: Cell) =>
    node.split ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="4" y="4" width="16" height="16" rx="1.5" />
        {node.split.axis === 'x' ? (
          <path d="M12 4v16" />
        ) : (
          <path d="M4 9.3h16M4 14.6h16" />
        )}
      </svg>
    ) : node.front?.type === 'drawers' ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="5" y="4" width="14" height="16" rx="1.5" />
        <path d="M5 12h14M10.5 8h3M10.5 16h3" />
      </svg>
    ) : node.front ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="5" y="4" width="14" height="16" rx="1.5" />
        <path d="M12 4v16" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="4" y="4" width="16" height="16" rx="1.5" />
      </svg>
    );
  function tree(node: Cell): React.ReactNode {
    const info = g.cells.find((c) => c.id === node.id)!;
    const label = node.split
      ? node.split.axis === 'x'
        ? 'Colunas'
        : 'Prateleiras'
      : 'Compartimento';
    const dims =
      Math.round(info.size[0]) +
      ' × ' +
      Math.round(info.size[1]) +
      ' mm' +
      (node.front
        ? ' · ' +
          { single: 'porta', double: 'duas portas', drawers: 'gavetas' }[
            node.front.type
          ]
        : '');
    return (
      <div key={node.id} className="tree-branch">
        <div className="tree-node">
          <span className="tree-dot" />
          <button
            className={'tree-item ' + (target === node.id ? 'active' : '')}
            onClick={() => onSelect([node.id])}
          >
            <span className="tree-thumb">{nodeIcon(node)}</span>
            <span className="tree-text">
              <strong>{label}</strong>
              <small>{dims}</small>
            </span>
          </button>
        </div>
        {node.split?.children.map((c) => tree(c))}
      </div>
    );
  }
  return (
    <div className="modular-editor">
      {g.warnings.slice(1).map((w) => (
        <p className="warning" key={w}>
          {w}
        </p>
      ))}
      <div className="section-label">NOVO MÓDULO</div>
      <div className="preset-grid">
        {presets.map((preset, i) => (
          <Button
            key={preset}
            variant="outline"
            className="preset-button"
            disabled={busy}
            onClick={() =>
              run({ kind: 'module.add', preset }, `Adicionar ${presetNames[i]}`)
            }
          >
            {presetIcons[preset]}
            <span>{presetNames[i]}</span>
          </Button>
        ))}
      </div>
      <div className="module-tree" aria-label="Árvore da composição">
        {design.modules.map((mod) => {
          const open = openedSections[mod.id] !== false;
          return (
            <section className="tree-section" key={mod.id}>
              <button
                className="tree-header"
                aria-expanded={open}
                onClick={() =>
                  setOpenedSections((s) => ({ ...s, [mod.id]: !open }))
                }
              >
                <span className="tree-badge">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  >
                    <rect x="5" y="3" width="14" height="18" rx="1" />
                    <path d="M5 9h14M5 15h14" />
                  </svg>
                </span>
                <span className="tree-header-name">{mod.name}</span>
                <svg
                  className="tree-chevron"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {open && <div className="tree-children">{tree(mod.root)}</div>}
            </section>
          );
        })}
      </div>
      <p className="module-breadcrumb">
        Composição / {m.name}
        {cell ? ' / Compartimento' : ''}
        {part ? ' / ' + part.name : ''}
      </p>
      {part && part.owners.length > 1 && (
        <p className="warning">
          Painel compartilhado por{' '}
          {part.owners
            .map((id) => design.modules.find((m) => m.id === id)?.name)
            .join(' e ')}
          .
        </p>
      )}
      <details key={target ?? m.id} open={!cell}>
        <summary>Propriedades de {m.name}</summary>
        <form
          key={
            m.id +
            JSON.stringify(m.position) +
            m.width +
            m.height +
            m.depth +
            m.rotation +
            m.name +
            m.materialId +
            m.back
          }
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            run(
              {
                kind: 'module.edit',
                id: m.id,
                name: formText(data, 'name'),
                width: number(data, 'width'),
                height: number(data, 'height'),
                depth: number(data, 'depth'),
                materialId: formText(data, 'material') as Module['materialId'],
                back: data.get('back') === 'on',
                rotation: number(data, 'rotation') as Module['rotation'],
                ...(!design.connections.some((c) => c.child === m.id)
                  ? {
                      position: [
                        number(data, 'x'),
                        number(data, 'y'),
                        number(data, 'z'),
                      ] as [number, number, number],
                    }
                  : {}),
              },
              'Editar módulo',
            );
          }}
        >
          <label>
            Nome do módulo
            <input name="name" defaultValue={m.name} required maxLength={80} />
          </label>
          <div className="fields">
            {(['width', 'height', 'depth'] as const).map((k, i) => (
              <label key={k}>
                {['Largura', 'Altura', 'Profundidade'][i]} (mm)
                <input
                  type="number"
                  name={k}
                  defaultValue={m[k]}
                  min={200}
                  max={[1200, 2400, 800][i]}
                  required
                />
              </label>
            ))}
          </div>
          <label>
            Acabamento
            <select name="material" defaultValue={m.materialId}>
              {materials.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Orientação
            <select name="rotation" defaultValue={m.rotation}>
              {[0, 90, 180, 270].map((r) => (
                <option key={r} value={r}>
                  {r}°
                </option>
              ))}
            </select>
          </label>
          <label className="check-label">
            <input name="back" type="checkbox" defaultChecked={m.back} /> Fundo
            sobreposto de 6 mm
          </label>
          {!design.connections.some((c) => c.child === m.id) && (
            <div className="fields">
              {(['x', 'y', 'z'] as const).map((k, i) => (
                <label key={k}>
                  {k.toUpperCase()} (mm)
                  <input
                    name={k}
                    type="number"
                    min={i === 1 ? 0 : -20000}
                    max={20000}
                    defaultValue={m.position[i]}
                    required
                  />
                </label>
              ))}
            </div>
          )}
          <Button disabled={busy} type="submit">
            Aplicar módulo
          </Button>
        </form>
        <div className="modular-actions">
          <Button
            disabled={busy}
            variant="outline"
            onClick={() =>
              run({ kind: 'module.duplicate', id: m.id }, `Duplicar ${m.name}`)
            }
          >
            Duplicar
          </Button>
          <Button
            disabled={busy || design.modules.length === 1}
            variant="outline"
            onClick={() =>
              run({ kind: 'module.remove', id: m.id }, 'Remover módulo')
            }
          >
            Remover
          </Button>
        </div>
        <details>
          <summary>Conectar e alinhar módulos</summary>
          <label>
            Módulo de referência
            <select value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">Escolher</option>
              {design.modules
                .filter((v) => v.id !== m.id)
                .map((v) => (
                  <option value={v.id} key={v.id}>
                    {v.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Posição
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as typeof side)}
            >
              <option value="right">À direita</option>
              <option value="left">À esquerda</option>
              <option value="top">Empilhado acima</option>
            </select>
          </label>
          <label>
            Alinhamento
            <select
              value={align}
              onChange={(e) => setAlign(e.target.value as typeof align)}
            >
              <option value="front">Frentes</option>
              <option value="back">Fundos</option>
            </select>
          </label>
          <label>
            Afastamento (mm)
            <input
              type="number"
              min={0}
              max={5000}
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
            />{' '}
            Compartilhar painel
          </label>
          <Button
            disabled={busy || !parent}
            onClick={() =>
              run(
                {
                  kind: 'connect',
                  parent,
                  child: m.id,
                  side,
                  shared,
                  align,
                  offset: Number(offset),
                },
                'Conectar módulos',
              )
            }
          >
            Conectar
          </Button>
          <Button
            variant="outline"
            disabled={busy || !design.connections.some((c) => c.child === m.id)}
            onClick={() =>
              run({ kind: 'disconnect', child: m.id }, 'Separar módulos')
            }
          >
            Separar módulos
          </Button>
        </details>
      </details>
      {cell && (
        <section className="cell-editor">
          <div className="section-label">COMPARTIMENTO SELECIONADO</div>
          {!cell.node.split && !cell.node.front && (
            <div className="modular-actions">
              <Button
                disabled={busy}
                variant="outline"
                onClick={() =>
                  run(
                    { kind: 'cell.split', id: cell.id, axis: 'x' },
                    'Dividir em colunas',
                  )
                }
              >
                Dividir ↔
              </Button>
              <Button
                disabled={busy}
                variant="outline"
                onClick={() =>
                  run(
                    { kind: 'cell.split', id: cell.id, axis: 'y' },
                    'Adicionar prateleira',
                  )
                }
              >
                Dividir ↕
              </Button>
            </div>
          )}
          {cell.node.split && (
            <>
              <form
                key={cell.id + cell.node.split.ratio}
                onSubmit={(e) => {
                  e.preventDefault();
                  run(
                    {
                      kind: 'cell.move',
                      id: cell.id,
                      gapMm: number(new FormData(e.currentTarget), 'gap'),
                    },
                    'Mover divisória',
                  );
                }}
              >
                <label>
                  {cell.node.split.axis === 'x'
                    ? 'Vão à esquerda'
                    : 'Vão abaixo'}{' '}
                  (mm)
                  <input
                    name="gap"
                    type="number"
                    min={100}
                    defaultValue={Math.round(
                      (cell.size[cell.node.split.axis === 'x' ? 0 : 1] - 18) *
                        cell.node.split.ratio,
                    )}
                    required
                  />
                </label>
                <Button disabled={busy}>Aplicar vão</Button>
              </form>
              <div className="modular-actions">
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    run(
                      { kind: 'cell.distribute', id: cell.id },
                      'Distribuir divisões',
                    )
                  }
                >
                  Distribuir
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    run(
                      { kind: 'cell.merge', id: cell.id },
                      'Mesclar compartimentos',
                    )
                  }
                >
                  Mesclar
                </Button>
              </div>
            </>
          )}
          {!cell.node.split && (
            <FrontControls
              key={cell.id + JSON.stringify(cell.node.front)}
              cell={cell.node}
              module={m}
              busy={busy}
              run={run}
            />
          )}{' '}
          {cell.node.front?.type === 'drawers' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                run(
                  {
                    kind: 'drawer.height',
                    id: cell.id,
                    index: number(data, 'index'),
                    height: number(data, 'height'),
                  },
                  'Ajustar altura da frente',
                );
              }}
            >
              <label>
                Gaveta
                <select name="index">
                  {cell.node.front.heights.map((_, i) => (
                    <option key={i} value={i}>
                      Gaveta {i + 1} (de baixo para cima)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Altura da frente (mm)
                <input name="height" type="number" min={80} required />
              </label>
              <Button disabled={busy}>Redistribuir frentes</Button>
            </form>
          )}
          {[
            ...new Set(
              g.parts
                .filter((p) => p.cellId === cell.id && p.motion)
                .map((p) => p.motion!.id),
            ),
          ].map((id, i) => (
            <Button
              className="opening-button"
              key={id}
              variant="outline"
              onClick={() => onOpen(id)}
            >
              {opened[id] ? 'Fechar' : 'Abrir'}{' '}
              {cell.node.front?.type === 'drawers' ? 'gaveta' : 'porta'} {i + 1}
            </Button>
          ))}
        </section>
      )}
      <p className="warning">
        Peças nominais. Ferragens, furação, montagem, apoio e resistência
        precisam de revisão profissional.
      </p>
    </div>
  );
}
function FrontControls({
  cell,
  module,
  busy,
  run,
}: {
  cell: Cell;
  module: Module;
  busy: boolean;
  run: (op: ModularOp, label: string) => void;
}) {
  const [type, setType] = useState<'none' | 'single' | 'double' | 'drawers'>(
    cell.front?.type ?? 'none',
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        run(
          {
            kind: 'front.set',
            id: cell.id,
            type,
            ...(type === 'single'
              ? { hinge: formText(data, 'hinge') as 'left' | 'right' }
              : {}),
            ...(type === 'drawers' ? { count: Number(data.get('count')) } : {}),
            ...(type !== 'none'
              ? {
                  materialId: formText(
                    data,
                    'material',
                  ) as Module['materialId'],
                }
              : {}),
          },
          'Editar frente',
        );
      }}
    >
      <label>
        Frente
        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
        >
          <option value="none">Aberto</option>
          <option value="single">Porta simples</option>
          <option value="double">Porta dupla</option>
          <option value="drawers">Gavetas</option>
        </select>
      </label>
      {type === 'single' && (
        <label>
          Dobradiça
          <select name="hinge" defaultValue={cell.front?.hinge ?? 'left'}>
            <option value="left">Esquerda</option>
            <option value="right">Direita</option>
          </select>
        </label>
      )}
      {type === 'drawers' && (
        <label>
          Quantidade de gavetas
          <input
            name="count"
            type="number"
            min={1}
            max={6}
            defaultValue={
              cell.front?.type === 'drawers' ? cell.front.heights.length : 3
            }
            required
          />
        </label>
      )}
      {type !== 'none' && (
        <label>
          Material da frente
          <select
            name="material"
            defaultValue={cell.front?.materialId ?? module.materialId}
          >
            {materials.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button type="submit" disabled={busy}>
        Aplicar frente
      </Button>
    </form>
  );
}

function formText(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}
