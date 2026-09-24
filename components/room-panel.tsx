'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { friendlyError } from '@/lib/errors';
import {
  emptyRoom,
  ROOM_LIMITS,
  type FitReport,
  type Obstacle,
  type ObstacleKind,
  type Room,
} from '@/lib/room';

const OBSTACLE_NAMES: Record<ObstacleKind, string> = {
  door: 'Porta',
  window: 'Janela',
  outlet: 'Tomada',
  column: 'Coluna',
  other: 'Outro',
};
/** Campos do ambiente enquanto a pessoa digita: número só na hora de salvar. */
type RoomDraft = {
  widthMm: string;
  heightMm: string;
  depthMm: string;
  baseboardMm: string;
};
type ObstacleDraft = {
  id: string;
  kind: ObstacleKind;
  xMm: string;
  yMm: string;
  widthMm: string;
  heightMm: string;
};

/** Vazio ou fora do intervalo conta como ausente: a mensagem diz o limite. */
function draftNumber(raw: string, limit: readonly [number, number]) {
  const value = Number(raw.trim().replace(',', '.'));
  if (!raw.trim() || !Number.isFinite(value) || value < limit[0] || value > limit[1])
    return null;
  return value;
}

/** Prévia em metros do campo digitado, para conferir sem fazer conta: "2,87 m". */
function draftMetres(raw: string) {
  const value = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(value) || value < 100) return '';
  return `${(value / 1000).toFixed(2).replace('.', ',')} m`;
}

/** Monta o ambiente do formulário. Um problema por vez, já em português. */
function buildRoom(
  draft: RoomDraft,
  obstacles: ObstacleDraft[],
): { room: Room } | { error: string } {
  const widthMm = draftNumber(draft.widthMm, ROOM_LIMITS.width);
  if (widthMm === null)
    return {
      error: `Largura da parede: informe um valor entre ${ROOM_LIMITS.width[0]} e ${ROOM_LIMITS.width[1]} mm.`,
    };
  const heightMm = draftNumber(draft.heightMm, ROOM_LIMITS.height);
  if (heightMm === null)
    return {
      error: `Altura do teto: informe um valor entre ${ROOM_LIMITS.height[0]} e ${ROOM_LIMITS.height[1]} mm.`,
    };
  const depthMm = draftNumber(draft.depthMm, ROOM_LIMITS.depth);
  if (draft.depthMm.trim() && depthMm === null)
    return {
      error: `Profundidade: informe um valor entre ${ROOM_LIMITS.depth[0]} e ${ROOM_LIMITS.depth[1]} mm, ou deixe em branco.`,
    };
  const baseboardMm = draftNumber(draft.baseboardMm, ROOM_LIMITS.baseboard);
  if (draft.baseboardMm.trim() && baseboardMm === null)
    return {
      error: `Rodapé: informe um valor entre 0 e ${ROOM_LIMITS.baseboard[1]} mm, ou deixe em branco.`,
    };
  const list: Obstacle[] = [];
  for (const [index, item] of obstacles.entries()) {
    const xMm = draftNumber(item.xMm, ROOM_LIMITS.obstacleX);
    const yMm = draftNumber(item.yMm, ROOM_LIMITS.obstacleY);
    const width = draftNumber(item.widthMm, ROOM_LIMITS.obstacleSize);
    const height = draftNumber(item.heightMm, ROOM_LIMITS.obstacleSize);
    if (xMm === null || yMm === null || width === null || height === null)
      return {
        error: `Obstáculo ${index + 1}: informe x, y, largura e altura em mm (x de ${ROOM_LIMITS.obstacleX[0]} a ${ROOM_LIMITS.obstacleX[1]}, tamanhos a partir de ${ROOM_LIMITS.obstacleSize[0]} mm).`,
      };
    list.push({ id: item.id, kind: item.kind, xMm, yMm, widthMm: width, heightMm: height });
  }
  return {
    room: {
      schemaVersion: 1,
      widthMm,
      heightMm,
      ...(depthMm === null ? {} : { depthMm }),
      ...(baseboardMm === null ? {} : { baseboardMm }),
      obstacles: list,
    },
  };
}

function roomDraft(room?: Room): RoomDraft {
  const base = room ?? emptyRoom();
  return {
    widthMm: String(base.widthMm),
    heightMm: String(base.heightMm),
    depthMm: base.depthMm === undefined ? '' : String(base.depthMm),
    baseboardMm: base.baseboardMm === undefined ? '' : String(base.baseboardMm),
  };
}

function obstacleDraft(obstacle: Obstacle): ObstacleDraft {
  return {
    id: obstacle.id,
    kind: obstacle.kind,
    xMm: String(obstacle.xMm),
    yMm: String(obstacle.yMm),
    widthMm: String(obstacle.widthMm),
    heightMm: String(obstacle.heightMm),
  };
}

/**
 * Seção Ambiente do painel Ajustes. As medidas vão para o servidor só no botão
 * Salvar: gravar a cada tecla encheria o projeto de versões de digitação.
 */
