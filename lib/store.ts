import { randomUUID } from 'node:crypto';
import { openDatabase, backupDatabase as backupFile } from '#platform';
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
import { editedWall, movedObstacle, roomChangeLabel, type Room, type Wall } from './room';
import type { TurnUsage } from './models';
import { buildTemplate, templateById, templateStart } from './templates';
import type { StyleId } from './look';
import { STYLES } from './styles';
import { PLACEMENT_MAX_STEPS, PLACEMENT_MERGE_MS, type Placement, type PlacementStep } from './placement';
import { cleanAdjust, type QuoteAdjust } from './quote';
import type { RichBlock } from './rich';
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
import type { OptionCard } from './agent/types';
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
  /** Opções montadas para comparar: o cartão aplica ou salva como alternativa. */
  options?: OptionCard[];
  /**
   * Conteúdo rico ao lado do texto: cartões do estúdio (corte, orçamento,
   * móvel) e arquivos gerados, cada um com a versão que mostra (lib/rich.ts).
   */
  blocks?: RichBlock[];
  /** Mensagem feita por uma ação de cartão (gerar PDF), não por um pedido escrito. */
  action?: string;
};
export type Revision = {
  id: string;
  number: number;
  params: Design;
  label: string;
  at: string;
  /** Versão feita de movimentos seguidos: os passos para desfazer um a um. */
  placement?: Placement;
  /**
   * Ambiente como estava nesta versão (`null`: sem ambiente). Desfazer,
   * refazer e abrir uma versão trazem de volta os obstáculos dela.
   */
  room?: Room | null;
  /** Ajustes do orçamento feitos à mão nesta versão (lib/quote.ts). */
  quote?: QuoteAdjust;
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
  /**
   * Conversa que a pessoa limpou por último. Fica guardada para o "Desfazer"
   * e para a próxima limpeza a substituir; o cliente só vê quantas mensagens.
   */
  clearedChat?: { messages: Message[]; at: string; noteId: string };
  /**
   * Projeto de demonstração, gravado por `npm run demos` (lib/demos.ts). O id
   * é fixo: gravar de novo devolve o projeto ao estado original, sem
   * duplicar. `order` é a posição na vitrine (0 abre primeiro).
   */
  demo?: { key: string; order: number };
};
/**
 * Projetos com um pedido à IA em andamento. O turno grava no fim com a versão
 * que leu: quem mais grava no mesmo projeto (o envio de um arquivo feito pela
 * página) espera o turno acabar, senão a gravação do turno seria recusada.
 */
export const turnBusy = new Set<string>();

/** Espera o pedido em andamento no projeto terminar (até `ms`). */
export async function waitTurn(id: string, ms = 120_000) {
  const until = Date.now() + ms;
  while (turnBusy.has(id) && Date.now() < until) await new Promise((done) => setTimeout(done, 250));
  if (turnBusy.has(id)) throw new Error('O projeto está ocupado com um pedido. Tente de novo em instantes.');
}

