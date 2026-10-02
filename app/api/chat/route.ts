import { applyObstacleEdits } from '@/lib/room';
import { applyRequest, get, moveCursor, rewindChat, save, settleRoom, view, revise, type Clarification, type Message } from '@/lib/store';
import { sameOrigin } from '@/lib/utils';
import { interpretStream, reviewAndCorrect, withFallback, type CheckedReview } from '@/lib/gateway';
import { materials } from '@/lib/furniture';
import {
  describeDesignChanges,
  describeHighlights,
  executeRequest,
  generateDesign,
  resolveShelfId,
  shelfInfos,
  type ShelfOp,
} from '@/lib/studio';
import { canonical, entityIds } from '@/lib/studio';
import { drawingParts } from '@/lib/fittings';
import {
  type Progress,
  type TextPreview,
  type TurnOutcome,
} from '@/lib/progress';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getImage, imageDataUrl, saveImage, type ImageRef } from '@/lib/images';
import { planDataUrl, planPng } from '@/lib/plan-render';
import { mergePrices, money, quoteOf } from '@/lib/quote';
import { runAgentTurn, type TurnDiagnostics } from '@/lib/agent/turn';
import { openTrace } from '@/lib/trace';
import { UI_TABS, VIEW_MODES, type AgentEvent } from '@/lib/agent/types';
import {
  addUsage,
  DEFAULT_MODEL,
  emptyUsage,
  modelInfo,
  MODEL_KEYS,
  priceOf,
  type ModelKey,
  type ProviderUsage,
  type TurnUsage,
} from '@/lib/models';
import type { Design } from '@/lib/studio';

/**
 * Orçamento e plano de corte da versão atual em uma linha para o prompt. Sem
 * isto a IA respondia "quanto custa" ou "quantas chapas" de cabeça.
 */
