import { z } from 'zod';
import { validationMessage } from '../composition';
import type { ModelChoice } from '../gateway';
import type { ProviderUsage } from '../models';
import type { AgentContext } from './context';
import { callModel, type ChatMessage, type ModelReply, type ToolSpec } from './model';
import { TERMINAL, TOOLS } from './tools';

/** Tipos de operação do contrato: chamados como ferramenta, viram um design_apply. */
const OP_KINDS = /^(asset\.add|module\.(add|edit|duplicate|remove)|connect|disconnect|cell\.(split|move|merge|distribute)|front\.set|drawer\.height)$/;
/** Falha passageira do provedor: vale uma nova tentativa da etapa. */
const TRANSIENT = /interrompida|429|502|503|504|fetch failed|ECONNRESET|ETIMEDOUT|socket|terminated/i;
/** Passos a mais quando a IA anuncia um plano (trabalho grande). */
const PLAN_BONUS = 8;
/** Tempo máximo do laço antes do finish forçado: a espera não passa disto mesmo com a IA andando em círculos. */
const MAX_MS = 150_000;
import type { Tool } from './types';

/** Resultado que volta para a IA: curto o bastante para não afogar o contexto. */
const RESULT_CAP = 3000;

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
  onUsage?: (usage: ProviderUsage) => void;
  onText?: (text: string) => void;
  onPulse?: (bytes: number, reasoning: number) => void;
  /** Troca o provedor (testes e benchmark gravado). */
  call?: typeof callModel;
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
  const until = Date.now() + (o.maxMs ?? MAX_MS);
  let nudged = false,
    bonus = false;
  for (let step = 0; step < maxSteps; step++) {
    o.signal?.throwIfAborted();
    if (Date.now() >= until) break;
    const ask = () =>
      call({
        model: o.model,
        messages,
        tools: specs,
        signal: o.signal,
        onUsage: o.onUsage,
        onText: o.onText,
        onPulse: o.onPulse,
      });
    let reply: ModelReply;
    try {
      reply = await ask();
    } catch (e) {
      // Queda do fluxo ou limite do provedor: uma nova tentativa da mesma
      // etapa, como o caminho antigo faz. O rascunho não mudou.
      if (o.signal?.aborted || !TRANSIENT.test((e as Error).message)) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      reply = await ask();
    }
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
    }
  }
  // Limite de etapas: uma última chamada só com finish, para a resposta
  // contar o que ficou pronto e o que faltou, em vez de um resumo seco.
  const last = byName.get('finish');
  if (last && !ctx.finish && !ctx.ask) {
    messages.push({ role: 'user', content: 'Limite de etapas ou de tempo deste pedido atingido. Chame finish agora: diga o que ficou pronto e o que faltou, sem prometer o que não foi feito.' });
    try {
      const reply = await call({ model: o.model, messages, tools: toolSpecs([last]), signal: o.signal, onUsage: o.onUsage });
      const c = reply.calls.find((v) => v.function.name === 'finish');
      const parsed = c ? last.args.safeParse(JSON.parse(c.function.arguments || '{}')) : null;
      if (parsed?.success) {
        ctx.repairs = 2;
        await last.run(ctx, parsed.data);
      } else if (reply.content) ctx.finish = { message: reply.content, suggestions: [] };
    } catch (e) {
      if (o.signal?.aborted) throw e;
    }
  }
  return { steps: maxSteps, exhausted: true };
}