/** SQLite do Node (data/merce.sqlite) ou do Durable Object na Cloudflare. */
function database() {
  return openDatabase();
}
export function list() {
  return (
    database().all<{ body: string; updated: string }>('SELECT body, updated FROM projects ORDER BY updated DESC')
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
      ...(p.demo ? { demo: p.demo.order } : {}),
    };
  });
}
/** "Minha estante" já existe? Então "Minha estante 2", 3…; nomes iguais confundem. */
export function uniqueName(base = 'Minha estante') {
  const taken = new Set(
    database()
      .all<{ name: string }>("SELECT json_extract(body, '$.name') AS name FROM projects")
      .map((r) => r.name),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
/** Apaga o projeto e o histórico dele. Não há lixeira: a ação é definitiva. */
export function remove(id: string) {
  const r = database().run('DELETE FROM projects WHERE id=?', id);
  if (!r.changes) throw new Error('Projeto não encontrado.');
  return { ok: true as const, removed: id };
}
export function get(id: string) {
  const r = database().get<{ body: string }>('SELECT body FROM projects WHERE id=?', id);
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
    // Versão de antes do ambiente no histórico: fica com o ambiente atual,
    // que era o que ela mostrava.
    if (rev.room === undefined) rev.room = p.room ?? null;
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
  database().run('INSERT INTO projects VALUES (?, ?, ?, ?)', p.id, encode(p), 0, new Date().toISOString());
  return view(p);
}
/**
 * Projeto novo a partir de um modelo pronto. O modelo é a versão 1 e a
 * primeira mensagem explica o que foi montado; um modelo que traz quarto de
 * exemplo já abre com o ambiente preenchido.
 */
export function createFromTemplate(templateId: string, style?: StyleId) {
  const t = templateById(templateId);
  if (!t) throw new Error('Modelo não encontrado.');
  const built = buildTemplate(t, style);
  const params = normalize(built);
  const start = templateStart(t, style, built);
  const revisionId = randomUUID();
  const p: Project = {
    id: randomUUID(),
    name: uniqueName(t.name),
    version: 0,
    cursor: 0,
    revisions: [
      { id: revisionId, number: 1, params, label: `Modelo: ${t.name}${style ? ` ${STYLES[style].label}` : ''}`, at: new Date().toISOString() },
    ],
    messages: [
      { id: randomUUID(), role: 'assistant', content: start.intro, revisionId, revision: 1 },
    ],
    ...(start.room ? { room: structuredClone(start.room) } : {}),
  };
  database().run('INSERT INTO projects VALUES (?, ?, ?, ?)', p.id, encode(p), 0, new Date().toISOString());
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
  database().run('INSERT INTO projects VALUES (?, ?, ?, ?)', p.id, encode(p), 0, new Date().toISOString());
  return view(p);
}
/**
 * Grava um projeto pronto com o id dele, no lugar do que houver com o mesmo
 * id. Só para os projetos de demonstração: a edição normal passa por save,
 * que confere a versão.
 */
export function putProject(p: Project, updated: string) {
  database().run('INSERT OR REPLACE INTO projects VALUES (?, ?, ?, ?)', p.id, encode(p), p.version, updated);
}
/** Cópia do banco inteiro num arquivo novo, na mesma pasta. Devolve o caminho. */
export function backupDatabase(name: string) {
  return backupFile(name);
}
/** Apaga as demonstrações que saíram da lista (ids fora de `keep`). */
export function removeDemosExcept(keep: readonly string[]) {
  const all = database().all<{ id: string }>("SELECT id FROM projects WHERE json_extract(body, '$.demo') IS NOT NULL");
  const gone = all.filter((r) => !keep.includes(r.id));
  for (const r of gone) database().run('DELETE FROM projects WHERE id=?', r.id);
  return gone.length;
}
/** Apaga os projetos que não são de demonstração. Devolve quantos saíram. */
export function removeNonDemo() {
  return database().run("DELETE FROM projects WHERE json_extract(body, '$.demo') IS NULL").changes;
}
export function save(p: Project, expected: number) {
  p.version = expected + 1;
  const r = database().run(
    'UPDATE projects SET body=?, version=?, updated=? WHERE id=? AND version=?',
    encode(p),
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
  const { clearedChat, ...rest } = p;
  return {
    ...rest,
    ...(clearedChat ? { chatCleared: { count: clearedChat.messages.length, at: clearedChat.at } } : {}),
    params: p.revisions[p.cursor].params,
    ...generateDesign(p.revisions[p.cursor].params),
  };
}
/**
 * Limpa a conversa: as mensagens saem da tela e do contexto da IA, o projeto
 * e as versões ficam. Uma nota diz onde o projeto está. A conversa limpa fica
 * guardada até a próxima limpeza, para desfazer.
 */
export function clearChat(p: Project) {
  const note = p.clearedChat && p.messages.length === 1 && p.messages[0].id === p.clearedChat.noteId;
  if (note || !p.messages.length) return { noop: true as const };
  const rev = p.revisions[p.cursor];
  const noteId = randomUUID();
  p.clearedChat = { messages: p.messages, at: new Date().toISOString(), noteId };
  p.messages = [
    {
      id: noteId,
      role: 'assistant',
      content: `Conversa limpa. O projeto continua na versão ${rev.number}; descreva a próxima mudança.`,
      revisionId: rev.id,
      revision: rev.number,
    },
  ];
  return { noop: false as const };
}
/** Traz de volta a conversa limpa, antes do que foi dito depois dela. */
export function restoreChat(p: Project) {
  const saved = p.clearedChat;
  if (!saved) throw new Error('Não há conversa para restaurar.');
  p.messages = [...saved.messages, ...p.messages.filter((m) => m.id !== saved.noteId)];
  delete p.clearedChat;
}
/**
 * Editar um pedido já enviado: a conversa volta para antes dele e o projeto
 * para a versão em que ele foi feito. As versões seguintes só saem quando o
 * pedido editado criar uma nova (revise), como em qualquer edição do passado.
 */
export function rewindChat(p: Project, messageId: string) {
  const i = p.messages.findIndex((m) => m.id === messageId);
  const m = p.messages[i];
  if (!m || m.role !== 'user') throw new Error('Não encontrei a mensagem para editar. Recarregue.');
  const baseId = m.context?.baseRevisionId ?? m.revisionId;
  const cursor = p.revisions.findIndex((r) => r.id === baseId);
  if (cursor < 0) throw new Error('A versão desta mensagem foi descartada; envie como um pedido novo.');
  p.messages = p.messages.slice(0, i);
  moveCursor(p, cursor);
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
  // Os ajustes do orçamento acompanham o móvel: mudar o desenho não apaga
  // o frete posto à mão nem a linha tirada.
  const quote = base0?.quote;
  p.revisions.push({
    id: randomUUID(),
    number: p.revisions.length + 1,
    params,
    label: name,
    at: new Date().toISOString(),
    room: p.room ?? null,
    ...(quote ? { quote } : {}),
  });
  p.cursor = p.revisions.length - 1;
  return discarded;
}
/**
 * Ajuste do orçamento (tirar linha, trocar quantidade, item à parte) vira
 * versão com o mesmo móvel: entra no Ctrl+Z e no histórico, e o cartão da
 * conversa, a aba e o PDF leem o mesmo ajuste.
 */
export function reviseQuote(p: Project, adjust: QuoteAdjust | undefined, label: string) {
  const tip = p.revisions[p.cursor];
  const next = cleanAdjust(adjust);
  if (JSON.stringify(next ?? null) === JSON.stringify(cleanAdjust(tip.quote) ?? null)) return { noop: true as const, discarded: 0 };
  const discarded = revise(p, tip.params, label);
  const rev = p.revisions[p.cursor];
  if (next) rev.quote = next;
  else delete rev.quote;
  return { noop: false as const, discarded };
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
    !pl.obstacle &&
    !pl.wall &&
    before &&
    pl.root === root &&
    p.cursor === p.revisions.length - 1 &&
    now - Date.parse(pl.at) < PLACEMENT_MERGE_MS &&
    !referenced
  ) {
    generateDesign(result.design);
    tip.params = result.design;
    tip.room = p.room ?? null;
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
/** Lugar e medida da parede: o passo que um ajuste dela guarda. */
function wallStep(w: Wall): PlacementStep {
  return { position: [w.xMm, w.zMm, 0], rotation: w.rotation, size: [w.widthMm, w.heightMm] };
}
/** Onde o que a sequência mexe está agora: a raiz do móvel, o obstáculo ou a parede. */
function stepNow(rev: Revision, pl: Placement): PlacementStep | null {
  if (pl.wall) {
    const w = rev.room?.walls?.find((v) => v.id === pl.root);
    return w ? wallStep(w) : null;
  }
  if (!pl.obstacle) return stepOf(rev.params, pl.root);
  const o = rev.room?.obstacles?.find((v) => v.id === pl.root);
  return o ? { position: [o.xMm, o.yMm, 0], rotation: 0 } : null;
}
/** Leva o móvel, o obstáculo ou a parede da sequência ao passo; false se não deu. */
function stepTo(p: Project, rev: Revision, pl: Placement, step: PlacementStep) {
  if (pl.wall) {
    if (!rev.room?.walls?.some((w) => w.id === pl.root)) return false;
    rev.room = {
      ...rev.room,
      walls: rev.room.walls.map((w) =>
        w.id === pl.root
          ? {
              ...w,
              xMm: step.position[0],
              zMm: step.position[1],
              rotation: step.rotation === 90 ? 90 : 0,
              ...(step.size ? { widthMm: step.size[0], heightMm: step.size[1] } : {}),
            }
          : w,
      ),
    };
    p.room = rev.room;
    return true;
  }
  if (pl.obstacle) {
    if (!rev.room) return false;
    rev.room = {
      ...rev.room,
      obstacles: rev.room.obstacles?.map((o) =>
        o.id === pl.root ? { ...o, xMm: step.position[0], yMm: step.position[1] } : o,
      ),
    };
    p.room = rev.room;
    return true;
  }
  const params = placeAt(rev.params, pl.root, step);
  if (!params) return false;
  rev.params = params;
  return true;
}
/** Muda a versão vigente e traz o ambiente que ela tinha. */
export function moveCursor(p: Project, cursor: number) {
  p.cursor = cursor;
  const room = p.revisions[cursor].room;
  if (room !== undefined) p.room = room ?? undefined;
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
    const now = stepNow(rev, pl);
    if (now && stepTo(p, rev, pl, target)) {
      rev.placement = { ...pl, back: pl.back.slice(0, -1), ahead: [...pl.ahead, now] };
      return 'step';
    }
  }
  if (p.cursor === 0) return null;
  moveCursor(p, p.cursor - 1);
  return 'version';
}
export function redo(p: Project): 'step' | 'version' | null {
  if (p.cursor < p.revisions.length - 1) {
    moveCursor(p, p.cursor + 1);
    return 'version';
  }
  const rev = p.revisions[p.cursor];
  const pl = rev.placement;
  if (!pl?.ahead.length) return null;
  const target = pl.ahead[pl.ahead.length - 1];
  const now = stepNow(rev, pl);
  if (!now || !stepTo(p, rev, pl, target)) return null;
  rev.placement = { ...pl, ahead: pl.ahead.slice(0, -1), back: [...pl.back, now] };
  return 'step';
}
/**
 * Mudança no ambiente (painel, arrasto de obstáculo, alça de parede, IA) vira
 * versão, com o mesmo móvel e o ambiente novo: entra no Ctrl+Z e no
 * histórico. Arrastos seguidos do mesmo obstáculo, e ajustes seguidos da
 * mesma parede, juntam numa versão só, como os do móvel.
 */
export function reviseRoom(p: Project, room: Room, label: string, now = Date.now()) {
  const before = p.room;
  if (JSON.stringify(before ?? null) === JSON.stringify(room)) return { noop: true as const, discarded: 0 };
  const tip = p.revisions[p.cursor];
  const moved = movedObstacle(before, room);
  const edited = moved ? null : editedWall(before, room);
  const pl = tip.placement;
  const referenced = p.messages.some(
    (m) => m.revisionId === tip.id || m.result?.resultRevisionId === tip.id || m.context?.baseRevisionId === tip.id,
  );
  const was = moved ? before?.obstacles?.find((o) => o.id === moved) : undefined;
  const wasWall = edited ? before?.walls?.find((w) => w.id === edited) : undefined;
  const sameRun = (root: string | null) =>
    !!pl && pl.root === root && p.cursor === p.revisions.length - 1 && now - Date.parse(pl.at) < PLACEMENT_MERGE_MS && !referenced;
  const previous = was && pl?.obstacle && sameRun(moved)
    ? { position: [was.xMm, was.yMm, 0] as [number, number, number], rotation: 0 }
    : wasWall && pl?.wall && sameRun(edited)
      ? wallStep(wasWall)
      : null;
  if (pl && previous) {
    p.room = room;
    tip.room = room;
    tip.placement = {
      ...pl,
      at: new Date(now).toISOString(),
      back: [...pl.back, previous].slice(-PLACEMENT_MAX_STEPS),
      ahead: [],
    };
    return { noop: false as const, discarded: 0, merged: true };
  }
  p.room = room;
  const discarded = revise(p, tip.params, label);
  const at = new Date(now).toISOString();
  if (moved) p.revisions[p.cursor].placement = { root: moved, obstacle: true, at, back: [], ahead: [] };
  else if (edited) p.revisions[p.cursor].placement = { root: edited, wall: true, at, back: [], ahead: [] };
  return { noop: false as const, discarded, merged: false };
}
/** Turno que mexeu no ambiente sem abrir versão: a mudança vira uma. */
export function settleRoom(p: Project) {
  const tip = p.revisions[p.cursor];
  if (tip.room === undefined || JSON.stringify(tip.room) === JSON.stringify(p.room ?? null)) return 0;
  const room = p.room;
  const label = `IA: ${room ? roomChangeLabel(tip.room ?? undefined, room).toLowerCase() : 'tirou o ambiente'}`;
  // Parte do ambiente da versão, para a sequência de arrastos comparar certo.
  p.room = tip.room ?? undefined;
  if (room) return reviseRoom(p, room, label).discarded;
  p.room = undefined;
  return revise(p, tip.params, label);
}
export function seek(p: Project, cursor: number) {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= p.revisions.length)
    throw new Error('Versão inválida.');
  moveCursor(p, cursor);
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
    ...(base.room !== undefined ? (base.room ? { room: base.room } : {}) : src.room ? { room: src.room } : {}),
  };
  p.messages.push({
    id: randomUUID(),
    role: 'assistant',
    content: `Alternativa criada a partir da versão ${base.number} de "${src.name}". Continue editando à vontade: o projeto original foi preservado.`,
    revisionId: base.id,
    revision: base.number,
  });
  database().run('INSERT INTO projects VALUES (?, ?, ?, ?)', p.id, encode(p), 0, new Date().toISOString());
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
