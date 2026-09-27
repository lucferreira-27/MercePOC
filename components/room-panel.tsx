'use client';
import { useState, type ReactNode } from 'react';
import { AppWindow, BrickWall, Check, DoorOpen, Move3d, Pencil, Plug, Plus, RectangleVertical, SquareDashed, Trash2, Tv, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { friendlyError } from '@/lib/errors';
import {
  emptyRoom,
  floorBound,
  MAIN_WALL,
  OBSTACLE_LABEL,
  obstacleClash,
  obstacleWord,
  ROOM_LIMITS,
  rotateWall,
  wallFootprint,
  wallName,
  type FitReport,
  type Obstacle,
  type ObstacleKind,
  type Room,
  type Wall,
} from '@/lib/room';

export const OBSTACLE_ICON: Record<ObstacleKind, ReactNode> = {
  door: <DoorOpen size={16} />,
  window: <AppWindow size={16} />,
  outlet: <Plug size={16} />,
  tv: <Tv size={16} />,
  column: <RectangleVertical size={16} />,
  other: <SquareDashed size={16} />,
};
const KINDS = Object.keys(OBSTACLE_LABEL) as ObstacleKind[];

/** Campos da parede enquanto a pessoa digita: número só na hora de aplicar. */
type WallDraft = {
  widthMm: string;
  heightMm: string;
  depthMm: string;
  baseboardMm: string;
  offsetMm: string;
};
type ObstacleField = 'xMm' | 'yMm' | 'widthMm' | 'heightMm';

/** Vazio ou fora do intervalo conta como ausente: a mensagem diz o limite. */
function draftNumber(raw: string, limit: readonly [number, number]) {
  const value = Number(raw.trim().replace(',', '.'));
  if (!raw.trim() || !Number.isFinite(value) || value < limit[0] || value > limit[1]) return null;
  return value;
}

/** Prévia em metros do campo digitado, para conferir sem fazer conta: "2,87 m". */
function draftMetres(raw: string) {
  const value = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(value) || value < 100) return '';
  return `${(value / 1000).toFixed(2).replace('.', ',')} m`;
}
const cm = (mm: number) => `${String(Number((mm / 10).toFixed(1))).replace('.', ',')} cm`;
const metres = (mm: number) => `${(mm / 1000).toFixed(2).replace('.', ',')} m`;

/** Monta a parede do formulário, com os obstáculos de agora. Um problema por vez. */
function buildWall(draft: WallDraft, obstacles: Obstacle[]): { room: Room } | { error: string } {
  const widthMm = draftNumber(draft.widthMm, ROOM_LIMITS.width);
  if (widthMm === null)
    return { error: `Largura da parede: informe um valor entre ${ROOM_LIMITS.width[0]} e ${ROOM_LIMITS.width[1]} mm.` };
  const heightMm = draftNumber(draft.heightMm, ROOM_LIMITS.height);
  if (heightMm === null)
    return { error: `Pé-direito: informe um valor entre ${ROOM_LIMITS.height[0]} e ${ROOM_LIMITS.height[1]} mm.` };
  const depthMm = draftNumber(draft.depthMm, ROOM_LIMITS.depth);
  if (draft.depthMm.trim() && depthMm === null)
    return { error: `Profundidade: informe um valor entre ${ROOM_LIMITS.depth[0]} e ${ROOM_LIMITS.depth[1]} mm, ou deixe em branco.` };
  const baseboardMm = draftNumber(draft.baseboardMm, ROOM_LIMITS.baseboard);
  if (draft.baseboardMm.trim() && baseboardMm === null)
    return { error: `Rodapé: informe um valor entre 0 e ${ROOM_LIMITS.baseboard[1]} mm, ou deixe em branco.` };
  const offsetMm = draftNumber(draft.offsetMm, ROOM_LIMITS.offset);
  if (draft.offsetMm.trim() && offsetMm === null)
    return { error: `Móvel a partir do canto: informe um valor entre 0 e ${ROOM_LIMITS.offset[1]} mm, ou deixe em branco.` };
  return {
    room: {
      schemaVersion: 1,
      widthMm,
      heightMm,
      ...(depthMm === null ? {} : { depthMm }),
      ...(baseboardMm === null ? {} : { baseboardMm }),
      ...(offsetMm ? { offsetMm } : {}),
      obstacles,
    },
  };
}

