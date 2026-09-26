import { z } from 'zod';
import { validationMessage } from '../composition';
import { modelKey, type ModelChoice } from '../gateway';
import { fallbackModel, modelInfo, type ModelKey, type ProviderUsage } from '../models';
import type { AgentContext } from './context';
import { callModel, type ChatMessage, type ModelReply, type ToolSpec } from './model';
import { TERMINAL, TOOLS } from './tools';

/** Tipos de operação do contrato: chamados como ferramenta, viram um design_apply. */
const OP_KINDS = /^(asset\.add|module\.(add|edit|duplicate|remove)|connect|disconnect|cell\.(split|move|merge|distribute)|front\.set|drawer\.height)$/;
/**
 * Esperas entre tentativas da mesma etapa (ms). A partir da segunda falha
 * seguida, a tentativa vai para o modelo de reserva (`fallbackModel`), que
 * fica até o fim do turno: o provedor que parou duas vezes costuma parar de novo.
 */
export const RETRY_WAITS = [2000, 6000];
/**
 * Falha passageira do provedor: vale uma nova tentativa da etapa. "operation
 * was aborted" sem o sinal do pedido abortado é o fluxo parado até o tempo de
 * ociosidade (model.ts).
 */
const TRANSIENT = /interrompida|429|502|503|504|fetch failed|ECONNRESET|ETIMEDOUT|socket|terminated|operation was aborted/i;
/** Passos a mais quando a IA anuncia um plano (trabalho grande). */
const PLAN_BONUS = 8;
/**
 * Tempo a mais junto com os passos: com chamadas de 20 a 70 s (Command Code
 * lento), 150 s cabiam 4 chamadas, e parede + duas fileiras + finish são 5 ou 6.
 */
const PLAN_BONUS_MS = 90_000;
/**
 * Tempo máximo do laço antes do finish forçado. Corta também a chamada em
 * curso: uma chamada lenta do provedor (já vimos 160 s numa só) não segura
 * o pedido além disto.
 */
const MAX_MS = 150_000;
/** Teto da última chamada, a que só diz o que ficou pronto. */
const FINISH_MS = 45_000;
import type { Tool } from './types';

/** Resultado que volta para a IA: curto o bastante para não afogar o contexto. */
const RESULT_CAP = 3000;

/** Corta a mensagem na última frase que cabe em `max` caracteres. */
export function fitMessage(text: string, max = 700) {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > max / 3 ? cut.slice(0, end + 1) : `${cut.slice(0, max - 1).trimEnd()}…`;
}

export function toolSpecs(tools: readonly Tool[] = TOOLS): ToolSpec[] {
  return tools.map((t) => {
    const schema = z.toJSONSchema(t.args) as Record<string, unknown>;
    delete schema.$schema;
    return { type: 'function', function: { name: t.name, description: t.description, parameters: schema } };
  });
}

export type LoopOptions = {
  model: ModelChoice;
  system: string;
  user: ChatMessage;
  tools?: readonly Tool[];
  /** Chamadas ao modelo no pedido, incluindo as de correção. */
  maxSteps?: number;
  /** Tempo do laço (ms); passou, a próxima chamada é só o finish. */
  maxMs?: number;
  signal?: AbortSignal;
  /** Gasto de cada chamada, com o modelo que respondeu (a reserva tem outro preço). */
  onUsage?: (usage: ProviderUsage, model: ModelKey) => void;
  onText?: (text: string) => void;
  onPulse?: (bytes: number, reasoning: number) => void;
  /** Troca o provedor (testes e benchmark gravado). */
  call?: typeof callModel;
  /**
   * Chamado quando as etapas ou o tempo acabam sem finish, antes da última
   * chamada: o turno decide o que fica (rascunho válido) ou volta (inválido)
   * e devolve a frase que a IA precisa saber para não descrever outra coisa.
   */
  onExhausted?: () => string | undefined;
};

/**
 * O laço do assistente: a IA pede ferramentas, o app executa em ordem e
 * devolve os resultados, até `finish` ou `ask_user`. Cada resultado traz ids
 * e medidas reais, então a IA monta, confere e corrige no mesmo pedido.
 *
 * Uma chamada que falha (argumento inválido, validação do desenho, erro da
 * ferramenta) não derruba o pedido: o erro volta como resultado e as chamadas
 * seguintes do mesmo lote são puladas, porque dependiam dela.
 */
