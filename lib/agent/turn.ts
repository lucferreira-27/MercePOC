import { randomUUID } from 'node:crypto';
import { drawingParts } from '../composition';
import { reviewAndCorrect, type CheckedReview, type ModelChoice } from '../gateway';
import { imageDataUrl, saveImage, type ImageRef } from '../images';
import type { ModelKey, ProviderUsage } from '../models';
import { planDataUrl, planPng } from '../plan-render';
import type { Progress, TurnOutcome } from '../progress';
import type { Prices } from '../quote';
import { save, type Clarification, type Message, type Project } from '../store';
import { canonical, describeDesignChanges, describeHighlights, entityIds, executeRequest, type ShelfOp } from '../studio';
import { AgentContext } from './context';
import { runLoop } from './loop';
import type { callModel } from './model';
import { AGENT_SYSTEM, recentMessages, turnMessage } from './prompt';
import { DIRECT, routeRequest, type Route } from './router';
import { checkWork, OPTION_TOOLS, TOOLS, wantQuestions } from './tools';
import { designFacts, factChanges, factClaims, factsLine } from './facts';
import { PROVIDER_ERROR } from '../gateway';
import { askJev } from './jev';
import type { AgentEvent, UiState } from './types';

export type AgentTurnInput = {
  project: Project;
  version: number;
  /** Mensagem do usuário, já gravada no projeto. */
  user: Message;
  request: string;
  selected: string[];
  ui: UiState | null;
  prices: Prices;
  image?: ImageRef;
  model: ModelChoice;
  requestId: string;
  started: number;
  signal: AbortSignal;
  progress: (event: Progress) => void;
  emit: (event: AgentEvent) => void;
  /** Gasto de cada chamada; `model` é quem respondeu (a reserva, se o provedor falhou). */
  onUsage: (usage: ProviderUsage, model?: ModelKey) => void;
  onText?: (text: string) => void;
  onPulse?: (bytes: number, reasoning: number) => void;
  /** Custo do turno, para gravar na resposta. */
  usage: () => Pick<Message, 'usage'>;
  maxSteps?: number;
  call?: typeof callModel;
  /** Troca o roteador (testes); ausente, usa o Jev quando há chave. */
  route?: (request: string) => Promise<Route>;
};

/**
 * Um pedido ao assistente em laço, do rascunho à versão gravada. Devolve o
 * estado do projeto (o que o cliente abre), o índice da resposta para a
 * idempotência do pedido e os efeitos para a interface executar.
 */
export async function runAgentTurn(input: AgentTurnInput) {
  const ctx = new AgentContext(input.project, input.version, input.prices, input.request, input.selected, input.ui, input.emit);
  // Como o projeto estava: uma falha no meio do pedido não pode deixar
  // gravação parcial no objeto que a rota salva junto com o erro.
  const initial = structuredClone({ revisions: input.project.revisions, cursor: input.project.cursor, room: input.project.room, name: input.project.name });
  try {
    return await turnBody(ctx, input);
  } catch (e) {
    const persisted = !!ctx.origin;
    if (!persisted) Object.assign(input.project, initial);
    const error = e instanceof Error ? e : new Error(String(e));
    (error as Error & { diagnostics?: TurnDiagnostics }).diagnostics = {
      requestId: input.requestId,
      baseRevisionId: input.user.context?.baseRevisionId ?? null,
      cause: input.signal.aborted ? 'cancelled' : error.name === 'TimeoutError' ? 'timeout' : PROVIDER_ERROR.test(error.message) ? 'provider' : 'internal',
      message: error.message.slice(0, 300),
      steps: ctx.steps,
      ...(ctx.plan.length ? { plan: ctx.plan } : {}),
      draftChanged: ctx.designChanged || ctx.roomChanged,
      draftOperations: ctx.allOps.length,
      rejected: ctx.attempted.length,
      // Nada deste pedido foi gravado, a não ser o que ele já tinha salvo ao
      // abrir outro projeto (alternativa, projeto novo).
      committed: persisted ? 'persisted-before-failure' : 'none',
      durationMs: Date.now() - input.started,
    };
    throw error;
  }
}

