import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaults, type Params } from './furniture';
import {
  designSchema,
  distributeShelves,
  addShelf,
  applyOp,
  generateDesign,
  isDesign,
  migrateParams,
  resizeDesign,
  setGapBelow,
  type Design,
  type ShelfOp,
} from './studio';
import { canonical, normalize, executeRequest } from './studio';
import type { ImageRef } from './images';
import type { ChatReport, TurnOutcome } from './progress';
import type { Room } from './room';
import type { TurnUsage } from './models';
import { buildTemplate, templateById } from './templates';
import { PLACEMENT_MAX_STEPS, PLACEMENT_MERGE_MS, type Placement, type PlacementStep } from './placement';
export type TurnContext = {
  requestId: string;
  baseRevisionId: string;
  selectedPartIds: string[];
  referencedPartIds: string[];
};
export type TurnResult = {
  outcome: TurnOutcome;
  resultRevisionId: string;
  appliedOperations: ShelfOp[];
  changes: string[];
  attemptedOperations?: ShelfOp[];
};
export type ClarificationOption = {
  id: string;
  label: string;
  partIds: string[];
};
export type Clarification = {
  id: string;
  question: string;
  baseRevisionId: string;
  options: ClarificationOption[];
  /** Intenção original preservada: ops com lacuna + texto do pedido. */
  pendingOps?: ShelfOp[];
  pendingMessage?: string;
};
export type Message = {
  role: 'user' | 'assistant';
  content: string;
  id: string;
  image?: ImageRef;
  report?: ChatReport;
  /**
   * Próximos passos propostos pela IA para este projeto. Ficam na mensagem
   * para a sugestão sobreviver ao recarregamento e ser sempre a do contexto
   * mais recente.
   */
  suggestions?: string[];
  /** Id imutável da revisão vigente ao salvar a mensagem. */
  revisionId?: string;
  /** Número legado (1-based); pode repetir após branching — só exibição. */
  revision?: number;
  context?: TurnContext;
  result?: TurnResult;
  clarification?: Clarification;
  /** Resposta a um esclarecimento: liga a mensagem do usuário à pergunta. */
  clarificationId?: string;
  /** Turno que falhou antes de aplicar: permite repetir depois de recarregar. */
  retry?: { message: string; image?: ImageRef };
  error?: string;
  /** Tokens e custo estimado do turno que gerou esta resposta. */
  usage?: TurnUsage;
};
export type Revision = {
  id: string;
  number: number;
  params: Design;
  label: string;
  at: string;
  /** Versão feita de movimentos seguidos: os passos para desfazer um a um. */
  placement?: Placement;
};
export type Project = {
  id: string;
  name: string;
  version: number;
  cursor: number;
  revisions: Revision[];
  messages: Message[];
  origin?: { fromId: string; revision: number; at: string };
  /**
   * Ambiente do móvel. Ausente em projeto antigo: sem ambiente informado não
   * há veredito de encaixe. Fora das revisões porque é dado do lugar.
   */
  room?: Room;
};
let db: DatabaseSync;
function database() {
  if (!db) {
    const dir = process.env.MERCE_DATA_DIR || join(process.cwd(), 'data');
    mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(join(dir, 'merce.sqlite'));
    db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL, updated TEXT NOT NULL)',
    );
    const legacyRows = db
      .prepare(
        "SELECT count(*) AS n FROM projects WHERE EXISTS (SELECT 1 FROM json_each(body, '$.revisions') r WHERE json_extract(r.value, '$.params.schemaVersion') IS NOT 3)",
      )
      .get() as { n: number };
    if (legacyRows.n && !existsSync(join(dir, 'merce-before-modules.sqlite'))) {
      const backup = join(dir, 'merce-before-modules.sqlite').replaceAll(
        "'",
        "''",
      );
      db.exec(`VACUUM INTO '${backup}'`);
    }
  }
  return db;
}
export function list() {
  return (
    database()
      .prepare('SELECT body, updated FROM projects ORDER BY updated DESC')
      .all() as { body: string; updated: string }[]
  ).map((r) => {
    const p = JSON.parse(r.body) as Project;
    const design = p.revisions[p.cursor]?.params;
    // Projeto legado (schemaVersion 2) não tem módulos: é uma estante só.
    const modules = design
      ? Array.isArray(design.modules)
        ? design.modules.length
        : 1
      : undefined;
    return {
      id: p.id,
      name: p.name,
      updated: r.updated,
      revisions: p.revisions.length,
      version: p.cursor + 1,
      // Sem isto o seletor mostra centenas de "Minha estante" idênticas.
      modules,
    };
  });
}
/** "Minha estante" já existe? Então "Minha estante 2", 3…; nomes iguais confundem. */
export function uniqueName(base = 'Minha estante') {
  const taken = new Set(
    (
      database().prepare("SELECT json_extract(body, '$.name') AS name FROM projects").all() as {
        name: string;
      }[]
    ).map((r) => r.name),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
/** Apaga o projeto e o histórico dele. Não há lixeira: a ação é definitiva. */
export function remove(id: string) {
  const r = database().prepare('DELETE FROM projects WHERE id=?').run(id);
  if (!r.changes) throw new Error('Projeto não encontrado.');
  return { ok: true as const, removed: id };
}
export function get(id: string) {
  const r = database()
    .prepare('SELECT body FROM projects WHERE id=?')
    .get(id) as { body: string } | undefined;
  if (!r) throw new Error('Projeto não encontrado.');
  const p = JSON.parse(r.body) as Project;
  // Migração preguiçosa: revisões v1 viram design v2 só em memória, e
  // registros antigos ganham ids sem inventar vínculos (marcados 'legacy').
  // O banco nunca é reescrito aqui; a conversão é determinística e idempotente.
  for (const rev of p.revisions) {
    const raw = rev.params as unknown;
    rev.params = isDesign(raw)
      ? designSchema.parse(raw)
      : migrateParams(raw as Params);
    if (!rev.id) rev.id = `legacy-${rev.number}`;
  }
  for (const [index, m] of p.messages.entries()) {
    if (!m.id) m.id = `legacy-message-${index}`;
    if (m.revision !== undefined && !m.revisionId) {
      const matches = p.revisions.filter((r) => r.number === m.revision);
      m.revisionId =
        matches.length === 1 ? matches[0].id : `legacy-${m.revision}`;
    }
  }
  return p;
}
export function create() {
  const p: Project = {
    id: randomUUID(),
    name: uniqueName(),
    version: 0,
    cursor: 0,
    revisions: [
      {
        id: randomUUID(),
        number: 1,
        params: migrateParams(defaults),
        label: 'Estante inicial',
        at: new Date().toISOString(),
      },
    ],
    messages: [
      {
        id: randomUUID(),
        role: 'assistant',
        content:
          'Vamos criar sua estante. Comecei com 80 × 180 × 35 cm, quatro prateleiras e carvalho. Descreva o que você quer mudar.',
      },
    ],
  };
  database()
    .prepare('INSERT INTO projects VALUES (?, ?, ?, ?)')
    .run(p.id, encode(p), 0, new Date().toISOString());
  return view(p);
}
/**
 * Projeto novo a partir de um modelo pronto. O modelo é a versão 1 e a
 * primeira mensagem explica o que foi montado; um modelo que traz quarto de
 * exemplo já abre com o ambiente preenchido.
 */
export function createFromTemplate(templateId: string) {
  const t = templateById(templateId);
  if (!t) throw new Error('Modelo não encontrado.');
  const params = normalize(buildTemplate(t));
  const revisionId = randomUUID();
  const p: Project = {
    id: randomUUID(),
    name: uniqueName(t.name),
    version: 0,
    cursor: 0,
    revisions: [
      { id: revisionId, number: 1, params, label: `Modelo: ${t.name}`, at: new Date().toISOString() },
    ],
    messages: [
      { id: randomUUID(), role: 'assistant', content: t.intro, revisionId, revision: 1 },
    ],
    ...(t.room ? { room: structuredClone(t.room) } : {}),
  };
  database()
    .prepare('INSERT INTO projects VALUES (?, ?, ?, ?)')
    .run(p.id, encode(p), 0, new Date().toISOString());
  return view(p);
}
export function createDemo() {
  const now = Date.now();
  const at = (i: number, total: number) =>
    new Date(now - (total - 1 - i) * 90000).toISOString();
  const steps: {
    label: string;
    op: (d: Design) => Design;
    user: string;
    reply: string;
  }[] = [
    {
      label: 'Largura para 100 cm',
      op: (d) => resizeDesign(d, { width: 1000 }),
      user: 'Aumente a largura para 1 metro.',
      reply:
        'Largura ajustada para 100 cm. As demais medidas foram preservadas.',
    },
    {
      label: 'Altura para 200 cm',
      op: (d) => resizeDesign(d, { height: 2000 }),
      user: 'Deixe com 2 metros de altura.',
      reply: 'Altura ajustada para 200 cm. Os vãos foram redistribuídos.',
    },
    {
      label: 'Material grafite',
      op: (d) => resizeDesign(d, { materialId: 'graphite' }),
      user: 'Mude o material para grafite.',
      reply: 'Material trocado para grafite. As medidas continuam as mesmas.',
    },
    {
      label: 'Cinco prateleiras',
      op: (d) => distributeShelves(addShelf(d, 2)),
      user: 'Quero cinco prateleiras.',
      reply: 'Prateleiras ajustadas para cinco, com distribuição igual.',
    },
    {
      label: 'Vão inferior de 450 mm',
      op: (d) => setGapBelow(d, 'sh-1', 450),
      user: 'Deixe o vão de baixo com 45 cm.',
      reply:
        'Vão inferior definido em 450 mm. As demais prateleiras foram preservadas.',
    },
  ];
  const revisions: Revision[] = [
    {
      id: randomUUID(),
      number: 1,
      params: migrateParams(defaults),
      label: 'Estante inicial',
      at: at(0, steps.length + 1),
    },
  ];
  for (const [i, step] of steps.entries()) {
    const params = step.op(revisions[i].params);
    generateDesign(params);
    revisions.push({
      id: randomUUID(),
      number: i + 2,
      params,
      label: step.label,
      at: at(i + 1, steps.length + 1),
    });
  }
  const messages: Message[] = [
    {
      id: randomUUID(),
      role: 'assistant',
      content:
        'Vamos criar sua estante. Comecei com 80 × 180 × 35 cm, quatro prateleiras e carvalho. Descreva o que você quer mudar.',
      revisionId: revisions[0].id,
      revision: 1,
    },
  ];
  for (const [i, step] of steps.entries()) {
    const rev = revisions[i + 1];
    messages.push({
      id: randomUUID(),
      role: 'user',
      content: step.user,
      revisionId: rev.id,
      revision: rev.number,
    });
    messages.push({
      id: randomUUID(),
      role: 'assistant',
      content: step.reply,
      revisionId: rev.id,
      revision: rev.number,
    });
  }
  const p: Project = {
    id: randomUUID(),
    name: uniqueName(),
    version: 0,
    cursor: revisions.length - 1,
    revisions,
    messages,
  };
  database()
    .prepare('INSERT INTO projects VALUES (?, ?, ?, ?)')
    .run(p.id, encode(p), 0, new Date().toISOString());
  return view(p);
}
export function save(p: Project, expected: number) {
  p.version = expected + 1;
  const r = database()
    .prepare(
      'UPDATE projects SET body=?, version=?, updated=? WHERE id=? AND version=?',
    )
    .run(encode(p), p.version, new Date().toISOString(), p.id, expected);
  if (!r.changes)
    throw new Error(
      'O projeto mudou em outra janela. Recarregue antes de editar.',
    );
  return view(p);
}
export function view(p: Project) {
  return {
    ...p,
    params: p.revisions[p.cursor].params,
    ...generateDesign(p.revisions[p.cursor].params),
  };
}
/** Devolve quantas revisões futuras foram descartadas (0 quando nada se perde). */
export function revise(p: Project, params: Design, label: string) {
  generateDesign(params);
  const discarded = Math.max(0, p.revisions.length - p.cursor - 1);
  p.revisions = p.revisions.slice(0, p.cursor + 1);
  // A versão de base ganha uma seguinte: os passos dela congelam. Desfazer
  // passo a passo só mexe na ponta, nunca numa versão que já tem filhos.
  const base0 = p.revisions[p.cursor];
  if (base0?.placement) base0.placement = { ...base0.placement, back: [], ahead: [] };
  // Dois rótulos iguais na lista de versões são indistinguíveis ("Adicionar
  // módulo" duas vezes). O sufixo mantém cada linha identificável.
  const base = label.trim().slice(0, 90) || 'Ajuste de parâmetros';
  const taken = new Set(p.revisions.map((r) => r.label));
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base} (${i})`;
  p.revisions.push({
    id: randomUUID(),
    number: p.revisions.length + 1,
    params,
    label: name,
    at: new Date().toISOString(),
  });
  p.cursor = p.revisions.length - 1;
  return discarded;
}
/** Lugar atual da raiz: o passo que um movimento ou um desfazer guarda. */
function stepOf(params: Design, root: string): PlacementStep | null {
  const m = (params as { modules?: { id: string; position: [number, number, number]; rotation: number }[] }).modules?.find(
    (v) => v.id === root,
  );
  return m ? { position: [...m.position], rotation: m.rotation } : null;
}
function placeAt(params: Design, root: string, step: PlacementStep) {
  const r = executeRequest(params, [
    { kind: 'module.edit', id: root, position: step.position, rotation: step.rotation as 0 | 90 | 180 | 270 },
  ] as ShelfOp[]);
  return r.ok ? r.design : null;
}
/**
 * Movimento do móvel (arrastar, setas, girar). Segue a sequência na versão da
 * ponta quando ela é de movimentos do mesmo conjunto, recente e ninguém mais
 * mexeu (nem turno da IA): o lugar anterior vira um passo de desfazer, sem
 * versão nova. Fora disso abre a versão que começa uma sequência.
 */
export function applyPlacement(p: Project, ops: ShelfOp[], label: string, root: string, now = Date.now()) {
  const tip = p.revisions[p.cursor];
  const result = executeRequest(tip.params, ops);
  if (!result.ok) return result;
  if (JSON.stringify(result.design) === JSON.stringify(tip.params))
    return { ok: true as const, noop: true as const, design: result.design, discarded: 0 };
  const pl = tip.placement;
  const referenced = p.messages.some(
    (m) => m.revisionId === tip.id || m.result?.resultRevisionId === tip.id || m.context?.baseRevisionId === tip.id,
  );
  const before = stepOf(tip.params, root);
  if (
    pl &&
    before &&
    pl.root === root &&
    p.cursor === p.revisions.length - 1 &&
    now - Date.parse(pl.at) < PLACEMENT_MERGE_MS &&
    !referenced
  ) {
    generateDesign(result.design);
    tip.params = result.design;
    tip.placement = {
      root,
      at: new Date(now).toISOString(),
      back: [...pl.back, before].slice(-PLACEMENT_MAX_STEPS),
      ahead: [],
    };
    return { ok: true as const, noop: false as const, design: result.design, discarded: 0, merged: true };
  }
  const discarded = revise(p, result.design, label);
  p.revisions[p.cursor].placement = { root, at: new Date(now).toISOString(), back: [], ahead: [] };
  return { ok: true as const, noop: false as const, design: result.design, discarded, merged: false };
}
/**
 * Desfazer: na ponta, volta um movimento da sequência; sem passos, a versão
 * anterior. Devolve 'step' ou 'version' para o cliente saber o que andou.
 */
export function undo(p: Project): 'step' | 'version' | null {
  const rev = p.revisions[p.cursor];
  const pl = rev.placement;
  if (pl?.back.length && p.cursor === p.revisions.length - 1) {
    const target = pl.back[pl.back.length - 1];
    const now = stepOf(rev.params, pl.root);
    const params = now ? placeAt(rev.params, pl.root, target) : null;
    if (params && now) {
      rev.params = params;
      rev.placement = { ...pl, back: pl.back.slice(0, -1), ahead: [...pl.ahead, now] };
      return 'step';
    }
  }
  if (p.cursor === 0) return null;
  p.cursor -= 1;
  return 'version';
}
export function redo(p: Project): 'step' | 'version' | null {
  if (p.cursor < p.revisions.length - 1) {
    p.cursor += 1;
    return 'version';
  }
  const rev = p.revisions[p.cursor];
  const pl = rev.placement;
  if (!pl?.ahead.length) return null;
  const target = pl.ahead[pl.ahead.length - 1];
  const now = stepOf(rev.params, pl.root);
  const params = now ? placeAt(rev.params, pl.root, target) : null;
  if (!params || !now) return null;
  rev.params = params;
  rev.placement = { ...pl, ahead: pl.ahead.slice(0, -1), back: [...pl.back, now] };
  return 'step';
}
export function seek(p: Project, cursor: number) {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= p.revisions.length)
    throw new Error('Versão inválida.');
  p.cursor = cursor;
}
/**
 * Cria uma alternativa a partir da revisão indicada (snapshot consistente).
 * Copia o histórico até a revisão e só as mensagens vinculadas por id;
 * conversas antigas sem vínculo ficam no original e a alternativa começa
 * com uma mensagem explicando a origem. Originais e futuros preservados.
 */
export function fork(id: string, cursor: number, name: string) {
  const src = get(id);
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= src.revisions.length)
    throw new Error('Versão inválida.');
  const base = src.revisions[cursor];
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error('Dê um nome para a alternativa.');
  const keep = new Set(src.revisions.slice(0, cursor + 1).map((r) => r.id));
  const p: Project = {
    id: randomUUID(),
    name: clean,
    version: 0,
    cursor,
    revisions: src.revisions.slice(0, cursor + 1),
    messages: src.messages.filter(
      (m) => m.revisionId !== undefined && keep.has(m.revisionId),
    ),
    origin: {
      fromId: src.id,
      revision: base.number,
      at: new Date().toISOString(),
    },
    // A alternativa é do mesmo lugar: o ambiente informado continua valendo.
    ...(src.room ? { room: src.room } : {}),
  };
  p.messages.push({
    id: randomUUID(),
    role: 'assistant',
    content: `Alternativa criada a partir da versão ${base.number} de "${src.name}". Continue editando à vontade: o projeto original foi preservado.`,
    revisionId: base.id,
    revision: base.number,
  });
  database()
    .prepare('INSERT INTO projects VALUES (?, ?, ?, ?)')
    .run(p.id, encode(p), 0, new Date().toISOString());
  return view(p);
}
export function applyShelfOp(p: Project, op: ShelfOp, label: string) {
  const before = p.revisions[p.cursor].params;
  const after = applyOp(before, op);
  if (JSON.stringify(after) === JSON.stringify(before)) return { noop: true as const, discarded: 0 };
  return { noop: false as const, discarded: revise(p, after, label) };
}
function encode(p: Project) {
  return JSON.stringify({
    ...p,
    revisions: p.revisions.map((r) => ({
      ...r,
      params: canonical(normalize(r.params)),
    })),
  });
}
/** Resultado de um turno aplicado de forma atômica sobre uma cópia. */
export function applyRequest(p: Project, ops: ShelfOp[], label: string) {
  const before = p.revisions[p.cursor].params;
  const result = executeRequest(before, ops);
  if (!result.ok) return result;
  const current = result.design;
  if (JSON.stringify(current) === JSON.stringify(before))
    return { ok: true as const, noop: true as const, design: current, discarded: 0 };
  return { ok: true as const, noop: false as const, design: current, discarded: revise(p, current, label) };
}
