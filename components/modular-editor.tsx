'use client';
import { memo, useMemo, useState } from 'react';
import { Button } from './ui/button';
import { FinishPicker } from './finish-picker';
import { LookEditor } from './look-editor';
import { materials } from '@/lib/furniture';
import {
  generateComposition,
  type Cell,
  type Composition,
  type Front,
  type ModularOp,
  type Module,
} from '@/lib/composition';
import { FRONT_STYLES, FRONTS, framedFront, HANDLE_TYPES, HANDLES, type FrontStyle, type HandleType } from '@/lib/look';

/** Limites do formulário em português: o balão nativo chega em inglês. */
const sizeHints = [
  'Largura: 200 a 1200 mm.',
  'Altura: 200 a 2400 mm.',
  'Profundidade: 200 a 800 mm.',
];
/** Painel de parede: uma chapa de até 2700 × 1800 mm, 15 a 60 de espessura. */
const panelHints = [
  'Largura: 200 a 2700 mm (o menor lado até 1800).',
  'Altura: 200 a 2700 mm (o menor lado até 1800).',
  'Espessura: 15 a 60 mm.',
];
/** Prateleira de parede: tábua de até 2700 mm, 15 a 60 de espessura, 150 a 600 de fundo. */
const ledgeHints = [
  'Largura: 200 a 2700 mm.',
  'Espessura: 15 a 60 mm.',
  'Profundidade: 150 a 600 mm.',
];
const axisHints = [
  'X: -20000 a 20000 mm.',
  'Y: 0 a 20000 mm.',
  'Z: -20000 a 20000 mm.',
];

type PanelScope = 'module' | 'actions' | 'cell' | 'front' | 'connect' | 'look';
type PanelError = {
  scope: PanelScope;
  message: string;
  /** Limite do próprio campo: o aviso some quando o usuário digita de novo. */
  limit?: boolean;
  /** Pedido recusado pelo servidor: guarda a op para repetir em lote. */
  edit?: Extract<ModularOp, { kind: 'module.edit' }>;
};

/**
 * Conectar com painel compartilhado iguala o filho à referência. A regra é a
 * de `settle`, então o painel mostra antes exatamente o que o servidor faria.
 */
function sharedChanges(
  child: Module,
  reference: Module,
  side: 'right' | 'left' | 'top',
  offset: number,
) {
  const changes: string[] = [];
  const measure = (label: string, from: number, to: number) => {
    if (from !== to) changes.push(`${label}: ${from} → ${to} mm`);
  };
  if (side === 'top') measure('Largura', child.width, reference.width);
  else measure('Altura', child.height, reference.height);
  measure('Profundidade', child.depth, reference.depth);
  if (child.materialId !== reference.materialId) {
    const from =
      materials.find((v) => v.id === child.materialId)?.name ?? child.materialId;
    const to =
      materials.find((v) => v.id === reference.materialId)?.name ??
      reference.materialId;
    changes.push(`Acabamento: ${from} → ${to}`);
  }
  if (child.rotation !== reference.rotation)
    changes.push(`Orientação: ${child.rotation}° → ${reference.rotation}°`);
  if (offset !== 0) changes.push(`Afastamento: ${offset} → 0 mm`);
  return changes;
}

/** O mesmo texto vale para o balão do navegador e para o aviso do painel. */
function limitHint(message: string, onLimit: (message: string) => void) {
  return {
    onInvalid: (e: React.SyntheticEvent<HTMLInputElement>) => {
      e.currentTarget.setCustomValidity(message);
      onLimit(message);
    },
    onInput: (e: React.SyntheticEvent<HTMLInputElement>) => {
      e.currentTarget.setCustomValidity('');
      onLimit('');
    },
  };
}

/** Memorizado: um render da página (pulso da IA, aviso) não refaz o painel. */
export const ModularEditor = memo(ModularEditorPanel);