function quoteSummary(design: Design, prices: unknown) {
  try {
    const q = quoteOf(canonical(design), mergePrices(prices));
    const sheets = q.plan.groups
      .map((g) => `${g.sheets}× ${g.material} ${g.thickness} mm (${Math.round(g.efficiency * 100)}% aproveitada)`)
      .join('; ');
    return `Orçamento estimado desta versão, com a tabela de preços do usuário: total ${money(q.total)} (custo ${money(q.cost)} + margem ${money(q.marginValue)}); chapas: ${sheets}; ${q.counts.doors} portas, ${q.counts.drawers} gavetas, ${q.counts.hinges} dobradiças, ${q.counts.edgeMeters} m de fita. Pergunta de preço, custo, chapas ou ferragens usa action answer com estes números, diz que é estimativa editável na aba Orçamento e não inventa outros valores.`;
  } catch {
    return '';
  }
}
const busy = new Set<string>();
/** Correções de geometria pedidas à IA antes de recusar o turno. */
const GEOMETRY_RETRIES = 2;
/** Dízimas de milímetro (185.33333) não devem aparecer em texto de resposta. */
const round2 = (value: number) => String(Math.round(value * 100) / 100);
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
    if (!sameOrigin(req))
      return Response.json({ error: 'Origem inválida' }, { status: 403 });
    const b = z
      .object({
        id: z.uuid(),
        version: z.number().int(),
        message: z.string().trim().max(4000),
        imageId: z.uuid().optional(),
        selected: z.array(z.string().max(100)).max(1000).optional(),
        requestId: z.string().trim().min(8).max(64).optional(),
        clarificationId: z.string().trim().min(1).max(64).optional(),
        optionId: z.string().trim().min(1).max(64).optional(),
        /** Pedido já enviado que esta mensagem substitui: a conversa e o projeto voltam para antes dele. */
        editOf: z.string().trim().min(1).max(64).optional(),
        fast: z.boolean().optional(),
        /** Modelo escolhido no compositor; `fast` segue valendo para scripts antigos. */
        model: z.enum(MODEL_KEYS).optional(),
        // Tabela de preços do navegador: a IA responde "quanto custa" com os
        // mesmos números da aba Orçamento. Formato solto, saneado por mergePrices.
        prices: z.unknown().optional(),
        /** Assistente em laço (ferramentas); ausente, ligado (MERCE_AGENT=0 no servidor desliga). */
        agent: z.boolean().optional(),
        /** O que a pessoa está vendo: vista, aba, toggles e frentes abertas. */
        ui: z
          .object({
            view: z.enum(VIEW_MODES),
            tab: z.enum(UI_TABS),
            exploded: z.boolean(),
            dims: z.boolean(),
            room: z.boolean(),
            open: z.array(z.string().max(100)).max(200),
          })
          .optional(),
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
    if (b.editOf) rewindChat(p, b.editOf);
    id = b.id;
    busy.add(id);
    // A mensagem do usuário é gravada antes de chamar a IA: recarregar no meio
    // do turno não pode apagar o que a pessoa escreveu.
    let version = b.version;
    let persistedUser = false;
    const started = Date.now();
    const baseRev = p.revisions[p.cursor];
    const historyNote =
      p.cursor < p.revisions.length - 1
        ? `Editando a versão ${baseRev.number} de ${p.revisions.length}; há revisões posteriores preservadas para consulta, não aplicadas ao estado atual.`
        : undefined;
    const before = baseRev.params;
    const quoteNote = quoteSummary(before, b.prices);
    // Sem modelo no pedido vale o padrão do estúdio (Luna, raciocínio alto).
    const modelChoice: ModelKey = b.model ?? (b.fast ? 'qwen-fast' : DEFAULT_MODEL);
    const jpeg = Boolean(modelInfo(modelChoice).fastProfile);
    // Custo do turno: cada chamada ao provedor soma aqui, sai ao vivo para quem
    // espera e fica gravada na resposta, para o total da sessão sobreviver ao
    // recarregamento.
    const price = priceOf(modelChoice, process.env);
    let turnUsage: TurnUsage = emptyUsage(modelChoice);
    let usageListener: (usage: TurnUsage) => void = () => {};
    // A reserva (fallbackModel) responde com outro preço.
    const recordUsage = (usage: ProviderUsage, model?: ModelKey) => {
      turnUsage = addUsage(turnUsage, usage, model && model !== modelChoice ? priceOf(model, process.env) : price);
      usageListener(turnUsage);
    };
    const usageField = () => (turnUsage.calls ? { usage: turnUsage } : {});
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
    const agentMode = b.agent ?? process.env.MERCE_AGENT !== '0';
    const trace = openTrace(requestId, {
      projectId: p.id,
      projectName: p.name,
      version: b.version,
      revision: baseRev.number,
      model: modelChoice,
      agent: agentMode,
      message: b.message,
      imageId: b.imageId ?? null,
      selected: explicit,
      ui: b.ui ?? null,
      clarificationId: b.clarificationId ?? null,
      optionId: b.optionId ?? null,
      stream: !!req.headers.get('accept')?.includes('text/event-stream'),
    });
    // Quem fechou a conexão, e quando: sem isto "Interrompido" não dizia se
    // foi a pessoa, a aba recarregada ou o servidor.
    req.signal.addEventListener('abort', () => trace.write('client.disconnect', { reason: String(req.signal.reason ?? '') }), { once: true });
    const run = async (
      progress: (event: Progress) => void,
      signal: AbortSignal,
      text: (preview: TextPreview) => void = () => {},
      emit: (event: AgentEvent) => void = () => {},
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
      // Foto também vai pelo laço: com o inventário da foto e o place montando
      // cada corpo de uma vez, ele copia melhor que o caminho antigo nas fotos
      // reais (bench/photo-real.mjs: 60% no antigo, 70%+ no laço) e monta o
      // ambiente (parede, janela, porta, TV), que o antigo não mede.
      if (agentMode) {
        // Assistente em laço: a IA usa as ferramentas do estúdio até terminar
        // e o pedido inteiro vira uma versão. A fala pública dela aparece como
        // a proposta da etapa, como no caminho antigo.
        let said = '';
        const turn = await runAgentTurn({
          project: p,
          version,
          user: userMsg,
          request: b.message,
          selected: explicit,
          ui: b.ui ?? null,
          prices: mergePrices(b.prices),
          image,
          model: modelChoice,
          requestId,
          started,
          signal,
          progress,
          emit,
          trace,
          onUsage: recordUsage,
          onText: (content) => {
            said = content.slice(0, 1200);
            text({ approach: said, answer: '', attempt: 1 });
          },
          onPulse: (bytes, reasoning) => text({ approach: said, answer: '', attempt: 1, bytes, reasoningTotal: reasoning }),
          usage: usageField,
        });
        if (turn.projectId === p.id) version = turn.state.version;
        confirmed.set(requestId, { projectId: turn.projectId, index: turn.index });
        return turn.state;
      }
      // O desenho do resultado e o veredito da conferência entram na resposta
      // como imagem e como leitura, não como se fossem o texto da IA.
      let resultImage: ImageRef | undefined;
      let resultReview: CheckedReview | undefined;
      // Turno com foto: a IA recebe também o desenho do projeto atual, para
      // planejar sabendo como a peça está hoje, e não só em milímetros.
      const currentView = image
        ? await planDataUrl(drawingParts(canonical(before)))
        : undefined;
      // Provedor fora no caminho antigo: a mesma chamada na reserva, que fica
      // para as correções e a conferência da foto deste turno.
      let model = modelChoice;
      const switchTo = (alt: ModelKey) => {
        model = alt;
        progress({ stage: 'connecting', label: `Trocando para ${modelInfo(alt).label}`, detail: 'O provedor falhou; tentando o modelo de reserva.' });
      };
      let d = await withFallback(model, (m) => interpretStream(
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
          quoteNote,
        },
        progress,
        0,
        signal,
        text,
        m,
        p.room,
        currentView,
        (u) => recordUsage(u, m),
      ), signal, switchTo);
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
      // Obstáculos na parede: entram na versão do turno (ou numa própria,
      // quando o turno não muda o móvel), para o Ctrl+Z desfazer junto.
      if (d.obstacles && (d.obstacles.add.length || d.obstacles.move.length || d.obstacles.remove.length)) {
        const edited = applyObstacleEdits(p.room, d.obstacles, (before as { width?: number }).width ?? 0);
        p.room = edited.room;
        if (edited.skipped.length) d.message = `${d.message} (Não coube na parede: ${edited.skipped.join(', ')}.)`;
      }
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
        moveCursor(p, p.cursor - 1);
        return finishTurn(userMsg, [], [], null, d, true);
      }
      if (d.action === 'redo') {
        if (p.cursor === p.revisions.length - 1)
          return finishTurn(userMsg, [], [], 'Não há alteração para refazer.', d);
        moveCursor(p, p.cursor + 1);
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
        progress({
          stage: 'retrying',
          label: 'Corrigindo o posicionamento',
          detail: `${preview.error} Pedindo uma proposta corrigida.`,
        });
        d = await withFallback(model, (m) => interpretStream(
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
            quoteNote,
          },
          progress,
          0,
          signal,
          text,
          m,
          p.room,
          currentView,
          (u) => recordUsage(u, m),
        ), signal, switchTo);
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
          ...usageField(),
          report: {
            durationMs: Date.now() - started,
            outcome: 'rejected',
            changes: [],
          },
        };
        settleRoom(p);
        p.messages.push(assistant);
        const state = save(p, version);
        version = state.version;
        confirmed.set(requestId, { projectId: p.id, index: p.messages.length - 1 });
        return { ...state, selected: [] };
      }
      if (JSON.stringify(preview.design) === JSON.stringify(before)) {
        return finishTurn(userMsg, d.select, ops, 'O projeto já está nesse estado; nenhuma medida mudou.', d, false, 'unchanged');
      }
      // A conferência só faz sentido em turno com foto: é onde a semelhança
      // com a referência importa. Ela olha o desenho do resultado, pode pedir
      // até 10 operações de correção e uma vez só, sem laço.
      if (image) {
        progress({
          stage: 'reviewing',
          label: 'Conferindo o desenho',
          detail: 'Comparando o resultado com a foto de referência.',
        });
        try {
          const checked = await reviewAndCorrect(
            {
              photo: await imageDataUrl(image.id, jpeg ? 'jpeg' : 'webp'),
              result: await planDataUrl(drawingParts(canonical(preview.design))),
              design: preview.design,
              applied: ops,
              request: b.message,
              model,
              room: p.room,
              signal,
              onUsage: (u) => recordUsage(u, model),
            },
            executeRequest,
          );
          if (checked?.ops.length) {
            preview = { ...preview, design: checked.design };
            ops = [...ops, ...checked.ops];
          }
          if (checked) resultReview = checked.review;
          signal.throwIfAborted();
        } catch (e) {
          // A conferência é um extra: sem ela o turno segue com o resultado que
          // já passou na validação.
          if (signal.aborted) throw e;
        }
      }
      progress({
        stage: 'applying',
        label: 'Aplicando as alterações',
        detail: 'Conferindo o lote e salvando a nova versão.',
      });
      if (image) resultImage = await saveImage(await planPng(drawingParts(canonical(preview.design))), 'resultado.png');
      const discarded = revise(p, preview.design, b.message.slice(0,90));
      return { ...finishTurn(userMsg, d.select, ops, null, d), discarded };

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
        settleRoom(p);
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
          // O desenho que a IA conferiu também fica visível para a pessoa.
          ...(resultImage ? { image: resultImage } : {}),
          ...usageField(),
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
            selected: showcase,
            // O resultado principal da mensagem: o que mudou, em cartões, e o
            // texto próprio da IA depois, sem repetir o resumo do diff.
            ...(appliedOps.length && changes.length
              ? { highlights: describeHighlights(before, after, appliedOps) }
              : {}),
            ...(decision?.message ? { prose: decision.message } : {}),
            ...(resultReview ? { review: resultReview } : {}),
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
        settleRoom(p);
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
          ...usageField(),
          result: { outcome: 'clarification', resultRevisionId: baseRev.id, appliedOperations: [], changes: [] },
          report: {
            durationMs: Date.now() - started,
            outcome: 'clarification',
            changes: [],
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
      trace.write('turn.error', {
        error: e instanceof Error ? e.message : String(e),
        name: e instanceof Error ? e.name : null,
        stack: e instanceof Error ? e.stack : null,
        shown: message,
        clientGone: req.signal.aborted,
        persistedUser,
        usage: turnUsage,
      });
      if (!persistedUser) return undefined;
      if (p.messages.some((m) => m.context?.requestId === requestId && m.result))
        return undefined;
      // O assistente em laço devolve o que dá para diagnosticar: etapas, causa
      // e se algo foi gravado. Sem isso a falha ficava só com o custo.
      const diag = (e as { diagnostics?: TurnDiagnostics } | null)?.diagnostics;
      p.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: '',
        revisionId: p.revisions[p.cursor].id,
        revision: p.revisions[p.cursor].number,
        context: { requestId, baseRevisionId: baseRev.id, selectedPartIds: [], referencedPartIds: [] },
        retry: { message: b.message, ...(image ? { image } : {}) },
        error: message,
        ...(diag
          ? {
              report: {
                durationMs: diag.durationMs,
                outcome: 'rejected' as const,
                changes: [],
                steps: diag.steps,
                ...(diag.plan ? { plan: diag.plan } : {}),
                failure: {
                  requestId: diag.requestId,
                  baseRevisionId: diag.baseRevisionId,
                  cause: diag.cause,
                  message: diag.message,
                  committed: diag.committed,
                  draftChanged: diag.draftChanged,
                  draftOperations: diag.draftOperations,
                  rejected: diag.rejected,
                },
              },
            }
          : {}),
        // Turno que falhou também gastou: o custo entra no total da sessão.
        ...usageField(),
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
        const result = await run((event) => trace.write('progress', event), req.signal);
        trace.write('turn.end', { usage: turnUsage });
        return Response.json(result);
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
            } catch (e) {
              trace.write('stream.write-failed', { event, error: (e as Error).message });
              ended = true;
              cancellation.abort();
            }
          }
        };
        usageListener = (usage) => send('usage', usage);
        const heartbeat = setInterval(
          () => send('heartbeat', { elapsedMs: Date.now() - started }),
          10000,
        );
        try {
          const result = await run(
            (event) => {
              trace.write('progress', event);
              send('progress', event);
            },
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
              // Sinal de vida para a interface, sem conteúdo: quanto já chegou do
              // provedor (inclui o raciocínio privado, que só é contado).
              send('pulse', {
                bytes: preview.bytes ?? 0,
                reasoning: preview.reasoningTotal ?? 0,
                answer: preview.answer.length + preview.approach.length,
                attempt: preview.attempt,
              });
              if (req.headers.get('x-chat-preview') !== 'hidden')
                send('text', preview);
            },
            // Etapas, efeitos e o rascunho ao vivo do assistente em laço.
            (event) => send('agent', event),
          );
          trace.write('turn.end', { usage: turnUsage });
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
      cancel(reason) {
        trace.write('stream.cancel', { reason: String(reason ?? '') });
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