export async function runLoop(ctx: AgentContext, o: LoopOptions) {
  const tools = o.tools ?? TOOLS;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const specs = toolSpecs(tools);
  const call = o.call ?? callModel;
  const messages: ChatMessage[] = [{ role: 'system', content: o.system }, o.user];
  let maxSteps = o.maxSteps ?? 12;
  let until = Date.now() + (o.maxMs ?? MAX_MS);
  let nudged = false,
    bonus = false;
  let model = o.model;
  const usage = (u: ProviderUsage) => o.onUsage?.(u, modelKey(model));
  // O prazo do laço vira sinal: quando acaba, a chamada em curso é cortada.
  // Relógio próprio (e não AbortSignal.timeout) porque o plano estende o prazo.
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stop.abort(), Math.max(1, until - Date.now()));
  };
  arm();
  const deadline = stop.signal;
  const signal = o.signal ? AbortSignal.any([o.signal, deadline]) : deadline;
  let timedOut = false;
  try {
    for (let step = 0; step < maxSteps; step++) {
      o.signal?.throwIfAborted();
      if (Date.now() >= until) break;
      const ask = () =>
        call({
          model,
          messages,
          tools: specs,
          signal,
          onUsage: usage,
          onText: o.onText,
          onPulse: o.onPulse,
        });
      let reply: ModelReply | undefined;
      // Queda do fluxo, limite ou provedor fora do ar por instantes: a mesma
      // etapa de novo, com espera crescente. O rascunho não mudou.
      for (const [i, wait] of [...RETRY_WAITS, -1].entries()) {
        try {
          reply = await ask();
          break;
        } catch (e) {
          o.signal?.throwIfAborted();
          // Prazo do laço: sem nova tentativa, vai direto para o finish forçado.
          if (deadline.aborted) {
            timedOut = true;
            break;
          }
          if (wait < 0 || !TRANSIENT.test((e as Error).message)) throw e;
          const alt = i >= 1 ? fallbackModel(modelKey(model)) : null;
          if (alt) {
            model = alt;
            const entry = { tool: 'fallback', label: `Troquei para ${modelInfo(alt).label}: o provedor falhou duas vezes`, ok: true };
            ctx.steps.push(entry);
            ctx.emit({ type: 'step', step: entry, index: ctx.steps.length - 1 });
          }
          await new Promise((r) => setTimeout(r, wait));
        }
      }
      if (timedOut) break;
      if (!reply) throw new Error('Sem resposta do provedor.');
      if (reply.content) ctx.emit({ type: 'say', text: reply.content });
      if (!reply.calls.length) {
        // Sem ferramenta: texto puro vale como resposta final; vazio, um lembrete.
        if (reply.content) {
          ctx.finish = { message: reply.content, suggestions: [] };
          return { steps: step + 1 };
        }
        if (nudged) break;
        nudged = true;
        messages.push({ role: 'assistant', content: '' });
        messages.push({
          role: 'user',
          // Resposta cortada pelo tamanho: a IA gastou tudo pensando (foto).
          content:
            reply.finish === 'length'
              ? 'Sua resposta anterior acabou o espaço antes de chamar qualquer ferramenta. Não resolva tudo de cabeça: chame agora as ferramentas do primeiro passo (plan, room_set, row_build ou design_apply) e siga por partes, conferindo os resultados.'
              : 'Use as ferramentas para cumprir o pedido e termine com finish.',
        });
        continue;
      }
      messages.push({ role: 'assistant', content: reply.content || null, tool_calls: reply.calls });
      let broken = false;
      const images: string[] = [];
      for (const c of reply.calls) {
        if (broken || ctx.finish || ctx.ask) {
          messages.push({ role: 'tool', tool_call_id: c.id, content: 'Pulado: uma chamada anterior deste lote falhou ou o pedido já terminou.' });
          continue;
        }
        // Modelo barato às vezes chama a operação ("asset.add") como se fosse a
        // ferramenta: vira o design_apply que ela quis dizer.
        if (!byName.has(c.function.name) && OP_KINDS.test(c.function.name) && byName.has('design_apply')) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(c.function.arguments || '{}') as Record<string, unknown>;
          } catch {}
          c.function.arguments = JSON.stringify({ ops: [{ kind: c.function.name, ...args }] });
          c.function.name = 'design_apply';
        }
        const t = byName.get(c.function.name);
        let text: string, okCall: boolean, label: string;
        if (!t) {
          okCall = false;
          text = `Ferramenta desconhecida: ${c.function.name}.`;
          label = 'Chamada inválida';
        } else {
          let raw: unknown;
          try {
            raw = c.function.arguments.trim() ? JSON.parse(c.function.arguments) : {};
          } catch {
            raw = undefined;
          }
          const parsed = raw === undefined ? null : t.args.safeParse(raw);
          if (!parsed?.success) {
            okCall = false;
            text = `Argumentos inválidos para ${t.name}: ${parsed ? validationMessage(parsed.error as z.ZodError) : 'não é JSON'}.`;
            label = 'Corrigindo uma chamada';
          } else {
            const index = ctx.steps.length;
            ctx.emit({ type: 'running', tool: t.name, label: t.running?.(parsed.data) ?? 'Trabalhando', index });
            try {
              const r = await t.run(ctx, parsed.data);
              if (r.image) images.push(r.image);
              okCall = r.ok;
              text = r.text;
              label = r.label ?? t.name;
            } catch (e) {
              okCall = false;
              text = `Erro: ${(e as Error).message}`;
              label = 'Uma etapa falhou';
            }
          }
        }
        const entry = { tool: c.function.name, label, ok: okCall, ...(okCall ? {} : { detail: text.slice(0, 300) }) };
        ctx.steps.push(entry);
        ctx.emit({ type: 'step', step: entry, index: ctx.steps.length - 1 });
        messages.push({ role: 'tool', tool_call_id: c.id, content: text.length > RESULT_CAP ? `${text.slice(0, RESULT_CAP)}…` : text });
        if (!okCall && !TERMINAL.has(c.function.name)) broken = true;
      }
      // Resultado de ferramenta é texto: a imagem pedida (render_look) vem
      // numa mensagem da pessoa logo depois, como a foto de referência.
      if (images.length && !ctx.finish && !ctx.ask)
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: 'Desenho do rascunho agora (esquerda frontal, direita isométrica), pedido por render_look.' },
            ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
          ],
        });
      if (ctx.finish || ctx.ask) return { steps: step + 1 };
      if (ctx.plan.length && !bonus) {
        bonus = true;
        maxSteps += PLAN_BONUS;
        until += PLAN_BONUS_MS;
        arm();
      }
    }
  } finally {
    clearTimeout(timer);
  }
  // Limite de etapas: uma última chamada só com finish, para a resposta
  // contar o que ficou pronto e o que faltou, em vez de um resumo seco.
  const last = byName.get('finish');
  const settled = !ctx.finish && !ctx.ask ? o.onExhausted?.() : undefined;
  if (last && !ctx.finish && !ctx.ask) {
    messages.push({
      role: 'user',
      content: `Limite de etapas ou de tempo deste pedido atingido. ${settled ? `${settled} ` : ''}Chame finish agora: diga o que ficou pronto e o que faltou, sem prometer o que não foi feito.`,
    });
    try {
      const cap = AbortSignal.timeout(FINISH_MS);
      const reply = await call({ model, messages, tools: toolSpecs([last]), signal: o.signal ? AbortSignal.any([o.signal, cap]) : cap, onUsage: usage });
      const c = reply.calls.find((v) => v.function.name === 'finish');
      // Aqui não há outra chance: resposta longa demais é aparada na última
      // frase que cabe, em vez de cair no resumo automático das etapas.
      const args = c ? (JSON.parse(c.function.arguments || '{}') as { mensagem?: unknown }) : null;
      if (args && typeof args.mensagem === 'string') args.mensagem = fitMessage(args.mensagem);
      const parsed = args ? last.args.safeParse(args) : null;
      if (parsed?.success) {
        ctx.repairs = 2;
        await last.run(ctx, parsed.data);
      } else if (reply.content) ctx.finish = { message: reply.content, suggestions: [] };
    } catch (e) {
      if (o.signal?.aborted) throw e;
    }
  }
  return { steps: maxSteps, exhausted: true, timedOut };
}
