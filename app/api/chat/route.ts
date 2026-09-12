import { applyRequest, get, save, view, revise, type Clarification, type Message } from '@/lib/store';
import { interpretStream } from '@/lib/gateway';
import { materials } from '@/lib/furniture';
import {
  describeDesignChanges,
  describeOperations,
  executeRequest,
  generateDesign,
  resolveShelfId,
  shelfInfos,
  type ShelfOp,
} from '@/lib/studio';
import { entityIds } from '@/lib/studio';
import {
  type Progress,
  type TextPreview,
  type TurnOutcome,
} from '@/lib/progress';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getImage } from '@/lib/images';
const busy = new Set<string>();
/** Correções de geometria pedidas à IA antes de recusar o turno. */
const GEOMETRY_RETRIES = 2;
/** Dízimas de milímetro (185.33333) não devem aparecer em texto de resposta. */
const round2 = (value: number) => String(Math.round(value * 100) / 100);
/** Nome da ação da IA para o roteiro de etapas. */
const ACTION_LABEL: Record<string, string> = {
  update: 'alteração no projeto',
  clarify: 'pergunta antes de mexer',
  undo: 'voltar uma versão',
  redo: 'refazer a versão',
  answer: 'resposta sem alterar medidas',
};
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
        fast: z.boolean().optional(),
      })
      .parse(await req.json());
    if (!b.message && !b.imageId && !b.optionId)
      throw new Error('Escreva uma mensagem ou anexe uma imagem.');
    const requestId = b.requestId ?? randomUUID();
    const hit = confirmed.get(requestId);
    if (hit && hit.projectId === b.id) {
      try {
        const p = get(hit.projectId);
        const m = p.messages[hit.index];
        if (m?.result) {
          const state = view(p);
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
    // Replay só vale para turno concluído: um turno que falhou precisa rodar de novo.
    const replay = p.messages.findLast(m => m.role === 'assistant' && m.context?.requestId === requestId && m.result);
    if (replay) return Response.json(view(p));
    if (p.version !== b.version)
      throw new Error('O projeto mudou. Recarregue e tente novamente.');
    id = b.id;
    busy.add(id);
    // A mensagem do usuário é gravada antes de chamar a IA: recarregar no meio
    // do turno não pode apagar o que a pessoa escreveu.
    let version = b.version;
    let persistedUser = false;
    const started = Date.now();
    /** Chamadas ao provedor neste turno: 1 é o normal; 2 ou 3 significam reparo. */
    let modelCalls = 0;
    /** Motivo do último reparo de geometria, para o roteiro de etapas. */
    let repairNote = '';
    const baseRev = p.revisions[p.cursor];
    const historyNote =
      p.cursor < p.revisions.length - 1
        ? `Editando a versão ${baseRev.number} de ${p.revisions.length}; há revisões posteriores preservadas para consulta, não aplicadas ao estado atual.`
        : undefined;
    const before = baseRev.params;
    const infos = shelfInfos(before);
    const shelfIds = infos.map((s) => s.id);
    const validIds = entityIds(before);
    // Seleção explícita do usuário (só prateleiras válidas + peças fixas).
    const explicit = (b.selected ?? [])
      .map((sid) => resolveShelfId(sid, before) ?? sid)
      .filter((sid, i, all) => all.indexOf(sid) === i);
    const explicitShelves = explicit.filter((sid) => shelfIds.includes(sid));
    const lastAssistant = [...p.messages].reverse().find((m) => m.role === 'assistant');
    const lastRefs = lastAssistant?.context?.referencedPartIds.filter((rid) =>
      validIds.includes(rid),
    ) ?? [];
    // Referência explícita no texto tem precedência sobre a seleção.
    const textRefs = shelfRefIds(b.message, shelfIds);
    const ordered = orderWords(b.message);
    if (ordered.length && !textRefs.length && infos.length && /prateleira/i.test(b.message)) {
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
    const dangling = (explicit.length ? explicit : lastAssistant?.context?.referencedPartIds ?? []).filter(rid=>!validIds.includes(resolveShelfId(rid,before)??rid));    const pendingClarification = [...p.messages]
      .reverse()
      .find((m) => {
        if (!m.clarification || m.result?.outcome !== 'clarification') return false;
        // Respondida quando existe uma mensagem do usuário ligada a ela.
        const clarId = m.clarification.id;
        return !p.messages.some((later) => later.clarificationId === clarId);
      })?.clarification;
    // O turno que já É a resposta ao esclarecimento não deve receber a
    // pendência de novo: a mensagem atual já nomeia o alvo escolhido.
    const answeringClarification = Boolean(b.clarificationId && b.optionId);
    const run = async (
      progress: (event: Progress) => void,
      signal: AbortSignal,
      text: (preview: TextPreview) => void = () => {},
    ) => {
      // Resposta a esclarecimento pendente: valida e executa a intenção guardada.
      let answeredClarId: string | undefined;
      // Resposta digitada (sem escolher opção): a pergunta fica marcada como
      // respondida, senão ela seguiria pendente e voltaria no contexto dos
      // próximos turnos.
      if (b.clarificationId && !b.optionId) answeredClarId = b.clarificationId;
      if (b.clarificationId && b.optionId) {
        const clar=p.messages.find(m=>m.clarification?.id===b.clarificationId)?.clarification;
        const choice=clar?.options.find(o=>o.id===b.optionId);
        if(!clar||!choice||clar.baseRevisionId!==baseRev.id)throw new Error('Esclarecimento indisponível nesta versão. Descreva novamente o pedido.');
        if(!choice.partIds.every(id=>validIds.includes(id)))throw new Error('O alvo escolhido já não existe.');
        if(!clar.pendingOps?.length){
          explicit.splice(0,explicit.length,...choice.partIds);
          b.message=`${clar.pendingMessage??b.message}. Alvo escolhido: ${choice.label} (${choice.partIds.join(', ')}).`;
          answeredClarId=clar.id;
          b.clarificationId=undefined;b.optionId=undefined;
        }
      }
      if (b.clarificationId && b.optionId) {
        const target = p.messages.find((m) => m.clarification?.id === b.clarificationId);
        const clar = target?.clarification;
        if (!clar)
          throw new Error('Esclarecimento não encontrado. Descreva novamente o pedido.');
        const option = clar.options.find((o) => o.id === b.optionId);
        if (!option) throw new Error('Opção inválida para este esclarecimento.');
        if (clar.baseRevisionId !== baseRev.id)
          throw new Error('O projeto mudou desde a pergunta. Descreva novamente o pedido.');
        const partIds = option.partIds.filter((pid) => validIds.includes(pid));
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
          // Liga a resposta à pergunta: sem isso o servidor não sabe que já foi respondida.
          clarificationId: clar.id,
          context: {
            requestId,
            baseRevisionId: baseRev.id,
            selectedPartIds: explicit,
            referencedPartIds: partIds,
          },
        };
        p.messages.push(userMsg);
        version = save(p, version).version;
        persistedUser = true;
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
            report: {
              durationMs: Date.now() - started,
              outcome: 'rejected',
              changes: [],
              approach: d_approach(),
              steps: [
                {
                  tool: 'interpretar',
                  label: 'Aplicar a escolha do usuário',
                  detail: `sem chamada à IA · opção "${option.label}"`,
                },
                {
                  tool: 'validar',
                  label: 'Conferir medidas, vãos e peças',
                  detail: `nada foi aplicado: ${applied.error}`,
                },
                {
                  tool: 'descartar',
                  label: 'Preservar o projeto',
                  detail: `a versão ${baseRev.number} continua igual`,
                },
              ],
            },
          };
          p.messages.push(assistant);
          const state = save(p, version);
          version = state.version;
          confirmed.set(requestId, { projectId: p.id, index: p.messages.length - 1 });
          return { ...state, selected: partIds };
        }
        return { ...finishTurn(userMsg, partIds, pending, null, null), discarded: applied.discarded };
      }
      const userMsg: Message = {
        id: randomUUID(),
        role: 'user',
        content: b.message,
        ...(image ? { image } : {}),
        revisionId: baseRev.id,
        revision: baseRev.number,
        ...(answeredClarId ? { clarificationId: answeredClarId } : {}),
        context: {
          requestId,
          baseRevisionId: baseRev.id,
          selectedPartIds: explicit,
          referencedPartIds: explicit.length ? explicit : resolved,
        },
      };
      p.messages.push(userMsg);
      // Grava antes de chamar a IA: um recarregamento no meio do turno
      // (ou uma resposta que nunca chega) não pode apagar o pedido.
      version = save(p, version).version;
      persistedUser = true;
      let d = await interpretStream(
        before,
        baseRev.id,
        baseRev.number,
        [...p.messages],
        explicit,
        {
          requestId,
          baseRevisionId: baseRev.id,
          selectedPartIds: explicit,
          referencedPartIds: explicit.length ? explicit : resolved,
          pendingClarification: answeringClarification
            ? null
            : (pendingClarification?.question ?? null),
          historyNote,
        },
        progress,
        0,
        signal,
        text,
        Boolean(b.fast),
        p.room,
      );
      modelCalls++;
      signal.throwIfAborted();
      progress({
        stage: 'validating',
        label: 'Conferindo o projeto',
        detail:
          d.action === 'update'
            ? 'Verificando medidas, vãos e peças antes de aplicar.'
            : 'Conferindo o pedido com a versão atual.',
      });
      if(d.refs.length)userMsg.context!.referencedPartIds=d.refs;
      // Peça referenciada sumiu: nunca substituir — pedir esclarecimento.
      if (dangling.length && /suba|desça|mova|remova|vão|cm|mm|esta|essa/i.test(b.message)) {
        return finishClarify(userMsg, `A peça referenciada (${dangling.join(', ')}) já não existe nesta versão. Qual módulo ou compartimento você quer usar?`, null);
      }
      // "A outra" ambígua: pedir esclarecimento em vez de adivinhar.
      if (/a outra/i.test(b.message) && !/porta|gaveta|módulo|compartimento/i.test(b.message) && shelfIds.length > 2 && !textRefs.length && !explicitShelves.length && lastRefs.length <= 1) {
        return finishClarify(userMsg, 'Qual prateleira você quer mover?', null);
      }
      if (d.action === 'answer') {
        const answer = answerQuestion(b.message, d.message);
        return {...finishTurn(userMsg, d.select, [], answer, d), ...(d.view ? {viewAction:d.view} : {})};
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
      let ops = resolveOps(d.ops as ShelfOp[], referencedShelves);
      if (!ops.length && d.select.length)
        return finishTurn(userMsg, d.select, [], d.message, d, false, 'highlighted');
      if (!ops.length)
        return finishTurn(userMsg, d.select, [], `${d.message} (sem mudança nas medidas)`, d, false, 'unchanged');
      let preview = executeRequest(before, ops);
      // O modelo vê a composição, mas não vê o resultado do próprio lote: um
      // connect correto no papel pode cair sobre outro módulo. Devolve o erro
      // de validação e deixa corrigir no mesmo pedido, sem aplicar nada antes.
      for (let attempt = 1; !preview.ok && attempt <= GEOMETRY_RETRIES; attempt++) {
        repairNote = preview.error;
        progress({
          stage: 'retrying',
          label: 'Corrigindo o posicionamento',
          detail: `${preview.error} Pedindo uma proposta corrigida.`,
        });
        d = await interpretStream(
          before,
          baseRev.id,
          baseRev.number,
          [...p.messages],
          explicit,
          {
            requestId,
            baseRevisionId: baseRev.id,
            selectedPartIds: explicit,
            referencedPartIds: explicit.length ? explicit : resolved,
            pendingClarification: answeringClarification
            ? null
            : (pendingClarification?.question ?? null),
            historyNote: [
              historyNote,
              `A proposta anterior não passou na validação: ${preview.error} A composição não mudou. Reenvie o pedido completo, corrigido, com todas as operações necessárias. Lembre que em connect o side é o lado do próprio módulo pai no referencial dele, não a direção na tela.`,
            ]
              .filter(Boolean)
              .join(' '),
          },
          progress,
          0,
          signal,
          text,
          Boolean(b.fast),
          p.room,
        );
        modelCalls++;
        signal.throwIfAborted();
        if (d.refs.length) userMsg.context!.referencedPartIds = d.refs;
        if (d.action !== 'update') break;
        const corrected = resolveOps(d.ops as ShelfOp[], referencedShelves);
        if (!corrected.length) break;
        ops = corrected;
        preview = executeRequest(before, ops);
      }
      // Se a correção virou pergunta, ela é a resposta do turno.
      if (!preview.ok && d.action === 'clarify')
        return finishClarify(userMsg, d.message, d);
      if (!preview.ok) {
        const assistant: Message = {
          id: randomUUID(),
          role: 'assistant',
          content: `Não apliquei a alteração: ${preview.error} O projeto foi preservado na versão ${baseRev.number}.`,
          revisionId: baseRev.id,
          revision: baseRev.number,
          context: userMsg.context,
          result: { outcome: 'rejected', resultRevisionId: baseRev.id, appliedOperations: [], attemptedOperations:ops, changes: [] },
          report: {
            durationMs: Date.now() - started,
            outcome: 'rejected',
            changes: [],
            approach: d.approach,
            steps: [
              {
                tool: 'interpretar',
                label: 'Interpretar o pedido',
                detail: `${modelCalls} chamada(s) à IA · ${ACTION_LABEL[d.action] ?? d.action}`,
              },
              ...(repairNote
                ? [{ tool: 'corrigir', label: 'Corrigir a geometria', detail: repairNote }]
                : []),
              {
                tool: 'validar',
                label: 'Conferir medidas, vãos e peças',
                detail: `nada foi aplicado: ${preview.error}`,
              },
              {
                tool: 'descartar',
                label: 'Preservar o projeto',
                detail: `a versão ${baseRev.number} continua igual`,
              },
            ],
          },
        };
        p.messages.push(assistant);
        const state = save(p, version);
        version = state.version;
        confirmed.set(requestId, { projectId: p.id, index: p.messages.length - 1 });
        return { ...state, selected: [] };
      }
      if (JSON.stringify(preview.design) === JSON.stringify(before)) {
        return finishTurn(userMsg, d.select, ops, 'O projeto já está nesse estado; nenhuma medida mudou.', d, false, 'unchanged');
      }
      progress({
        stage: 'applying',
        label: 'Aplicando as alterações',
        detail:
          describeOperations(before, preview.design, ops)
            .map((step) => step.label)
            .join(' · ') || 'aplicando as operações validadas',
      });
      const discarded = revise(p, preview.design, b.message.slice(0,90));
      return { ...finishTurn(userMsg, d.select, ops, null, d), discarded };

      function d_approach() {
        return 'Proposta validada no servidor.';
      }
      /** Confirmação principal gerada do diff real; texto da IA é complemento. */
      function finishTurn(
        user: Message,
        select: string[],
        appliedOps: ShelfOp[],
        override: string | null,
        decision: { action?: string; approach: string; message: string; suggestions?: string[] } | null,
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
          // Sem separador, o resumo do diff colava na frase da IA:
          // "...atualizadas Adicionando um nicho...".
          content =
            override ??
            (decision?.message ? `${main}.\n\n${decision.message}` : main);
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
            dims: `${round2(v.c)} × ${round2(v.l)} × ${round2(v.thickness)} mm`,
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
          ...(decision?.suggestions?.length
            ? { suggestions: decision.suggestions }
            : {}),
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
            steps: [
              {
                tool: 'interpretar',
                label: 'Interpretar o pedido',
                detail: decision
                  ? `${modelCalls} chamada(s) à IA · ${ACTION_LABEL[decision.action ?? 'update'] ?? 'alteração no projeto'}`
                  : 'sem chamada à IA: escolha aplicada direto',
              },
              ...(repairNote
                ? [
                    {
                      tool: 'corrigir',
                      label: 'Corrigir a geometria',
                      detail: repairNote,
                    },
                  ]
                : []),
              {
                tool: 'validar',
                label: 'Conferir medidas, vãos e peças',
                detail: navigated
                  ? `versão ${baseRev.number} → ${p.revisions[p.cursor].number} localizada no histórico`
                  : outcome === 'unchanged'
                    ? 'as medidas já estavam nesse estado'
                    : `${appliedOps.length} operação(ões) aceita(s) pelo servidor`,
              },
              ...(appliedOps.length && changes.length
                ? describeOperations(before, after, appliedOps)
                : []),
              {
                tool: outcome === 'applied' ? 'salvar' : 'responder',
                label:
                  outcome === 'applied'
                    ? 'Salvar a versão'
                    : 'Responder sem mexer no projeto',
                detail:
                  outcome === 'applied'
                    ? `v${p.revisions[p.cursor].number} · ${p.revisions.length} versões no histórico`
                    : `nenhuma versão nova · v${baseRev.number}`,
              },
            ],
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
        const state = save(p, version);
        version = state.version;
        confirmed.set(requestId, { projectId: p.id, index: p.messages.length - 1 });
        const echo = explicit.filter((sid) => shelfIds.includes(sid) || !sid.startsWith('sh-'));
        return { ...state, selected: echo.length ? echo : affected.size ? [...affected] : select.map(id=>resolveShelfId(id,design)??id).filter(id=>entityIds(design).includes(id)) };
      }
      function finishClarify(user: Message, question: string, decision: { action?: string; approach: string } | null) {
        const options = (decision as {clarification?:{options:Clarification['options']}} | null)?.clarification?.options ?? infos.map((s) => ({ id: s.id, label: s.label, partIds: [s.id] }));
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
          report: {
            durationMs: Date.now() - started,
            outcome: 'clarification',
            changes: [],
            approach: decision?.approach,
            steps: [
              {
                tool: 'interpretar',
                label: 'Interpretar o pedido',
                detail: decision
                  ? `${modelCalls} chamada(s) à IA · ${ACTION_LABEL[decision.action ?? 'clarify'] ?? 'pergunta antes de mexer'}`
                  : 'sem chamada à IA',
              },
              {
                tool: 'validar',
                label: 'Conferir a versão da pergunta',
                detail: `v${baseRev.number} · ${options.length} opção(ões) reais listadas`,
              },
              {
                tool: 'perguntar',
                label: 'Perguntar antes de mexer',
                detail: 'nada foi alterado; a escolha fica com você',
              },
            ],
          },
        };
        p.messages.push(assistant);
        const state = save(p, version);
        version = state.version;
        confirmed.set(requestId, { projectId: p.id, index: p.messages.length - 1 });
        return { ...state, selected: [] };
      }
    };
    /**
     * Falha depois do pedido já salvo: grava um cartão repetível no histórico
     * para o trabalho não sumir quando a página recarrega.
     */
    const persistFailure = (e: unknown) => {
      const aborted =
        e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message));
      const message =
        e instanceof Error && e.name === 'TimeoutError'
          ? 'A IA demorou mais que o esperado. Seu projeto foi preservado; tente novamente.'
          : aborted
            ? 'A resposta foi interrompida antes de terminar. O pedido ficou salvo e pode ser repetido.'
            : (e instanceof Error ? e.message : '') || 'Não foi possível concluir.';
      if (!persistedUser) return undefined;
      if (p.messages.some((m) => m.context?.requestId === requestId && m.result))
        return undefined;
      p.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: '',
        revisionId: p.revisions[p.cursor].id,
        revision: p.revisions[p.cursor].number,
        retry: { message: b.message, ...(image ? { image } : {}) },
        error: message,
      });
      try {
        const state = save(p, version);
        version = state.version;
        return state;
      } catch {
        return undefined;
      }
    };
    if (!req.headers.get('accept')?.includes('text/event-stream')) {
      try {
        return Response.json(await run(() => {}, req.signal));
      } catch (e) {
        persistFailure(e);
        throw e;
      } finally {
        busy.delete(b.id);
      }
    }
    const cancellation = new AbortController();
    let ended = false;
    /** Última proposta pública já enviada: a etapa é atualizada, não repetida. */
    let lastApproach = '';
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
              // A proposta pública da IA aparece na hora para quem espera, mesmo
              // com a transmissão de depuração desligada: raciocínio privado
              // continua fora (isso é o campo `reasoning`, não `approach`).
              if (preview.approach && preview.approach !== lastApproach) {
                lastApproach = preview.approach;
                send('progress', {
                  stage: 'proposing',
                  label: 'Proposta da IA',
                  detail: preview.approach,
                  attempt: preview.attempt,
                });
              }
              if (req.headers.get('x-chat-preview') !== 'hidden')
                send('text', preview);
            },
          );
          send('done', result);
        } catch (e) {
          // O estado volta junto do erro: o cliente precisa saber a versão nova
          // (a mensagem do usuário já foi salva) para poder tentar de novo.
          const state = persistFailure(e);
          const aborted =
            e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message));
          send('error', {
            error:
              e instanceof Error && e.name === 'TimeoutError'
                ? 'A IA demorou mais que o esperado. Seu projeto foi preservado; tente novamente.'
                : aborted
                  ? 'A resposta foi interrompida antes de terminar. O pedido ficou salvo e pode ser repetido.'
                  : (e as Error).message,
            ...(state ? { state } : {}),
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
