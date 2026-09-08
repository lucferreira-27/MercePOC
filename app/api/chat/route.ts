import { applyRequest, get, save, type Clarification, type Message } from '@/lib/store';
import { interpretStream } from '@/lib/gateway';
import { materials } from '@/lib/furniture';
import {
  describeDesignChanges,
  executeRequest,
  generateDesign,
  resolveShelfId,
  shelfInfos,
  type ShelfOp,
} from '@/lib/design';
import {
  type Progress,
  type ChatReport,
  type TextPreview,
  type TurnOutcome,
} from '@/lib/progress';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getImage } from '@/lib/images';
const busy = new Set<string>();
/** Pedidos já confirmados: requestId → índice da mensagem assistente. */
const confirmed = new Map<string, { projectId: string; index: number }>();

function shelfRefIds(text: string, ids: readonly string[]): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const id of ids) {
    const m = /^sh-(\d+)$/.exec(id);
    if (!m) continue;
    const n = m[1];
    const patterns = [
      `prateleira ${Number(n)}`,
      `prateleira nº ${Number(n)}`,
      `prateleira n ${Number(n)}`,
      `prateleira #${Number(n)}`,
      `a ${Number(n)}ª prateleira`,
      `a ${Number(n)}a prateleira`,
    ];
    if (patterns.some((pat) => lower.includes(pat)) && !found.includes(id))
      found.push(id);
  }
  return found;
}

function orderWords(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  if (lower.includes('de cima') || lower.includes('superior') || lower.includes('mais alta'))
    out.push('top');
  if (lower.includes('de baixo') || lower.includes('inferior') || lower.includes('mais baixa'))
    out.push('bottom');
  return out;
}