/** O que sobra de um pedido que falhou no meio: vai para a mensagem de erro gravada. */
export type TurnDiagnostics = {
  requestId: string;
  baseRevisionId: string | null;
  cause: 'cancelled' | 'timeout' | 'provider' | 'internal';
  message: string;
  steps: { tool: string; label: string; ok: boolean; detail?: string }[];
  plan?: string[];
  draftChanged: boolean;
  draftOperations: number;
  rejected: number;
  committed: 'none' | 'persisted-before-failure';
  durationMs: number;
};

/**
 * A foto de referência mais nova da conversa recente (a mesma janela que a IA
 * lê como texto), com o pedido que a trouxe. Arquivo que sumiu não trava o
 * pedido: ele segue sem foto, como antes.
 */
async function earlierPhoto(messages: Message[]) {
  const m = recentMessages(messages).findLast((v) => v.role === 'user' && v.image);
  if (!m?.image) return undefined;
  try {
    return { url: await imageDataUrl(m.image.id), request: m.content.replace(/\s+/g, ' ').slice(0, 120) };
  } catch {
    return undefined;
  }
}

async function turnBody(ctx: AgentContext, input: AgentTurnInput) {
  const photo = input.image;
  input.progress({ stage: 'connecting', label: 'Consultando a IA', detail: 'Enviando o pedido e o projeto.' });
  const text = turnMessage(ctx, !!photo, input.request);
  // Pedido sem foto logo depois de um com foto ("esses não estão na ref"):
  // a foto volta, senão a IA responde sem ver o que a pessoa compara.
  const earlier = photo ? undefined : await earlierPhoto(input.project.messages);
  // Projeto de partida (a estante que ninguém pediu e que a foto vai trocar):
  // o desenho dele não ajuda e voltaria em toda etapa do laço. Fica só a foto.
  const images = photo
    ? [
        { type: 'image_url' as const, image_url: { url: await imageDataUrl(photo.id) } },
        ...(ctx.starting ? [] : [{ type: 'image_url' as const, image_url: { url: await planDataUrl(drawingParts(canonical(ctx.design))) } }]),
      ]
    : earlier
      ? [{ type: 'image_url' as const, image_url: { url: earlier.url } }]
      : [];
  const note = photo
    ? `\nImagem 1: foto de referência deste pedido${photo.name ? ` (${photo.name})` : ''}.${ctx.starting ? '' : ' Imagem 2: desenho do projeto ATUAL, antes deste pedido (esquerda frontal, direita isométrica).'}`
    : earlier
      ? `\nImagem 1: foto de referência que a pessoa mandou num pedido anterior da conversa recente ("${earlier.request}"), reenviada para você entender o que ela cita da foto ("a ref", "não está na imagem", "igual à foto"). Ela não vem de novo neste pedido. Para comparar com o móvel de agora, chame render_look. Faça o que este pedido pede; refaça o layout inteiro só se ele pedir.`
      : '';
  // Roteador: pedido só de tela, desfazer ou arquivo sai sem LLM; medida sem
  // eixo vira a pergunta do eixo. Foto sempre vai para o laço.
  const t0 = Date.now();
  const route: Route = photo
    ? { kind: 'agent', intent: 'build', budget: 16 }
    : await (input.route ?? ((r) => routeRequest(r, input.signal)))(input.request);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1).replace('.', ',');
  if (route.kind === 'direct') {
    ctx.steps.push({ tool: 'router', label: `Pedido direto, sem IA (${seconds} s)`, ok: true });
    ctx.direct = true;
    for (const id of route.actions) {
      const a = DIRECT[id];
      const t = TOOLS.find((v) => v.name === a.tool)!;
      const r = await t.run(ctx, t.args.parse(a.args));
      const step = { tool: t.name, label: r.label ?? t.name, ok: r.ok, ...(r.ok ? {} : { detail: r.text }) };
      ctx.steps.push(step);
      ctx.emit({ type: 'step', step, index: ctx.steps.length - 1 });
    }
    const done = ctx.steps.slice(1).filter((v) => v.ok).map((v) => v.label.charAt(0).toLowerCase() + v.label.slice(1));
    const failed = ctx.steps.slice(1).filter((v) => !v.ok).map((v) => v.detail);
    ctx.finish = {
      message: [done.length ? `Pronto: ${done.join(', ')}.` : '', ...failed].filter(Boolean).join(' '),
      suggestions: [],
    };
  } else if (route.kind === 'ask_axis') {
    ctx.steps.push({ tool: 'router', label: `Medida sem eixo: perguntei (${seconds} s)`, ok: true });
    ctx.ask = {
      question: 'Qual medida você quer mudar: largura, altura ou profundidade?',
      options: [
        { id: 'largura', label: 'Largura', partIds: [] },
        { id: 'altura', label: 'Altura', partIds: [] },
        { id: 'profundidade', label: 'Profundidade', partIds: [] },
      ],
    };
  }
  // O que o pedido quer, perguntado já: fica pronto enquanto a IA trabalha
  // e o finish confere sem esperar.
  if (route.kind === 'agent') ctx.wants = askJev({ pedido: input.request }, wantQuestions(), input.signal);
  // Opções: cada variante é um sub-laço curto no mesmo modelo, com as
  // ferramentas de desenho e leitura só.
  ctx.runner = (sub, brief) =>
    runLoop(sub, {
      model: input.model,
      system: AGENT_SYSTEM,
      user: { role: 'user', content: turnMessage(sub, false, brief) },
      tools: OPTION_TOOLS,
      maxSteps: 4,
      maxMs: 60_000,
      signal: input.signal,
      onUsage: input.onUsage,
      call: input.call,
    });
  let working = false;
  /**
   * Como o pedido termina. Completo: a IA chamou finish. Parcial: as etapas
   * ou o tempo acabaram e o rascunho, válido, fica. Desfeito: acabaram com o
   * rascunho inválido (piorou o encaixe, tapou a TV, frente que bate), e ele
   * volta ao começo em vez de virar versão com cara de sucesso.
   */
  let completion = 'complete' as 'complete' | 'partial' | 'rolled-back';
  let rolledBack: string[] = [];
  const settle = () => {
    if (completion !== 'complete') return undefined;
    completion = 'partial';
    if (!ctx.designChanged && !ctx.roomChanged) return 'O móvel não mudou neste pedido.';
    const problems = checkWork(ctx);
    if (problems.length) {
      rolledBack = problems;
      ctx.discard();
      completion = 'rolled-back';
      return `O rascunho tinha problema (${problems.join(' ')}) e o app o descartou: o projeto ficou como estava no começo do pedido. Diga isso, sem afirmar mudanças.`;
    }
    const kept = ctx.navigated || ctx.origin ? [] : describeDesignChanges(ctx.turnStart.design, ctx.design);
    return `O que fica gravado: ${kept.slice(0, 6).join('; ') || 'mudanças no ambiente'}.`;
  };
  const loop = route.kind !== 'agent' ? { steps: 0, exhausted: false } : await runLoop(ctx, {
    model: input.model,
    system: AGENT_SYSTEM,
    user: { role: 'user', content: images.length ? [{ type: 'text', text: text + note }, ...images] : text },
    maxSteps: input.maxSteps ?? route.budget,
    signal: input.signal,
    onUsage: input.onUsage,
    onText: input.onText,
    onPulse: (bytes, reasoning) => {
      if (!working) {
        working = true;
        input.progress({ stage: 'interpreting', label: 'Trabalhando no pedido', detail: 'A IA está usando as ferramentas do estúdio.' });
      }
      input.onPulse?.(bytes, reasoning);
    },
    call: input.call,
    onExhausted: settle,
  });
  if (loop.exhausted && !ctx.ask) settle();

  // Foto: o laço já compara o desenho com a foto (render_look) antes do
  // finish. A conferência de fora, feita para o caminho antigo, corrigia sem
  // esse contexto: nas fotos reais (bench/photo-real.mjs) piorou 4 de 24
  // resultados, melhorou 1, e custava mais uma chamada com duas imagens.
  // MERCE_PHOTO_REVIEW mede as alternativas: fix (corrige), verdict (só o
  // veredito), off (padrão).
  let review: CheckedReview | undefined;
  let resultImage: ImageRef | undefined;
  const reviewMode = process.env.MERCE_PHOTO_REVIEW ?? 'off';
  if (photo && ctx.designChanged && !ctx.ask) {
    if (reviewMode !== 'off') {
      input.progress({ stage: 'reviewing', label: 'Conferindo o desenho', detail: 'Comparando o resultado com a foto de referência.' });
      try {
        const r = await reviewAndCorrect(
          {
            photo: await imageDataUrl(photo.id),
            result: await planDataUrl(drawingParts(canonical(ctx.design))),
            design: ctx.design,
            applied: ctx.allOps,
            request: input.request,
            model: input.model,
            room: ctx.room,
            signal: input.signal,
            onUsage: input.onUsage,
          },
          executeRequest,
        );
        if (r?.ops.length && reviewMode === 'fix') ctx.setDesign(r.design, r.ops);
        if (r) review = r.review;
      } catch (e) {
        if (input.signal.aborted) throw e;
      }
    }
    resultImage = await saveImage(await planPng(drawingParts(canonical(ctx.design))), 'resultado.png');
  }

  input.progress({ stage: 'applying', label: 'Gravando a versão', detail: 'O trabalho do pedido vira uma versão só.' });
  const startDesign = ctx.turnStart.design;
  // Conferência do app no rascunho que vai ficar, em todos os caminhos: sem
  // finish (resposta só em texto, etapas ou tempo esgotados) ela não pode
  // ser pulada. Números da resposta contra o estado final, não a última leitura.
  const finalIssues = ctx.ask ? [] : checkWork(ctx);
  const sameLine = !ctx.navigated && !ctx.origin;
  const factsBefore = sameLine ? designFacts(startDesign, ctx.prices) : null;
  const factsAfter = sameLine ? designFacts(ctx.design, ctx.prices) : null;
  if (ctx.finish && !ctx.checked) {
    const wrong = factsBefore && factsAfter && !ctx.options?.length ? factClaims(ctx.finish.message, factsAfter, factsBefore) : [];
    const notes = [...finalIssues, ...(wrong.length ? [`A resposta ${wrong.join('; ')}. Números do app: ${factsLine(factsAfter!)}.`] : [])];
    if (notes.length) ctx.finish.message = `${ctx.finish.message}\n\nAtenção: ${notes.join(' ')}`;
  }
  const finalEvidence = Object.fromEntries(
    (Object.keys(ctx.evidence) as (keyof typeof ctx.evidence)[]).map((k) => [k, ctx.fresh(k) ? 'fresh' : 'stale']),
  ) as Record<string, 'fresh' | 'stale'>;
  // O que o rascunho mudou, antes de gravar: depois da gravação o rascunho e
  // a versão são iguais e "mudou" viraria falso (a resposta dizia "O móvel
  // não mudou" com quatro módulos novos gravados).
  const draftChanged = ctx.designChanged || ctx.roomChanged;
  const discarded = ctx.ask ? 0 : ctx.commit();
  const p = ctx.project;
  const after = p.revisions[p.cursor].params;
  const changes = sameLine ? describeDesignChanges(startDesign, after) : [`Versão ${p.cursor + 1}: ${p.revisions[p.cursor].label}`];
  const roomMoved = JSON.stringify(ctx.turnStart.room ?? null) !== JSON.stringify(p.room ?? null);
  const ops: ShelfOp[] = sameLine ? ctx.allOps : [];
  const outcome: TurnOutcome = ctx.ask
    ? 'clarification'
    : (sameLine && changes.length) || !sameLine || roomMoved
      ? 'applied'
      : ctx.select?.length
        ? 'highlighted'
        : 'answered';
  const done = loop.exhausted && !ctx.finish && !ctx.ask;
  const message = ctx.ask
    ? ctx.ask.question
    : (ctx.finish?.message ??
      (done
        ? // Sem finish nem na última chamada (provedor lento): a resposta vem
          // do que ficou gravado de verdade, em frases, e diz como continuar.
          [
            'Não terminei tudo no tempo deste pedido.',
            completion === 'rolled-back'
              ? `O rascunho tinha um problema (${rolledBack.join(' ')}): descartei, e o projeto ficou como estava.`
              : draftChanged && changes.length
                ? `Ficou gravado: ${changes.slice(0, 4).map((c) => c.charAt(0).toLowerCase() + c.slice(1)).join('; ')}.`
                : draftChanged
                  ? 'Ficou gravada a mudança no ambiente.'
                  : 'O móvel não mudou.',
            'Peça "continue" para eu seguir de onde parei.',
          ].join(' ')
        : 'Pronto.'));
  const facts = factsBefore && factsAfter && !ctx.ask ? factChanges(factsBefore, factsAfter) : [];
  const clarification: Clarification | undefined = ctx.ask
    ? { id: randomUUID(), question: ctx.ask.question, baseRevisionId: p.revisions[p.cursor].id, options: ctx.ask.options, pendingMessage: input.request }
    : undefined;
  const context = { ...input.user.context!, baseRevisionId: input.user.context?.baseRevisionId ?? p.revisions[p.cursor].id };
  const assistant: Message = {
    id: randomUUID(),
    role: 'assistant',
    content: message,
    revisionId: p.revisions[p.cursor].id,
    revision: p.revisions[p.cursor].number,
    context,
    ...(resultImage ? { image: resultImage } : {}),
    ...input.usage(),
    ...(ctx.finish?.suggestions.length ? { suggestions: ctx.finish.suggestions } : {}),
    ...(clarification ? { clarification } : {}),
    ...(ctx.options?.length ? { options: ctx.options } : {}),
    result: {
      outcome,
      resultRevisionId: p.revisions[p.cursor].id,
      appliedOperations: ops,
      changes,
      ...(ctx.attempted.length ? { attemptedOperations: ctx.attempted.flatMap((a) => a.ops).slice(0, 96) } : {}),
    },
    report: {
      durationMs: Date.now() - input.started,
      outcome,
      changes,
      ...(ops.length && changes.length ? { highlights: describeHighlights(startDesign, after, ops) } : {}),
      prose: message,
      steps: ctx.steps,
      ...(ctx.plan.length ? { plan: ctx.plan } : {}),
      ...(ctx.effects.length ? { effects: ctx.effects } : {}),
      ...(review ? { review } : {}),
      ...(ctx.ask ? {} : { completion }),
      ...(facts.length ? { facts } : {}),
      // Conferência do app no estado gravado (vazio: nada novo de errado).
      ...(ctx.ask ? {} : { checks: { revisionId: p.revisions[p.cursor].id, issues: completion === 'rolled-back' ? [] : finalIssues } }),
      ...(ctx.reverted.length ? { reverted: ctx.reverted.length } : {}),
      // Leituras do pedido e se ainda descrevem o estado gravado (velha:
      // o móvel mudou depois dela). O resumo de chapas e total do cartão é
      // recalculado no estado final, não sai destas leituras.
      ...(Object.keys(finalEvidence).length ? { evidence: finalEvidence } : {}),
      ...(ctx.attempted.length ? { rejected: ctx.attempted.length } : {}),
    },
  };
  if (ctx.origin) {
    // O pedido saiu de um projeto e terminou em outro: o pedido e a resposta
    // vão para o projeto aberto; o de origem ganha um aviso de onde ficou.
    const from = ctx.origin;
    from.project.messages.push({
      id: randomUUID(),
      role: 'assistant',
      content: `Continuei em "${p.name}", que ficou aberto.`,
      revisionId: from.project.revisions[from.project.cursor].id,
      revision: from.project.cursor + 1,
      context: input.user.context,
      result: { outcome: 'applied', resultRevisionId: from.project.revisions[from.project.cursor].id, appliedOperations: [], changes: [] },
    });
    save(from.project, from.version);
    p.messages.push({ ...input.user, id: randomUUID(), revisionId: p.revisions[p.cursor].id, revision: p.cursor + 1 });
  }
  p.messages.push(assistant);
  input.progress({ stage: 'saving', label: 'Salvando o resultado', detail: 'Registrando a versão e preparando o modelo 3D.' });
  const state = save(p, ctx.version);
  const alive = new Set(entityIds(after));
  return {
    projectId: p.id,
    index: p.messages.length - 1,
    state: {
      ...state,
      discarded,
      selected: (ctx.select ?? input.selected).filter((id) => alive.has(id)),
      ...(ctx.fronts ? { viewAction: ctx.fronts } : {}),
      effects: ctx.effects,
    },
  };
}
