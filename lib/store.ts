import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaults, generate, type Params } from './furniture';
export type Message = {
  role: 'user' | 'assistant';
  content: string;
  image?: import('./images').ImageRef;
  report?: import('./progress').ChatReport;
};
export type Revision = {
  number: number;
  params: Params;
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
  return JSON.parse(r.body) as Project;
}
export function create() {
  const p: Project = {
    id: randomUUID(),
    name: 'Minha estante',
    version: 0,
    cursor: 0,
    revisions: [
      {
        number: 1,
        params: { ...defaults },
        label: 'Estante inicial',
        at: new Date().toISOString(),
      },
    ],
    messages: [
      {
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
    changes: Partial<Params>;
    user: string;
    reply: string;
  }[] = [
    {
      label: 'Largura para 100 cm',
      changes: { width: 1000 },
      user: 'Aumente a largura para 1 metro.',
      reply: 'Largura ajustada para 100 cm. As demais medidas foram preservadas.',
    },
    {
      label: 'Altura para 200 cm',
      changes: { height: 2000 },
      user: 'Deixe com 2 metros de altura.',
      reply: 'Altura ajustada para 200 cm. Os vãos foram redistribuídos.',
    },
    {
      label: 'Material grafite',
      changes: { materialId: 'graphite' },
      user: 'Mude o material para grafite.',
      reply: 'Material trocado para grafite. As medidas continuam as mesmas.',
    },
    {
      label: 'Cinco prateleiras',
      changes: { shelfCount: 5 },
      user: 'Quero cinco prateleiras.',
      reply: 'Prateleiras ajustadas para cinco, com distribuição igual.',
    },
    {
      label: 'Vão inferior de 450 mm',
      changes: { bottomOpening: 450 },
      user: 'Deixe o vão de baixo com 45 cm.',
      reply: 'Vão inferior definido em 450 mm. As demais seguem distribuídas.',
    },
  ];
  const revisions: Revision[] = [
    {
      number: 1,
      params: { ...defaults },
      label: 'Estante inicial',
      at: at(0, steps.length + 1),
    },
  ];
  for (const [i, step] of steps.entries()) {
    const params = { ...revisions[i].params, ...step.changes };
    generate(params);
    revisions.push({
      number: i + 2,
      params,
      label: step.label,
      at: at(i + 1, steps.length + 1),
    });
  }
  const messages: Message[] = [
    {
      role: 'assistant',
      content:
        'Vamos criar sua estante. Comecei com 80 × 180 × 35 cm, quatro prateleiras e carvalho. Descreva o que você quer mudar.',
    },
  ];
  for (const step of steps) {
    messages.push({ role: 'user', content: step.user });
    messages.push({ role: 'assistant', content: step.reply });
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
    ...generate(p.revisions[p.cursor].params),
  };
}
export function revise(p: Project, params: Params, label: string) {
  generate(params);
  p.revisions = p.revisions.slice(0, p.cursor + 1);
  p.revisions.push({
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