export async function POST(req: Request) {
  let id: string | undefined;
  try {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin)
      return Response.json({ error: 'Origem inválida' }, { status: 403 });
    const b = z
      .object({
        id: z.uuid(),
        version: z.number().int(),
        message: z.string().trim().max(4000),
        imageId: z.uuid().optional(),
        selected: z.array(z.string().max(100)).max(20).optional(),
        requestId: z.string().trim().min(8).max(64).optional(),
        clarificationId: z.string().trim().min(1).max(64).optional(),
        optionId: z.string().trim().min(1).max(64).optional(),
      })
      .parse(await req.json());
    if (!b.message && !b.imageId && !b.optionId)
      throw new Error('Escreva uma mensagem ou anexe uma imagem.');
    const requestId = b.requestId ?? randomUUID();
    const hit = confirmed.get(requestId);
    if (hit) {
      try {
        const p = get(hit.projectId);
        const m = p.messages[hit.index];
        if (m?.result) {
          const state = save(p, p.version);
          return Response.json({ ...state, selected: m.context?.selectedPartIds ?? [] });
        }
      } catch {}
      confirmed.delete(requestId);
    }
    const image = b.imageId ? await getImage(b.imageId) : undefined;
    b.message ||= 'Use esta imagem como referência para a estante.';
    if (busy.has(b.id))
      return Response.json(
        { error: 'Aguarde a resposta anterior.' },
        { status: 409 },
      );
    const p = get(b.id);
    if (p.version !== b.version)
      throw new Error('O projeto mudou. Recarregue e tente novamente.');
    id = b.id;
    busy.add(id);
    const started = Date.now();
    const baseRev = p.revisions[p.cursor];
    const historyNote =
      p.cursor < p.revisions.length - 1
        ? `Editando a versão ${baseRev.number} de ${p.revisions.length}; há revisões posteriores preservadas para consulta, não aplicadas ao estado atual.`
        : undefined;
    const before = baseRev.params;
    const infos = shelfInfos(before);
    const shelfIds = infos.map((s) => s.id);
    // Seleção explícita do usuário (só prateleiras válidas + peças fixas).
    const explicit = (b.selected ?? [])
      .map((sid) => resolveShelfId(sid, before) ?? sid)
      .filter((sid, i, all) => all.indexOf(sid) === i);
    const explicitShelves = explicit.filter((sid) => shelfIds.includes(sid));
    const lastAssistant = [...p.messages].reverse().find((m) => m.role === 'assistant');
    const lastRefs = lastAssistant?.context?.referencedPartIds.filter((rid) =>
      shelfIds.includes(rid),
    ) ?? [];
    // Referência explícita no texto tem precedência sobre a seleção.
    const textRefs = shelfRefIds(b.message, shelfIds);
    const ordered = orderWords(b.message);
    if (ordered.length && !textRefs.length) {
      const sorted = [...infos].sort((a, c) => a.elevation - c.elevation);
      if (ordered.includes('top')) textRefs.push(sorted[sorted.length - 1].id);
      else if (ordered.includes('bottom')) textRefs.push(sorted[0].id);
    }
    // Resolução: texto > seleção atual > turno anterior inequívoco.
    let resolved: string[] = [];
    if (textRefs.length) resolved = textRefs;
    else if (explicitShelves.length) resolved = explicitShelves;
    else if (lastRefs.length === 1) resolved = lastRefs;
    const referencedShelves = resolved.filter((rid) => shelfIds.includes(rid));
    // Peça removida nunca é substituída silenciosamente.
    const dangling = (lastRefs.length ? lastRefs : explicitShelves).filter(
      (rid) => !shelfIds.includes(rid) && /^sh-/.test(rid),
    );
    const pendingClarification = [...p.messages]
      .reverse()
      .find((m) => m.clarification && !m.result)?.clarification;
    const run = async (
      progress: (event: Progress) => void,
      signal: AbortSignal,
      text: (preview: TextPreview) => void = () => {},
    ) => {
      // Resposta a esclarecimento pendente: valida e executa a intenção guardada.
      if (b.clarificationId && b.optionId) {
        const target = p.messages.find((m) => m.clarification?.id === b.clarificationId);
        const clar = target?.clarification;
        if (!clar)
          throw new Error('Esclarecimento não encontrado. Descreva novamente o pedido.');
        const option = clar.options.find((o) => o.id === b.optionId);
        if (!option) throw new Error('Opção inválida para este esclarecimento.');
        if (clar.baseRevisionId !== baseRev.id)
          throw new Error('O projeto mudou desde a pergunta. Descreva novamente o pedido.');
        const partIds = option.partIds.filter((pid) => shelfIds.includes(pid));
        if (!partIds.length)
          throw new Error('As peças desta opção já não existem. Escolha outra ou descreva novamente.');
        const pending = (clar.pendingOps ?? []).map((op) => {
          if (op.kind === 'move') return { ...op, ids: partIds };
          if (op.kind === 'gap') return { ...op, id: partIds[0] };
          if (op.kind === 'remove') return { ...op, ids: partIds };
          return op;
        });
        const userMsg: Message = {
          id: randomUUID(),
          role: 'user',
          content: `${clar.pendingMessage ?? b.message} (${option.label})`,
          revisionId: baseRev.id,
          revision: baseRev.number,
          context: {
            requestId,
            baseRevisionId: baseRev.id,
            selectedPartIds: explicit,
            referencedPartIds: partIds,
          },
        };
        p.messages.push(userMsg);
        const applied = applyRequest(p, pending, userMsg.content.slice(0, 90));
        if (!applied.ok) {
          const assistant: Message = {
            id: randomUUID(),
            role: 'assistant',
            content: `Não apliquei a alteração: ${applied.error} O projeto foi preservado.`,
            revisionId: baseRev.id,
            revision: baseRev.number,
            context: { requestId, baseRevisionId: baseRev.id, selectedPartIds: explicit, referencedPartIds: partIds },
            result: { outcome: 'rejected', resultRevisionId: baseRev.id, appliedOperations: [], changes: [] },
            report: { durationMs: Date.now() - started, outcome: 'rejected', changes: [], approach: d_approach() },
          };
          p.messages.push(assistant);
          const state = save(p, b.version);
          confirmed.set(requestId, { projectId: p.id, index: p.messages.length - 1 });
          return { ...state, selected: partIds };
        }
        return finishTurn(userMsg, partIds, pending, null, null);
      }
      const d = await interpretStream(
        before,
        baseRev.id,
        baseRev.number,
        p.messages,
        explicit,
        {
          requestId,
          baseRevisionId: baseRev.id,
          selectedPartIds: explicit,
          referencedPartIds: referencedShelves,
          pendingClarification: pendingClarification?.question ?? null,
          historyNote,
        },
        progress,
        0,
        signal,
        text,
      );
      signal.throwIfAborted();
      progress({
        stage: 'validating',
        label: 'Conferindo o projeto',
        detail:
          d.action === 'update'
            ? 'Verificando medidas, vãos e peças antes de aplicar.'
            : 'Conferindo o pedido com a versão atual.',
      });
      const userMsg: Message = {
        id: randomUUID(),
        role: 'user',
        content: b.message,
        ...(image ? { image } : {}),
        revisionId: baseRev.id,
        revision: baseRev.number,
        context: {
          requestId,
          baseRevisionId: baseRev.id,
          selectedPartIds: explicit,
          referencedPartIds: referencedShelves,
        },
      };
      p.messages.push(userMsg);
      // Peça referenciada sumiu: nunca substituir — pedir esclarecimento.
      if (dangling.length && /suba|desça|mova|remova|vão|cm|mm|esta|essa/i.test(b.message)) {
        return finishClarify(userMsg, `A peça referenciada (${dangling.join(', ')}) já não existe nesta versão. Qual prateleira você quer usar?`, null);
      }
      // "A outra" ambígua: pedir esclarecimento em vez de adivinhar.
      if (/a outra/i.test(b.message) && shelfIds.length > 2 && !textRefs.length && !explicitShelves.length && lastRefs.length <= 1) {
        return finishClarify(userMsg, 'Qual prateleira você quer mover?', null);
      }
      if (d.action === 'answer') {
        const answer = answerQuestion(b.message, d.message);
        return finishTurn(userMsg, d.select, [], answer, d);
      }
      if (d.action === 'clarify') {
        return finishClarify(userMsg, d.message, d);
      }
      if (d.action === 'undo') {
        if (p.cursor === 0) return finishTurn(userMsg, [], [], 'Você já está na primeira versão.', d);
        p.cursor--;
        return finishTurn(userMsg, [], [], null, d, true);
      }
      if (d.action === 'redo') {
        if (p.cursor === p.revisions.length - 1)
          return finishTurn(userMsg, [], [], 'Não há alteração para refazer.', d);
        p.cursor++;
        return finishTurn(userMsg, [], [], null, d, true);
      }
      // update: resolve referências pronominais ("esta/mais 5cm") antes de validar.
      const ops = resolveOps(d.ops as ShelfOp[], referencedShelves);
      if (!ops.length && d.select.length)
        return finishTurn(userMsg, d.select, [], d.message, d, false, 'highlighted');
      if (!ops.length)
        return finishTurn(userMsg, d.select, [], `${d.message} (sem mudança nas medidas)`, d, false, 'unchanged');
      const preview = executeRequest(before, ops);
      if (!preview.ok) {
        const assistant: Message = {
          id: randomUUID(),
          role: 'assistant',
          content: `Não apliquei a alteração: ${preview.error} O projeto foi preservado na versão ${baseRev.number}.`,
          revisionId: baseRev.id,
          revision: baseRev.number,
          context: userMsg.context,
          result: { outcome: 'rejected', resultRevisionId: baseRev.id, appliedOperations: [], changes: [] },
          report: { durationMs: Date.now() - started, outcome: 'rejected', changes: [], approach: d.approach },
        };
        p.messages.push(assistant);
        const state = save(p, b.version);
        confirmed.set(requestId, { projectId: p.id, index: p.messages.length - 1 });
        return { ...state, selected: [] };
      }
      if (JSON.stringify(preview.design) === JSON.stringify(before)) {
        return finishTurn(userMsg, d.select, ops, 'O projeto já está nesse estado; nenhuma medida mudou.', d, false, 'unchanged');
      }
      const applied = applyRequest(p, ops, b.message.slice(0, 90));
      if (!applied.ok) {
        const assistant: Message = {
          id: randomUUID(),
          role: 'assistant',
          content: `Não apliquei a alteração: ${applied.error} O projeto foi preservado na versão ${baseRev.number}.`,
          revisionId: baseRev.id,
          revision: baseRev.number,
          context: userMsg.context,
          result: { outcome: 'rejected', resultRevisionId: baseRev.id, appliedOperations: [], changes: [] },
          report: { durationMs: Date.now() - started, outcome: 'rejected', changes: [], approach: d.approach },
        };
        p.messages.push(assistant);
        const state = save(p, b.version);
        confirmed.set(requestId, { projectId: p.id, index: p.messages.length - 1 });
        return { ...state, selected: [] };
      }
      return finishTurn(userMsg, d.select, ops, null, d);

      function d_approach() {
        return 'Proposta validada no servidor.';
      }
      /** Confirmação principal gerada do diff real; texto da IA é complemento. */
      function finishTurn(
        user: Message,
        select: string[],
        appliedOps: ShelfOp[],
        override: string | null,
        decision: { approach: string; message: string } | null,
        navigated = false,
        forceOutcome?: TurnOutcome,
      ) {
        const after = p.revisions[p.cursor].params;
        const changes = navigated
          ? [`Versão ${baseRev.number} → ${p.revisions[p.cursor].number}`]
          : describeDesignChanges(before, after);
        let outcome: TurnOutcome;
        let content: string;
        if (forceOutcome) {
          outcome = forceOutcome;
          content = override ?? decision?.message ?? '';
        } else if (navigated || changes.length) {
          outcome = 'applied';
          const main = changes.join('. ');
          content = override ?? (main + (decision?.message ? ` ${decision.message}` : ''));
        } else if (select.length) {
          outcome = 'highlighted';
          content = override ?? decision?.message ?? 'Peças destacadas no modelo.';
        } else if (decision) {
          outcome = 'answered';
          content = override ?? decision.message;
        } else {
          outcome = 'answered';
          content = override ?? '';
        }
        const design = p.revisions[p.cursor].params;
        const parts = generateDesign(design).parts;
        const labels = new Map(shelfInfos(before).map((s) => [s.id, s.label]));
        const afterLabels = new Map(shelfInfos(design).map((s) => [s.id, s.label]));
        const color = materials.find((m) => m.id === design.materialId)?.color ?? '#999';
        const affected = new Set<string>();
        for (const op of appliedOps) {
          if (op.kind === 'move' || op.kind === 'remove') for (const sid of op.ids) affected.add(sid);
          if (op.kind === 'gap') affected.add(op.id);
        }
        const showcase = select
          .map((sid) => resolveShelfId(sid, design) ?? sid)
          .map((sid) => parts.find((part) => part.id === sid))
          .filter((v) => v !== undefined)
          .map((v) => ({
            id: v.id,
            name: afterLabels.get(v.id) ?? labels.get(v.id) ?? v.name,
            dims: `${v.c} × ${v.l} × ${v.thickness} mm`,
            material: v.material,
            size: v.size,
            color,
          }));
        const assistant: Message = {
          id: randomUUID(),
          role: 'assistant',
          content,
          revisionId: p.revisions[p.cursor].id,
          revision: p.revisions[p.cursor].number,
          context: user.context,
          result: {
            outcome,
            resultRevisionId: p.revisions[p.cursor].id,
            appliedOperations: appliedOps,
            changes,
          },
          report: {
            durationMs: Date.now() - started,
            outcome,
            changes,
            approach: decision?.approach,
            selected: showcase,
          },
        };
        p.messages.push(assistant);
        progress({
          stage: 'saving',
          label: 'Salvando o resultado',
          detail: changes.length
            ? 'Registrando a versão e preparando o modelo 3D.'
            : 'Salvando a resposta. As medidas foram preservadas.',
        });
        const state = save(p, b.version);
        confirmed.set(requestId, { projectId: p.id, index: p.messages.length - 1 });
        return { ...state, selected: affected.size ? [...affected] : showcase.map((v) => v.id) };
      }
      function finishClarify(user: Message, question: string, decision: { approach: string } | null) {
        const options = infos.map((s) => ({ id: s.id, label: s.label, partIds: [s.id] }));
        const clar: Clarification = {
          id: randomUUID(),
          question,
          baseRevisionId: baseRev.id,
          options,
          pendingOps: (decision as { ops?: ShelfOp[] } | null)?.ops,
          pendingMessage: b.message,
        };
        const assistant: Message = {
          id: randomUUID(),
          role: 'assistant',
          content: question,
          revisionId: baseRev.id,
          revision: baseRev.number,
          context: user.context,
          clarification: clar,
          result: { outcome: 'clarification', resultRevisionId: baseRev.id, appliedOperations: [], changes: [] },
          report: { durationMs: Date.now() - started, outcome: 'clarification', changes: [], approach: decision?.approach },
        };
        p.messages.push(assistant);
        const state = save(p, b.version);
        confirmed.set(requestId, { projectId: p.id, index: p.messages.length - 1 });
        return { ...state, selected: [] };
      }
    };
    if (!req.headers.get('accept')?.includes('text/event-stream')) {
      try {
        return Response.json(await run(() => {}, req.signal));
      } finally {
        busy.delete(b.id);
      }
    }
    const cancellation = new AbortController();
    let ended = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (event: string, data: unknown) => {
          if (!ended) {
            try {
              controller.enqueue(
                enc.encode(
                  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
                ),
              );
            } catch {
              ended = true;
              cancellation.abort();
            }
          }
        };
        const heartbeat = setInterval(
          () => send('heartbeat', { elapsedMs: Date.now() - started }),
          10000,
        );
        try {
          const result = await run(
            (event) => send('progress', event),
            AbortSignal.any([req.signal, cancellation.signal]),
            (preview) => {
              if (req.headers.get('x-chat-preview') !== 'hidden')
                send('text', preview);
            },
          );
          send('done', result);
        } catch (e) {
          send('error', {
            error:
              e instanceof Error && e.name === 'TimeoutError'
                ? 'A IA demorou mais que o esperado. Seu projeto foi preservado; tente novamente.'
                : (e as Error).message,
          });
        } finally {
          clearInterval(heartbeat);
          busy.delete(b.id);
          if (!ended) {
            ended = true;
            controller.close();
          }
        }
      },
      cancel() {
        ended = true;
        cancellation.abort();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (e) {
    if (id) busy.delete(id);
    return Response.json(
      {
        error:
          e instanceof z.ZodError ? 'Pedido inválido.' : (e as Error).message,
      },
      { status: 400 },
    );
  }
}

/** Preenche ids ausentes em ops pronominais usando a referência resolvida. */
function resolveOps(ops: ShelfOp[], refs: string[]): ShelfOp[] {
  return ops.map((op) => {
    if (op.kind === 'move' && !op.ids.length && refs.length) return { ...op, ids: [...refs] };
    if (op.kind === 'remove' && !op.ids.length && refs.length) return { ...op, ids: [...refs] };
    if (op.kind === 'gap' && !op.id && refs.length === 1) return { ...op, id: refs[0] };
    return op;
  });
}

/** Responde perguntas informativas a partir do design atual, sem revisão. */
function answerQuestion(asked: string, fallback: string): string {
  void asked;
  return fallback;
}