function ModularEditorPanel({
  design,
  selected,
  onSelect,
  onOp,
  onOps,
  onLibrary,
  busy,
  onOpen,
  opened,
}: {
  /** Abre a biblioteca de móveis prontos para somar ao projeto. */
  onLibrary?: () => void;
  design: Composition;
  selected: string[];
  /** `extend` é o shift+clique: o pai soma o conjunto à seleção. */
  onSelect: (ids: string[], extend?: boolean) => void;
  onOp: (op: ModularOp, label: string) => Promise<void>;
  /** Lote atômico: o servidor aceita { action: 'ops', ops: [...] }. */
  onOps?: (ops: ModularOp[], label: string) => Promise<void>;
  busy: boolean;
  onOpen: (id: string) => void;
  opened: Record<string, number>;
}) {
  const [parent, setParent] = useState(''),
    [side, setSide] = useState<'right' | 'left' | 'top'>('right'),
    [shared, setShared] = useState(false),
    [align, setAlign] = useState<'front' | 'back'>('front'),
    [offset, setOffset] = useState('0'),
    [openedSections, setOpenedSections] = useState<Record<string, boolean>>({}),
    [error, setError] = useState<PanelError | null>(null),
    [confirmShare, setConfirmShare] = useState<{
      op: ModularOp;
      changes: string[];
    } | null>(null),
    /** Renova o formulário do módulo: a `key` sobe a cada edição recusada. */
    [editAttempt, setEditAttempt] = useState(0);
  // Uma geração por versão: antes cada tecla nos campos do painel refazia o móvel.
  const g = useMemo(() => generateComposition(design), [design]),
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
  /** Erro do módulo em foco: recusa de outro módulo não aparece neste painel. */
  const moduleError =
    error?.scope === 'module' && (!error.edit || error.edit.id === m.id)
      ? error
      : null;
  const sayLimit = (scope: PanelScope, message: string) => {
    setError((prev) =>
      message
        ? { scope, message, limit: true }
        : prev?.limit && prev.scope === scope
          ? null
          : prev,
    );
  };
  /** Guarda a recusa do servidor junto do formulário que a originou. */
  const fail = (scope: PanelScope, e: unknown, ops: ModularOp[]) => {
    setError({
      scope,
      message: e instanceof Error ? e.message : String(e),
      ...(ops.length === 1 && ops[0].kind === 'module.edit'
        ? { edit: ops[0] }
        : {}),
    });
    // O formulário renasce dos valores atuais do módulo: um campo recusado não
    // pode continuar mostrando o que o servidor não aceitou, o que parecia
    // ter sido aplicado.
    if (ops.some((op) => op.kind === 'module.edit'))
      setEditAttempt((n) => n + 1);
  };
  /**
   * O servidor pode recusar (HTTP 422) e rejeitar: a mensagem fica no painel
   * perto do formulário que a pediu, em vez de sumir sem explicação.
   */
  const run = async (
    op: ModularOp,
    label: string,
    scope: PanelScope = 'module',
  ) => {
    setError(null);
    try {
      await onOp(op, label);
      setConfirmShare(null);
    } catch (e) {
      fail(scope, e, [op]);
    }
  };
  const runBatch = (ops: ModularOp[], label: string) => {
    const send = onOps;
    if (!send) return;
    setError(null);
    send(ops, label).catch((e: unknown) => fail('module', e, ops));
  };
  /** Irmãos de painel compartilhado: qualquer ponta de conexão `shared`. */
  const sharedSiblings = (id: string) => {
    const ids: string[] = [];
    for (const c of design.connections)
      if (c.shared) {
        const other = c.parent === id ? c.child : c.child === id ? c.parent : '';
        if (other && !ids.includes(other)) ids.push(other);
      }
    return ids;
  };
  /** Repete a edição recusada no módulo e nos irmãos, num lote atômico só. */
  const alignShared = () => {
    const edit = moduleError?.edit;
    if (!edit) return;
    const ops = [edit.id, ...sharedSiblings(edit.id)].map((id): ModularOp => ({
      kind: 'module.edit',
      id,
      // O irmão fica com o próprio nome: dois módulos homônimos confundem a
      // árvore e a lista de peças.
      ...(id === edit.id ? { name: edit.name } : {}),
      width: edit.width,
      height: edit.height,
      depth: edit.depth,
      materialId: edit.materialId,
      back: edit.back,
      rotation: edit.rotation,
      // Módulo filho não aceita posição: quem manda nela é a conexão.
      ...(edit.position && !design.connections.some((c) => c.child === id)
        ? { position: edit.position }
        : {}),
    }));
    runBatch(ops, 'Igualar painel compartilhado');
  };
  const requestConnect = () => {
    if (!parent) return;
    const offsetMm = Number(offset);
    // O afastamento vive fora de um formulário, então a validação é aqui.
    if (!Number.isFinite(offsetMm) || offsetMm < 0 || offsetMm > 5000) {
      sayLimit('connect', 'Afastamento: 0 a 5000 mm.');
      return;
    }
    const reference = design.modules.find((v) => v.id === parent);
    const op: ModularOp = {
      kind: 'connect',
      parent,
      child: m.id,
      side,
      shared,
      align,
      offset: offsetMm,
    };
    const changes =
      shared && reference ? sharedChanges(m, reference, side, offsetMm) : [];
    if (changes.length) setConfirmShare({ op, changes });
    else void run(op, 'Conectar módulos', 'connect');
  };
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
          { single: 'porta', double: 'duas portas', drawers: 'gavetas', sliding: 'porta de correr', flap: 'basculante' }[
            node.front.type
          ]
        : '');
    return (
      <div key={node.id} className="tree-branch">
        <div className="tree-node">
          <span className="tree-dot" />
          <button
            className={
              'tree-item touch-target ' + (target === node.id ? 'active' : '')
            }
            title="Clique para selecionar · Shift+clique seleciona o módulo inteiro"
            onClick={(e) => onSelect([node.id], e.shiftKey)}
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
      {onLibrary && (
        <button type="button" className="library-button" aria-label="Biblioteca de móveis" disabled={busy} onClick={onLibrary}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <rect x="3" y="4" width="7" height="7" rx="1" />
            <rect x="14" y="4" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M17.5 14v7M14 17.5h7" />
          </svg>
          <span>
            <strong>Biblioteca de móveis</strong>
            <small>Rack de TV, cozinha, cômoda, painel… prontos para encaixar</small>
          </span>
        </button>
      )}
      <div className="module-tree" aria-label="Árvore da composição">
        {design.modules.map((mod) => {
          const open = openedSections[mod.id] !== false;
          return (
            <section className="tree-section" key={mod.id}>
              <button
                className="tree-header touch-target"
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
                  className="tree-chevron touch-target"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {open && (
                <div className="tree-children">
                  {mod.kind === 'panel' ? (
                    <div className="tree-branch">
                      <div className="tree-node">
                        <span className="tree-dot" />
                        <button
                          className={'tree-item touch-target ' + (target === mod.id || target === `${mod.id}:panel` ? 'active' : '')}
                          type="button"
                          aria-label={`Painel de parede ${mod.name}`}
                          onClick={() => onSelect([`${mod.id}:panel`])}
                        >
                          <span className="tree-thumb">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                              <rect x="3" y="5" width="18" height="12" rx="1" />
                              <path d="M7 20h10" />
                            </svg>
                          </span>
                          <span className="tree-text">
                            <strong>Painel de parede</strong>
                            <small>
                              {mod.width} × {mod.height} mm · {mod.depth} mm de espessura
                            </small>
                          </span>
                        </button>
                      </div>
                    </div>
                  ) : mod.kind === 'ledge' ? (
                    <div className="tree-branch">
                      <div className="tree-node">
                        <span className="tree-dot" />
                        <button
                          className={'tree-item touch-target ' + (target === mod.id || target === `${mod.id}:ledge` ? 'active' : '')}
                          type="button"
                          aria-label={`Prateleira de parede ${mod.name}`}
                          onClick={() => onSelect([`${mod.id}:ledge`])}
                        >
                          <span className="tree-thumb">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                              <path d="M4 5v14" />
                              <rect x="4" y="10" width="16" height="3" rx="0.5" />
                            </svg>
                          </span>
                          <span className="tree-text">
                            <strong>Prateleira de parede</strong>
                            <small>
                              {mod.width} × {mod.depth} mm · {mod.height} mm de espessura
                            </small>
                          </span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    tree(mod.root)
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {/* As ações do módulo ficam fora do bloco de propriedades para não
          sumirem quando um compartimento é o alvo selecionado. */}
      <div className="modular-actions">
        <Button
          className="touch-target"
          disabled={busy}
          variant="outline"
          onClick={() =>
            run({ kind: 'module.duplicate', id: m.id }, `Duplicar ${m.name}`, 'actions')
          }
        >
          Duplicar
        </Button>
        <Button
          className="touch-target"
          disabled={busy || design.modules.length === 1}
          variant="outline"
          onClick={() =>
            run({ kind: 'module.remove', id: m.id }, 'Remover módulo', 'actions')
          }
        >
          Remover
        </Button>
      </div>
      {error?.scope === 'actions' && (
        <p className="field-error" role="alert">
          {error.message}
        </p>
      )}
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
      {/* Um erro do módulo precisa do formulário aberto para ser lido. */}
      <details key={target ?? m.id} open={!cell || Boolean(moduleError)}>
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
            m.back +
            (m.feet ?? 0) +
            String(m.wall) +
            editAttempt
          }
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void run(
              {
                kind: 'module.edit',
                id: m.id,
                name: formText(data, 'name'),
                width: number(data, 'width'),
                height: number(data, 'height'),
                depth: number(data, 'depth'),
                materialId: formText(data, 'material') as Module['materialId'],
                ...(m.kind
                  ? {}
                  : {
                      back: data.get('back') === 'on',
                      feet: number(data, 'feet'),
                      wall: data.get('wall') === 'on',
                    }),
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
            <input
              name="name"
              defaultValue={m.name}
              required
              maxLength={80}
              {...limitHint('Nome do módulo: 1 a 80 caracteres.', (message) =>
                sayLimit('module', message),
              )}
            />
          </label>
          <div className="fields">
            {(['width', 'height', 'depth'] as const).map((k, i) => (
              <label key={k}>
                {(m.kind === 'ledge' ? ['Largura', 'Espessura', 'Profundidade'] : ['Largura', 'Altura', m.kind === 'panel' ? 'Espessura' : 'Profundidade'])[i]} (mm)
                <input
                  type="number"
                  name={k}
                  defaultValue={m[k]}
                  min={(m.kind === 'ledge' ? [200, 15, 150] : m.kind === 'panel' ? [200, 200, 15] : [200, 200, 200])[i]}
                  max={(m.kind === 'ledge' ? [2700, 60, 600] : m.kind === 'panel' ? [2700, 2700, 60] : [1200, 2400, 800])[i]}
                  required
                  {...limitHint((m.kind === 'ledge' ? ledgeHints : m.kind === 'panel' ? panelHints : sizeHints)[i], (message) =>
                    sayLimit('module', message),
                  )}
                />
              </label>
            ))}
          </div>
          <div className="finish-field">
            <span>Acabamento</span>
            <FinishPicker name="material" defaultValue={m.materialId} categories={m.kind === 'ledge' ? ['sheet', 'solid', 'glass'] : ['sheet']} />
          </div>
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
          {!m.kind && (
            <>
              <label className="check-label">
                <input name="back" type="checkbox" defaultChecked={m.back} /> Fundo
                sobreposto de 6 mm
              </label>
              <div className="fields two">
                <label>
                  Pés (mm)
                  <input
                    type="number"
                    name="feet"
                    min={0}
                    max={300}
                    step={10}
                    defaultValue={m.feet ?? 0}
                    title="0 tira os pés; de 50 a 300 mm levanta a caixa"
                    {...limitHint('Pés: 0 (sem pés) ou de 50 a 300 mm.', (message) =>
                      sayLimit('module', message),
                    )}
                  />
                </label>
                <label className="check-label inline">
                  <input name="wall" type="checkbox" defaultChecked={!!m.wall} /> Suspenso,
                  preso na parede
                </label>
              </div>
            </>
          )}
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
                    {...limitHint(axisHints[i], (message) =>
                      sayLimit('module', message),
                    )}
                  />
                </label>
              ))}
            </div>
          )}
          {moduleError && (
            <>
              <p className="field-error" role="alert">
                {moduleError.message}
              </p>
              {onOps &&
                moduleError.edit &&
                sharedSiblings(moduleError.edit.id).length > 0 &&
                moduleError.message.includes('Painel compartilhado') && (
                  <Button
                    className="touch-target"
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={alignShared}
                  >
                    Igualar os dois módulos e aplicar
                  </Button>
                )}
            </>
          )}
          <Button className="touch-target" disabled={busy} type="submit">
            Aplicar módulo
          </Button>
        </form>
        <details open={error?.scope === 'look'}>
          <summary>Estilo e acabamento</summary>
          <LookEditor
            key={m.id + JSON.stringify(m.look ?? {}) + (m.feet ?? 0) + editAttempt}
            module={m}
            busy={busy}
            error={error?.scope === 'look' ? error.message : ''}
            onApply={(op) => void run(op, 'Acabamento do módulo', 'look')}
          />
        </details>
        <details>
          <summary>Conectar e alinhar módulos</summary>
          <label>
            Módulo de referência
            <select
              value={parent}
              onChange={(e) => {
                setParent(e.target.value);
                setConfirmShare(null);
              }}
            >
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
              onChange={(e) => {
                setSide(e.target.value as typeof side);
                setConfirmShare(null);
              }}
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
              onChange={(e) => {
                setAlign(e.target.value as typeof align);
                setConfirmShare(null);
              }}
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
              onChange={(e) => {
                setOffset(e.target.value);
                setConfirmShare(null);
              }}
              {...limitHint('Afastamento: 0 a 5000 mm.', (message) =>
                sayLimit('connect', message),
              )}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => {
                setShared(e.target.checked);
                setConfirmShare(null);
              }}
            />{' '}
            Compartilhar painel
          </label>
          <Button
            className="touch-target"
            disabled={busy || !parent}
            onClick={requestConnect}
          >
            Conectar
          </Button>
          <Button
            className="touch-target"
            variant="outline"
            disabled={busy || !design.connections.some((c) => c.child === m.id)}
            onClick={() =>
              run({ kind: 'disconnect', child: m.id }, 'Separar módulos', 'connect')
            }
          >
            Separar módulos
          </Button>
          {/* Compartilhar painel reescreve medidas do filho: nada acontece sem
              esta confirmação, e o bloco lista cada número alterado. */}
          {confirmShare &&
            confirmShare.op.kind === 'connect' &&
            confirmShare.op.child === m.id && (
              <div className="shared-preview">
                <p>
                  Compartilhar painel iguala {m.name} à referência. Ao conectar,
                  estas medidas mudam:
                </p>
                <ul>
                  {confirmShare.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
                <div className="modular-actions">
                  <Button
                    className="touch-target"
                    disabled={busy}
                    onClick={() => {
                      const pending = confirmShare.op;
                      setConfirmShare(null);
                      void run(pending, 'Conectar módulos', 'connect');
                    }}
                  >
                    Confirmar e conectar
                  </Button>
                  <Button
                    className="touch-target"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirmShare(null)}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          {error?.scope === 'connect' && (
            <p className="field-error" role="alert">
              {error.message}
            </p>
          )}
        </details>
      </details>
      {cell && (
        <section className="cell-editor">
          <div className="section-label">COMPARTIMENTO SELECIONADO</div>
          {error?.scope === 'cell' && (
            <p className="field-error" role="alert">
              {error.message}
            </p>
          )}
          {!cell.node.split && (
            <div className="modular-actions">
              <Button
                className="touch-target"
                disabled={busy || Boolean(cell.node.front)}
                variant="outline"
                title={
                  cell.node.front
                    ? 'Remova a porta ou as gavetas deste compartimento para dividir'
                    : 'Dividir este compartimento em colunas'
                }
                onClick={() =>
                  void run(
                    { kind: 'cell.split', id: cell.id, axis: 'x' },
                    'Dividir em colunas',
                    'cell',
                  )
                }
              >
                Dividir ↔
              </Button>
              <Button
                className="touch-target"
                disabled={busy || Boolean(cell.node.front)}
                variant="outline"
                title={
                  cell.node.front
                    ? 'Remova a porta ou as gavetas deste compartimento para dividir'
                    : 'Adicionar uma prateleira neste compartimento'
                }
                onClick={() =>
                  void run(
                    { kind: 'cell.split', id: cell.id, axis: 'y' },
                    'Adicionar prateleira',
                    'cell',
                  )
                }
              >
                Dividir ↕
              </Button>
            </div>
          )}
          {!cell.node.split && cell.node.front && (
            <p className="warning">
              Para dividir este compartimento, remova a porta ou as gavetas
              (deixe a Frente como Aberto no formulário abaixo).
            </p>
          )}
          {cell.node.split && (
            <>
              <form
                key={cell.id + cell.node.split.ratio}
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    {
                      kind: 'cell.move',
                      id: cell.id,
                      gapMm: number(new FormData(e.currentTarget), 'gap'),
                    },
                    'Mover divisória',
                    'cell',
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
                    {...limitHint('Vão: pelo menos 100 mm.', (message) =>
                      sayLimit('cell', message),
                    )}
                  />
                </label>
                <Button className="touch-target" type="submit" disabled={busy}>
                  Aplicar vão
                </Button>
              </form>
              <div className="modular-actions">
                <Button
                  className="touch-target"
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    run(
                      { kind: 'cell.distribute', id: cell.id },
                      'Distribuir divisões',
                      'cell',
                    )
                  }
                >
                  Distribuir
                </Button>
                <Button
                  className="touch-target"
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    run(
                      { kind: 'cell.merge', id: cell.id },
                      'Mesclar compartimentos',
                      'cell',
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
              run={(op, label) => void run(op, label, 'front')}
              error={error?.scope === 'front' ? error.message : ''}
              onLimit={(message) => sayLimit('front', message)}
            />
          )}{' '}
          {cell.node.front?.type === 'drawers' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void run(
                  {
                    kind: 'drawer.height',
                    id: cell.id,
                    index: number(data, 'index'),
                    height: number(data, 'height'),
                  },
                  'Ajustar altura da frente',
                  'cell',
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
                <input
                  name="height"
                  type="number"
                  min={80}
                  required
                  {...limitHint('Altura da frente: pelo menos 80 mm.', (message) =>
                    sayLimit('cell', message),
                  )}
                />
              </label>
              <Button className="touch-target" type="submit" disabled={busy}>
                Redistribuir frentes
              </Button>
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
              className="opening-button touch-target"
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
  error,
  onLimit,
}: {
  cell: Cell;
  module: Module;
  busy: boolean;
  run: (op: ModularOp, label: string) => void;
  error: string;
  onLimit: (message: string) => void;
}) {
  const [type, setType] = useState<'none' | Front['type']>(cell.front?.type ?? 'none');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const style = formText(data, 'style'),
          handle = formText(data, 'handle');
        run(
          {
            kind: 'front.set',
            id: cell.id,
            type,
            ...(type === 'single'
              ? { hinge: formText(data, 'hinge') as 'left' | 'right' }
              : {}),
            ...(type === 'drawers' || type === 'sliding' ? { count: Number(data.get('count')) } : {}),
            ...(type !== 'none'
              ? {
                  materialId: formText(
                    data,
                    'material',
                  ) as Module['materialId'],
                  // "Igual ao módulo" tira o estilo e o puxador próprios desta frente.
                  style: style ? (style as FrontStyle) : null,
                  handle: handle ? (handle as HandleType) : null,
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
          <option value="sliding">Porta de correr</option>
          <option value="flap">Porta basculante</option>
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
            {...limitHint('Quantidade de gavetas: 1 a 6.', onLimit)}
          />
        </label>
      )}
      {type === 'sliding' && (
        <label>
          Folhas
          <input
            name="count"
            type="number"
            min={2}
            max={4}
            defaultValue={cell.front?.type === 'sliding' ? cell.front.heights.length : 2}
            required
            {...limitHint('Porta de correr: 2 a 4 folhas.', onLimit)}
          />
        </label>
      )}
      {type !== 'none' && (
        <>
          <label>
            Estilo desta frente
            <select name="style" defaultValue={cell.front?.style ?? ''}>
              <option value="">Igual ao módulo ({FRONTS[module.look?.front ?? 'flat'].name})</option>
              {FRONT_STYLES.filter((v) => type !== 'drawers' || !framedFront(v)).map((v) => (
                <option key={v} value={v}>
                  {capital(FRONTS[v].name)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Puxador desta frente
            <select name="handle" defaultValue={cell.front?.handle ?? ''}>
              <option value="">Igual ao módulo ({HANDLES[module.look?.handle ?? 'bar'].name})</option>
              {HANDLE_TYPES.map((v) => (
                <option key={v} value={v}>
                  {capital(HANDLES[v].name)}
                </option>
              ))}
            </select>
          </label>
          <div className="finish-field">
            <span>Material da frente</span>
            <FinishPicker
              name="material"
              defaultValue={cell.front?.materialId ?? module.materialId}
            />
          </div>
        </>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <Button className="touch-target" type="submit" disabled={busy}>
        Aplicar frente
      </Button>
    </form>
  );
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function formText(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}