function wallDraft(room?: Room): WallDraft {
  const base = room ?? emptyRoom();
  return {
    widthMm: String(base.widthMm),
    heightMm: String(base.heightMm),
    depthMm: base.depthMm === undefined ? '' : String(base.depthMm),
    baseboardMm: base.baseboardMm === undefined ? '' : String(base.baseboardMm),
    offsetMm: base.offsetMm ? String(base.offsetMm) : '',
  };
}

/**
 * Seção Ambiente do painel Ajustes. A parede tem o próprio botão, dentro do
 * cartão dela; os obstáculos não têm botão de salvar: pôr, mover, editar e
 * tirar gravam na hora e viram versão (Ctrl+Z desfaz).
 */
export function RoomPanel({
  room,
  report,
  summary,
  busy,
  onSave,
  showInScene,
  onToggleScene,
  selectedObstacle,
  onSelectObstacle,
  placingKind,
  onStartPlace,
  onCancelPlace,
  onChangeObstacle,
  onRemoveObstacle,
  onPreview,
  selectedWall,
  onSelectWall,
  placingWall,
  onStartPlaceWall,
  onChangeWall,
  onRemoveWall,
}: {
  /** Parede escolhida: a do fundo é `MAIN_WALL`, as outras pelo id. */
  selectedWall: string | null;
  onSelectWall: (id: string | null) => void;
  /** Parede nova sendo posta no piso agora (a prévia está no 3D). */
  placingWall: boolean;
  /** Começa a pôr uma parede: `base` é o ambiente onde ela vai entrar. */
  onStartPlaceWall: (base: Room) => void;
  onChangeWall: (w: Wall) => Promise<void>;
  onRemoveWall: (id: string) => void;
  room?: Room;
  report: FitReport | null;
  summary: string;
  busy: boolean;
  onSave: (room: Room) => Promise<void>;
  showInScene: boolean;
  onToggleScene: (show: boolean) => void;
  selectedObstacle: string | null;
  onSelectObstacle: (id: string | null) => void;
  /** Tipo sendo posto na parede agora (a prévia está no 3D). */
  placingKind: ObstacleKind | null;
  /** Começa a pôr um obstáculo: `base` é a parede onde ele vai entrar. */
  onStartPlace: (kind: ObstacleKind, base: Room) => void;
  onCancelPlace: () => void;
  onChangeObstacle: (o: Obstacle) => Promise<void>;
  onRemoveObstacle: (id: string) => void;
  /** Ambiente como ficaria com o campo digitado: o 3D mostra antes de gravar. */
  onPreview: (room: Room | null) => void;
}) {
  const [draft, setDraft] = useState<WallDraft>(() => wallDraft(room));
  const [editingWall, setEditingWall] = useState(!room);
  const [wallError, setWallError] = useState('');
  const obstacles = room?.obstacles ?? [];
  const setField = (key: keyof WallDraft, value: string) => {
    setWallError('');
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const saveWall = async () => {
    const built = buildWall(draft, obstacles);
    if ('error' in built) {
      setWallError(built.error);
      return;
    }
    setWallError('');
    try {
      await onSave({ ...room, ...built.room });
      setEditingWall(false);
    } catch (e) {
      setWallError(friendlyError(e));
    }
  };
  const startPlace = (kind: ObstacleKind) => {
    if (placingKind === kind) {
      onCancelPlace();
      return;
    }
    // Sem ambiente salvo, a parede do formulário é onde o obstáculo entra, e
    // as duas coisas gravam juntas no clique.
    if (room) {
      onStartPlace(kind, room);
      return;
    }
    const built = buildWall(draft, []);
    if ('error' in built) {
      setEditingWall(true);
      setWallError(built.error);
      return;
    }
    onStartPlace(kind, built.room);
  };
  const fields: [keyof WallDraft, string, string][] = [
    ['widthMm', 'Largura', '3000'],
    ['heightMm', 'Pé-direito', '2700'],
    ['depthMm', 'Profundidade', '600'],
    ['baseboardMm', 'Rodapé', '80'],
    ['offsetMm', 'Móvel a partir do canto', '0'],
  ];
  const crossing = new Set(report?.crossed ?? []);
  const walls = room?.walls ?? [];
  const wallsCrossing = new Set(report?.crossedWalls ?? []);
  const mainChosen = !!room && selectedWall === MAIN_WALL;
  const startPlaceWall = () => {
    if (placingWall) {
      onCancelPlace();
      return;
    }
    // Sem ambiente salvo, a parede do formulário é a do fundo, e as duas
    // gravam juntas no clique, como com os obstáculos.
    if (room) {
      onStartPlaceWall(room);
      return;
    }
    const built = buildWall(draft, []);
    if ('error' in built) {
      setEditingWall(true);
      setWallError(built.error);
      return;
    }
    onStartPlaceWall(built.room);
  };
  return (
    <div className="room-panel">
      {report ? (
        <div className={'fit-card ' + (report.fits ? 'ok' : 'bad')}>
          <strong>{summary}</strong>
          {report.issues.map((issue) => (
            <p key={issue.code + issue.message}>
              {issue.message}
              {issue.detail ? `. ${issue.detail}` : ''}
            </p>
          ))}
          {report.notes.map((note) => (
            <p className="note" key={note}>
              {note}
            </p>
          ))}
        </div>
      ) : (
        <p className="hint">
          Ambiente ainda não informado. Confira a parede com a trena e salve, ou já escolha um obstáculo abaixo: a
          parede do formulário entra junto.
        </p>
      )}
      <label className="switch-row">
        <input type="checkbox" checked={showInScene} disabled={!room} onChange={(e) => onToggleScene(e.target.checked)} />
        <span className="switch" aria-hidden="true" />
        Mostrar o ambiente no 3D
      </label>

      <section className={'wall-card' + (editingWall ? ' editing' : '') + (mainChosen ? ' chosen' : '')} aria-label="Parede do fundo">
        <header>
          <span className="section-label">Parede do fundo</span>
          {room && !editingWall && (
            <span className="wall-card-actions">
              <button
                type="button"
                className={'link-button' + (mainChosen ? ' active' : '')}
                aria-pressed={mainChosen}
                disabled={busy || !showInScene}
                title={showInScene ? 'Escolher a parede no 3D e esticar pelas alças' : 'Mostre o ambiente no 3D para ajustar pelas alças'}
                onClick={() => onSelectWall(mainChosen ? null : MAIN_WALL)}
              >
                <Move3d size={13} /> No 3D
              </button>
              <button type="button" className="link-button" disabled={busy} onClick={() => setEditingWall(true)}>
                <Pencil size={13} /> Medidas
              </button>
            </span>
          )}
        </header>
        {room && !editingWall ? (
          <>
            <button
              type="button"
              className="wall-summary"
              aria-pressed={mainChosen}
              disabled={busy || !showInScene}
              onClick={() => onSelectWall(mainChosen ? null : MAIN_WALL)}
            >
              <strong>
                {metres(room.widthMm)} × {metres(room.heightMm)}
              </strong>
              <span>
                {[
                  room.depthMm ? `profundidade ${metres(room.depthMm)}` : 'profundidade livre',
                  room.baseboardMm ? `rodapé ${cm(room.baseboardMm)}` : null,
                  room.offsetMm ? `móvel a ${cm(room.offsetMm)} do canto` : 'móvel no canto',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
            {mainChosen && (
              <p className="hint wall-hint">
                No 3D, arraste as alças das pontas para mudar a largura e a de cima para o pé-direito. A medida aparece
                enquanto arrasta.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="room-fields">
              {fields.map(([key, label, placeholder]) => (
                <label key={key}>
                  <span>
                    {label} <em>mm</em>
                  </span>
                  <input
                    inputMode="numeric"
                    placeholder={placeholder}
                    value={draft[key]}
                    maxLength={6}
                    disabled={busy}
                    onChange={(e) => setField(key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveWall();
                    }}
                  />
                  <small>{draftMetres(draft[key])}</small>
                </label>
              ))}
            </div>
            {wallError && (
              <p className="field-error" role="alert">
                {wallError}
              </p>
            )}
            <div className="wall-actions">
              <Button size="sm" disabled={busy} onClick={() => void saveWall()}>
                <Check size={14} /> {room ? 'Aplicar medidas' : 'Salvar parede'}
              </Button>
              {room && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setDraft(wallDraft(room));
                    setWallError('');
                    setEditingWall(false);
                  }}
                >
                  Cancelar
                </Button>
              )}
            </div>
          </>
        )}
      </section>

      <section className="obstacle-section wall-section" aria-label="Outras paredes">
        <header>
          <span className="section-label">Outras paredes</span>
          {walls.length > 0 && <span className="count">{walls.length}</span>}
        </header>
        <button
          type="button"
          className={'add-wall' + (placingWall ? ' active' : '')}
          aria-pressed={placingWall}
          disabled={busy || (walls.length >= ROOM_LIMITS.walls && !placingWall)}
          title="Pôr uma parede: escolha o lugar no piso, no 3D"
          onClick={startPlaceWall}
        >
          {placingWall ? <X size={16} /> : <Plus size={16} />}
          <span>{placingWall ? 'Cancelar a parede nova' : 'Pôr uma parede'}</span>
          <small>lateral, divisória ou mureta</small>
        </button>
        {placingWall ? (
          <output className="place-note">
            <span className="dot" aria-hidden="true" />
            Clique no piso, no 3D, onde a parede fica. R gira.
          </output>
        ) : walls.length === 0 ? (
          <p className="hint">
            A parede que fecha o canto, uma divisória ou uma mureta. Depois, no 3D, arraste a parede para mudar de lugar e
            as alças para o comprimento e a altura.
          </p>
        ) : null}
        {walls.length > 0 && (
          <ul className="obstacle-list">
            {walls.map((w) => {
              const chosen = w.id === selectedWall;
              const f = wallFootprint(w);
              return (
                <li key={w.id} className={chosen ? 'chosen' : ''}>
                  <button type="button" className="obstacle-row" aria-expanded={chosen} onClick={() => onSelectWall(chosen ? null : w.id)}>
                    <span className="ob-icon" aria-hidden="true">
                      <BrickWall size={16} />
                    </span>
                    <span className="ob-text">
                      <strong>{wallName(w)}</strong>
                      <small>
                        {metres(w.widthMm)} × {metres(Math.min(w.heightMm, room?.heightMm ?? w.heightMm))} ·{' '}
                        {w.rotation === 90 ? 'sai do fundo' : 'ao longo do fundo'} · {cm(Math.abs(f.x0))} {f.x0 < 0 ? 'fora do canto' : 'do canto'}
                      </small>
                    </span>
                    {wallsCrossing.has(w.id) && (
                      <span className="ob-flag" title="Cruza o móvel">
                        cruza o móvel
                      </span>
                    )}
                  </button>
                  {chosen && room && (
                    <WallEditor
                      key={JSON.stringify(w)}
                      wall={w}
                      room={room}
                      busy={busy}
                      onPreview={onPreview}
                      onCommit={onChangeWall}
                      onRemove={() => onRemoveWall(w.id)}
                      onClose={() => onSelectWall(null)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="obstacle-section" aria-label="Obstáculos na parede">
        <header>
          <span className="section-label">Obstáculos na parede</span>
          {obstacles.length > 0 && <span className="count">{obstacles.length}</span>}
        </header>
        <fieldset className="obstacle-palette">
          <legend className="sr-only">Adicionar obstáculo</legend>
          {KINDS.map((kind) => (
            <button
              type="button"
              key={kind}
              className={placingKind === kind ? 'active' : ''}
              aria-pressed={placingKind === kind}
              disabled={busy || (obstacles.length >= ROOM_LIMITS.obstacles && placingKind !== kind)}
              title={`Adicionar ${OBSTACLE_LABEL[kind].toLowerCase()}: escolha o lugar na parede, no 3D`}
              onClick={() => startPlace(kind)}
            >
              {OBSTACLE_ICON[kind]}
              <span>{OBSTACLE_LABEL[kind]}</span>
            </button>
          ))}
        </fieldset>
        {placingKind ? (
          <output className="place-note">
            <span className="dot" aria-hidden="true" />
            Mova o cursor na parede, no 3D, e clique onde {obstacleWord({ kind: placingKind })} fica.
            <button type="button" className="link-button" onClick={onCancelPlace}>
              Cancelar
            </button>
          </output>
        ) : obstacles.length === 0 ? (
          <p className="hint">
            Escolha um tipo e clique na parede, no 3D, onde ele está. Depois dá para arrastar, ajustar a medida e
            remover.
          </p>
        ) : null}
        {obstacles.length > 0 && (
          <ul className="obstacle-list">
            {obstacles.map((o) => {
              const chosen = o.id === selectedObstacle;
              const clash = crossing.has(o.id);
              return (
                <li key={o.id} className={chosen ? 'chosen' : ''}>
                  <button
                    type="button"
                    className="obstacle-row"
                    aria-expanded={chosen}
                    onClick={() => onSelectObstacle(chosen ? null : o.id)}
                  >
                    <span className="ob-icon" aria-hidden="true">
                      {OBSTACLE_ICON[o.kind]}
                    </span>
                    <span className="ob-text">
                      <strong>{o.label ?? OBSTACLE_LABEL[o.kind]}</strong>
                      <small>
                        {Math.round(o.widthMm / 10)} × {Math.round(o.heightMm / 10)} cm · {cm(o.xMm)} do canto
                        {floorBound(o.kind) ? '' : `, ${cm(o.yMm)} do piso`}
                      </small>
                    </span>
                    {clash && (
                      <span className="ob-flag" title="Cruza o móvel">
                        cruza o móvel
                      </span>
                    )}
                  </button>
                  {chosen && (
                    <ObstacleEditor
                      key={JSON.stringify(o)}
                      obstacle={o}
                      room={room!}
                      busy={busy}
                      onPreview={onPreview}
                      onCommit={onChangeObstacle}
                      onRemove={() => onRemoveObstacle(o.id)}
                      onClose={() => onSelectObstacle(null)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Medidas do obstáculo escolhido. O 3D mostra o valor enquanto a pessoa
 * digita; sair do campo (ou Enter) grava como versão. Esc volta ao gravado.
 */
function ObstacleEditor({
  obstacle,
  room,
  busy,
  onPreview,
  onCommit,
  onRemove,
  onClose,
}: {
  obstacle: Obstacle;
  room: Room;
  busy: boolean;
  onPreview: (room: Room | null) => void;
  onCommit: (o: Obstacle) => Promise<void>;
  onRemove: () => void;
  onClose: () => void;
}) {
  const initial = () => ({
    xMm: String(obstacle.xMm),
    yMm: String(obstacle.yMm),
    widthMm: String(obstacle.widthMm),
    heightMm: String(obstacle.heightMm),
  });
  const [values, setValues] = useState<Record<ObstacleField, string>>(initial);
  const [kind, setKind] = useState(obstacle.kind);
  const [label, setLabel] = useState(obstacle.label ?? '');
  const [error, setError] = useState('');
  /** O obstáculo com os campos de agora, ou o motivo de não valer. */
  const read = (v = values, k = kind, l = label): { o: Obstacle } | { error: string } => {
    const n = {
      xMm: draftNumber(v.xMm, [0, room.widthMm]),
      yMm: draftNumber(v.yMm, [0, room.heightMm]),
      widthMm: draftNumber(v.widthMm, [ROOM_LIMITS.obstacleSize[0], room.widthMm]),
      heightMm: draftNumber(v.heightMm, [ROOM_LIMITS.obstacleSize[0], room.heightMm]),
    };
    if (n.widthMm === null) return { error: `Largura: de ${ROOM_LIMITS.obstacleSize[0]} a ${room.widthMm} mm.` };
    if (n.heightMm === null) return { error: `Altura: de ${ROOM_LIMITS.obstacleSize[0]} a ${room.heightMm} mm.` };
    if (n.xMm === null || n.xMm + n.widthMm > room.widthMm)
      return { error: `Do canto: de 0 a ${room.widthMm - n.widthMm} mm para caber na parede.` };
    if (n.yMm === null || n.yMm + n.heightMm > room.heightMm)
      return { error: `Do piso: de 0 a ${room.heightMm - n.heightMm} mm para caber abaixo do teto.` };
    const { label: _old, ...rest } = obstacle;
    void _old;
    const o: Obstacle = {
      ...rest,
      kind: k,
      ...(l.trim() ? { label: l.trim().slice(0, 80) } : {}),
      xMm: Math.round(n.xMm),
      yMm: Math.round(n.yMm),
      widthMm: Math.round(n.widthMm),
      heightMm: Math.round(n.heightMm),
    };
    const clash = obstacleClash((room.obstacles ?? []).map((v) => (v.id === o.id ? o : v)));
    return clash ? { error: clash } : { o };
  };
  const withObstacle = (o: Obstacle): Room => ({
    ...room,
    obstacles: (room.obstacles ?? []).map((v) => (v.id === o.id ? o : v)),
  });
  const preview = (v: Record<ObstacleField, string>, k = kind, l = label) => {
    const r = read(v, k, l);
    onPreview('o' in r ? withObstacle(r.o) : null);
  };
  const commit = async (k = kind, l = label) => {
    const r = read(values, k, l);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    setError('');
    if (JSON.stringify(r.o) === JSON.stringify(obstacle)) {
      onPreview(null);
      return;
    }
    try {
      await onCommit(r.o);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      onPreview(null);
    }
  };
  const revert = () => {
    setValues(initial());
    setKind(obstacle.kind);
    setLabel(obstacle.label ?? '');
    setError('');
    onPreview(null);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void commit();
    if (e.key === 'Escape') {
      e.stopPropagation();
      revert();
    }
  };
  const numberFields: [ObstacleField, string][] = [
    ['xMm', 'Do canto'],
    ['yMm', 'Do piso'],
    ['widthMm', 'Largura'],
    ['heightMm', 'Altura'],
  ];
  return (
    <div className="obstacle-editor">
      <div className="ob-edit-head">
        <label>
          Tipo
          <select
            value={kind}
            disabled={busy}
            onChange={(e) => {
              const k = e.target.value as ObstacleKind;
              setKind(k);
              void commit(k);
            }}
          >
            {KINDS.map((k) => (
              <option value={k} key={k}>
                {OBSTACLE_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>
            Nome <em>opcional</em>
          </span>
          <input
            value={label}
            maxLength={80}
            placeholder={OBSTACLE_LABEL[kind]}
            disabled={busy}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={keys}
          />
        </label>
      </div>
      <div className="room-fields">
        {numberFields.map(([key, name]) => {
          const locked = key === 'yMm' && floorBound(kind);
          return (
            <label key={key} title={locked ? 'Porta e coluna ficam no piso' : undefined}>
              <span>
                {name} <em>mm</em>
              </span>
              <input
                inputMode="numeric"
                value={locked ? '0' : values[key]}
                maxLength={6}
                disabled={busy || locked}
                onChange={(e) => {
                  const next = { ...values, [key]: e.target.value };
                  setValues(next);
                  setError('');
                  preview(next);
                }}
                onBlur={() => void commit()}
                onKeyDown={keys}
              />
              <small>{locked ? 'no piso' : draftMetres(values[key]) || (Number(values[key]) ? cm(Number(values[key])) : '')}</small>
            </label>
          );
        })}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <p className="hint ob-edit-hint">Grava ao sair do campo; Esc volta ao gravado. Para mudar de lugar, também dá para arrastar no 3D.</p>
      <div className="ob-edit-actions">
        <Button size="sm" variant="ghost" className="danger" disabled={busy} onClick={onRemove} title="Remover (Delete)">
          <Trash2 size={14} /> Remover
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Fechar" title="Fechar (Esc)">
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}

type WallField = 'xMm' | 'zMm' | 'widthMm' | 'heightMm' | 'thicknessMm';

/** A parede com as chaves sempre na mesma ordem: comparar é comparar o texto. */
function canonicalWall(w: Wall): Wall {
  return {
    id: w.id,
    ...(w.label ? { label: w.label } : {}),
    xMm: w.xMm,
    zMm: w.zMm,
    widthMm: w.widthMm,
    heightMm: w.heightMm,
    thicknessMm: w.thicknessMm,
    rotation: w.rotation,
  };
}

/**
 * Medidas exatas da parede escolhida, para quando arrastar não basta. O 3D
 * mostra o valor enquanto a pessoa digita; sair do campo (ou Enter) grava
 * como versão. Esc volta ao gravado.
 */
function WallEditor({
  wall,
  room,
  busy,
  onPreview,
  onCommit,
  onRemove,
  onClose,
}: {
  wall: Wall;
  room: Room;
  busy: boolean;
  onPreview: (room: Room | null) => void;
  onCommit: (w: Wall) => Promise<void>;
  onRemove: () => void;
  onClose: () => void;
}) {
  const fieldsOf = (w: Wall): Record<WallField, string> => ({
    xMm: String(w.xMm),
    zMm: String(w.zMm),
    widthMm: String(w.widthMm),
    heightMm: String(Math.min(w.heightMm, room.heightMm)),
    thicknessMm: String(w.thicknessMm),
  });
  const [values, setValues] = useState<Record<WallField, string>>(() => fieldsOf(wall));
  const [label, setLabel] = useState(wall.label ?? '');
  const [error, setError] = useState('');
  /** A parede com os campos de agora, ou o motivo de não valer. Um problema por vez. */
  const read = (v = values, l = label): { w: Wall } | { error: string } => {
    const [minL, maxL] = ROOM_LIMITS.wallLength;
    const [minT, maxT] = ROOM_LIMITS.wallThickness;
    const minH = ROOM_LIMITS.wallHeight[0];
    const widthMm = draftNumber(v.widthMm, [minL, maxL]);
    if (widthMm === null) return { error: `Comprimento: de ${minL} a ${maxL} mm.` };
    const heightMm = draftNumber(v.heightMm, [minH, room.heightMm]);
    if (heightMm === null) return { error: `Altura: de ${minH} mm até o pé-direito, ${room.heightMm} mm.` };
    const thicknessMm = draftNumber(v.thicknessMm, [minT, maxT]);
    if (thicknessMm === null) return { error: `Espessura: de ${minT} a ${maxT} mm.` };
    const sx = wall.rotation === 0 ? widthMm : thicknessMm,
      sz = wall.rotation === 0 ? thicknessMm : widthMm;
    const xMax = room.widthMm + thicknessMm - sx;
    const xMm = draftNumber(v.xMm, [-thicknessMm, xMax]);
    if (xMm === null) return { error: `Do canto: de ${-thicknessMm} a ${xMax} mm, para a parede ficar no ambiente.` };
    const zMax = (room.depthMm ?? ROOM_LIMITS.wallZ[1]) - sz;
    const zMm = draftNumber(v.zMm, [0, Math.max(0, zMax)]);
    if (zMax < 0) return { error: `A parede passa da profundidade do ambiente, ${room.depthMm} mm.` };
    if (zMm === null) return { error: `Da parede do fundo: de 0 a ${zMax} mm.` };
    return {
      w: canonicalWall({
        ...wall,
        label: l.trim().slice(0, 80) || undefined,
        xMm: Math.round(xMm),
        zMm: Math.round(zMm),
        widthMm: Math.round(widthMm),
        heightMm: Math.round(heightMm),
        thicknessMm: Math.round(thicknessMm),
      }),
    };
  };
  const withWall = (w: Wall): Room => ({ ...room, walls: (room.walls ?? []).map((v) => (v.id === w.id ? w : v)) });
  const commit = async (w?: Wall) => {
    const r = w ? { w } : read();
    if ('error' in r) {
      setError(r.error);
      return;
    }
    setError('');
    if (JSON.stringify(r.w) === JSON.stringify(canonicalWall(wall))) {
      onPreview(null);
      return;
    }
    try {
      await onCommit(r.w);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      onPreview(null);
    }
  };
  const revert = () => {
    setValues(fieldsOf(wall));
    setLabel(wall.label ?? '');
    setError('');
    onPreview(null);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void commit();
    if (e.key === 'Escape') {
      e.stopPropagation();
      revert();
    }
  };
  const numberFields: [WallField, string][] = [
    ['xMm', 'Do canto'],
    ['zMm', 'Da parede do fundo'],
    ['widthMm', 'Comprimento'],
    ['heightMm', 'Altura'],
    ['thicknessMm', 'Espessura'],
  ];
  return (
    <div className="obstacle-editor wall-editor">
      <div className="ob-edit-head">
        <label>
          Direção
          <select
            value={wall.rotation}
            disabled={busy}
            onChange={() => {
              // Girar é em volta do centro da base, como o botão do 3D.
              const r = read();
              if ('error' in r) {
                setError(r.error);
                return;
              }
              const turned = rotateWall(r.w, room);
              setValues(fieldsOf(turned));
              void commit(canonicalWall(turned));
            }}
          >
            <option value={90}>Sai do fundo</option>
            <option value={0}>Ao longo do fundo</option>
          </select>
        </label>
        <label>
          <span>
            Nome <em>opcional</em>
          </span>
          <input
            value={label}
            maxLength={80}
            placeholder={wallName({ id: wall.id })}
            disabled={busy}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={keys}
          />
        </label>
      </div>
      <div className="room-fields">
        {numberFields.map(([key, name]) => (
          <label key={key}>
            <span>
              {name} <em>mm</em>
            </span>
            <input
              inputMode="numeric"
              value={values[key]}
              maxLength={6}
              disabled={busy}
              onChange={(e) => {
                const next = { ...values, [key]: e.target.value };
                setValues(next);
                setError('');
                const r = read(next);
                onPreview('w' in r ? withWall(r.w) : null);
              }}
              onBlur={() => void commit()}
              onKeyDown={keys}
            />
            <small>{draftMetres(values[key]) || (Number(values[key]) ? cm(Number(values[key])) : '')}</small>
          </label>
        ))}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <p className="hint ob-edit-hint">Grava ao sair do campo; Esc volta ao gravado. No 3D, arraste a parede ou as alças dela.</p>
      <div className="ob-edit-actions">
        <Button size="sm" variant="ghost" className="danger" disabled={busy} onClick={onRemove} title="Remover (Delete)">
          <Trash2 size={14} /> Remover
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Fechar" title="Fechar (Esc)">
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}