export function RoomPanel({
  room,
  report,
  summary,
  busy,
  onSave,
  showInScene,
  onToggleScene,
}: {
  room?: Room;
  report: FitReport | null;
  summary: string;
  busy: boolean;
  onSave: (room: Room) => Promise<void>;
  showInScene: boolean;
  onToggleScene: (show: boolean) => void;
}) {
  const [draft, setDraft] = useState<RoomDraft>(() => roomDraft(room));
  const [obstacles, setObstacles] = useState<ObstacleDraft[]>(() =>
    (room?.obstacles ?? []).map(obstacleDraft),
  );
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  // Qualquer digitação invalida "Ambiente salvo.": o campo já não é o salvo.
  const clear = () => {
    setSaved('');
    setError('');
  };
  const setField = (key: keyof RoomDraft, value: string) => {
    clear();
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const setObstacleNumber = (
    id: string,
    key: 'xMm' | 'yMm' | 'widthMm' | 'heightMm',
    value: string,
  ) => {
    clear();
    setObstacles((list) =>
      list.map((item) => (item.id === id ? { ...item, [key]: value } : item)),
    );
  };
  const addObstacle = () => {
    clear();
    setObstacles((list) => [
      ...list,
      {
        id: `ob-${crypto.randomUUID().slice(0, 12)}`,
        kind: 'door',
        xMm: '0',
        yMm: '0',
        widthMm: '800',
        heightMm: '2100',
      },
    ]);
  };
  const save = async () => {
    const built = buildRoom(draft, obstacles);
    if ('error' in built) {
      setSaved('');
      setError(built.error);
      return;
    }
    setError('');
    setSaved('');
    try {
      await onSave(built.room);
      setSaved('Ambiente salvo.');
    } catch (e) {
      setError(friendlyError(e));
    }
  };
  const fields: [keyof RoomDraft, string, string][] = [
    ['widthMm', 'Largura (mm)', '3000'],
    ['heightMm', 'Pé-direito (mm)', '2700'],
    ['depthMm', 'Profundidade (mm)', '600'],
    ['baseboardMm', 'Rodapé (mm)', '80'],
  ];
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
          Ambiente ainda não informado. Os campos começam com as medidas de um
          quarto de exemplo: confira com a trena e salve para ver o encaixe e o
          quarto desenhado no 3D.
        </p>
      )}
      <label className="switch-row">
        <input
          type="checkbox"
          checked={showInScene}
          disabled={!room}
          onChange={(e) => onToggleScene(e.target.checked)}
        />
        <span className="switch" aria-hidden="true" />
        Mostrar o ambiente no 3D
      </label>
      <div className="section-label">Parede</div>
      <div className="room-fields">
        {fields.map(([key, label, placeholder]) => (
          <label key={key}>
            {label}
            <input
              inputMode="numeric"
              placeholder={placeholder}
              value={draft[key]}
              maxLength={6}
              disabled={busy}
              onChange={(e) => setField(key, e.target.value)}
            />
            <small>{draftMetres(draft[key])}</small>
          </label>
        ))}
      </div>
      <div className="section-label">
        <span>Obstáculos</span>
        <button
          type="button"
          className="link-button"
          disabled={busy || obstacles.length >= ROOM_LIMITS.obstacles}
          onClick={addObstacle}
        >
          <Plus size={13} /> Adicionar
        </button>
      </div>
      {obstacles.length === 0 ? (
        <p className="hint">
          Portas, janelas, tomadas e colunas. X conta da esquerda da parede e Y
          do piso.
        </p>
      ) : (
        obstacles.map((item, index) => (
          <div className="room-obstacle" key={item.id}>
            <div className="room-obstacle-head">
              <select
                aria-label={`Tipo do obstáculo ${index + 1}`}
                value={item.kind}
                disabled={busy}
                onChange={(e) => {
                  clear();
                  const kind = e.target.value as ObstacleKind;
                  setObstacles((list) =>
                    list.map((v) => (v.id === item.id ? { ...v, kind } : v)),
                  );
                }}
              >
                {(Object.keys(OBSTACLE_NAMES) as ObstacleKind[]).map((kind) => (
                  <option value={kind} key={kind}>
                    {OBSTACLE_NAMES[kind]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remover obstáculo ${index + 1}`}
                title="Remover"
                disabled={busy}
                onClick={() => {
                  clear();
                  setObstacles((list) => list.filter((v) => v.id !== item.id));
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="room-fields four">
              {(
                [
                  ['xMm', 'X'],
                  ['yMm', 'Y'],
                  ['widthMm', 'Largura'],
                  ['heightMm', 'Altura'],
                ] as ['xMm' | 'yMm' | 'widthMm' | 'heightMm', string][]
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    inputMode="numeric"
                    value={item[key]}
                    maxLength={6}
                    disabled={busy}
                    onChange={(e) => setObstacleNumber(item.id, key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>
        ))
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="room-save">
        <Button disabled={busy} onClick={() => void save()}>
          Salvar ambiente
        </Button>
        {saved && <small>{saved}</small>}
      </div>
    </div>
  );
}
