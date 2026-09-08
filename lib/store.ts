import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
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
} from './design';
export type TurnContext = {
  requestId: string;
  baseRevisionId: string;
  selectedPartIds: string[];
  referencedPartIds: string[];
};
export type TurnResult = {
  outcome: import('./progress').TurnOutcome;
  resultRevisionId: string;
  appliedOperations: import('./design').ShelfOp[];
  changes: string[];
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
  pendingOps?: import('./design').ShelfOp[];
  pendingMessage?: string;
};
export type Message = {
  role: 'user' | 'assistant';
  content: string;
  id: string;
  image?: import('./images').ImageRef;
  report?: import('./progress').ChatReport;
  /** Id imutável da revisão vigente ao salvar a mensagem. */
  revisionId?: string;
  /** Número legado (1-based); pode repetir após branching — só exibição. */
  revision?: number;
  context?: TurnContext;
  result?: TurnResult;
  clarification?: Clarification;
  error?: string;
};
export type Revision = {
  id: string;
  number: number;
  params: Design;
  label: string;
  at: string;
};
export type Project = {
  id: string;
  name: string;
  version: number;
  cursor: number;
  revisions: Revision[];
  messages: Message[];
  origin?: { fromId: string; revision: number; at: string };
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
  }
  return db;
}
export function list() {
  return (
    database()
      .prepare('SELECT body FROM projects ORDER BY updated DESC')
      .all() as { body: string }[]
  ).map((r) => {
    const p = JSON.parse(r.body) as Project;
    return { id: p.id, name: p.name };
  });
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
  for (const m of p.messages) {
    if (!m.id) m.id = `legacy-${randomUUID()}`;
    if (m.revision !== undefined && !m.revisionId) m.revisionId = `legacy-${m.revision}`;
  }
  return p;
}
export function create() {
  const p: Project = {
    id: randomUUID(),
    name: 'Minha estante',
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
    .run(p.id, JSON.stringify(p), 0, new Date().toISOString());
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
      reply: 'Largura ajustada para 100 cm. As demais medidas foram preservadas.',
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
      reply: 'Vão inferior definido em 450 mm. As demais prateleiras foram preservadas.',
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
    messages.push({ id: randomUUID(), role: 'user', content: step.user, revisionId: rev.id, revision: rev.number });
    messages.push({ id: randomUUID(), role: 'assistant', content: step.reply, revisionId: rev.id, revision: rev.number });
  }
  const p: Project = {
    id: randomUUID(),
    name: 'Minha estante',
    version: 0,
    cursor: revisions.length - 1,
    revisions,
    messages,
  };
  database()
    .prepare('INSERT INTO projects VALUES (?, ?, ?, ?)')
    .run(p.id, JSON.stringify(p), 0, new Date().toISOString());
  return view(p);
}
export function save(p: Project, expected: number) {
  p.version = expected + 1;
  const r = database()
    .prepare(
      'UPDATE projects SET body=?, version=?, updated=? WHERE id=? AND version=?',
    )
    .run(
      JSON.stringify(p),
      p.version,
      new Date().toISOString(),
      p.id,
      expected,
    );
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
export function revise(p: Project, params: Design, label: string) {
  generateDesign(params);
  p.revisions = p.revisions.slice(0, p.cursor + 1);
  p.revisions.push({
    id: randomUUID(),
    number: p.revisions.length + 1,
    params,
    label,
    at: new Date().toISOString(),
  });
  p.cursor = p.revisions.length - 1;
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
    origin: { fromId: src.id, revision: base.number, at: new Date().toISOString() },
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
    .run(p.id, JSON.stringify(p), 0, new Date().toISOString());
  return view(p);
}
export function applyShelfOp(p: Project, op: ShelfOp, label: string) {
  const before = p.revisions[p.cursor].params;
  const after = applyOp(before, op);
  if (JSON.stringify(after) === JSON.stringify(before)) return true;
  revise(p, after, label);
  return false;
}
/** Resultado de um turno aplicado de forma atômica sobre uma cópia. */
export function applyRequest(p: Project, ops: ShelfOp[], label: string) {
  const before = p.revisions[p.cursor].params;
  let current = before;
  for (const op of ops) {
    try {
      current = applyOp(current, op);
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }
  if (JSON.stringify(current) === JSON.stringify(before))
    return { ok: true as const, noop: true as const, design: current };
  revise(p, current, label);
  return { ok: true as const, noop: false as const, design: current };
}
