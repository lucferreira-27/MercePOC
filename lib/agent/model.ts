import { AI_FIRST_BYTE_MS, aiCallMs, aiMaxTokens, aiStallMs, aiTimeoutMs, modelKey, profile, type ModelChoice } from '../gateway';
import { effortFor, modelInfo, type Effort, type ProviderUsage } from '../models';
import { readEvents } from '../sse';
import { callClaude } from './claude';

/** Mensagem no formato de chat do provedor (compatível com OpenAI). */
export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ToolSpec = { type: 'function'; function: { name: string; description: string; parameters: unknown } };

/** `reasoning`: o raciocínio privado, para o registro do pedido (lib/trace.ts), nunca para a tela. */
export type ModelReply = { content: string; calls: ToolCall[]; finish: string | null; reasoning?: string };

/**
 * Uma chamada ao modelo com ferramentas nativas, em fluxo.
 *
 * Medido nos quatro modelos do estúdio (DeepSeek, Luna, MiMo pelo gateway e
 * Qwen pela Cerebras): todos devolvem `tool_calls` no formato OpenAI. O fluxo
 * junta os pedaços de cada chamada pelo índice; o texto que vem junto é a
 * fala pública da IA e sai ao vivo em `onText`. O raciocínio privado só é
 * contado, para o sinal de vida da interface.
 *
 * A janela de inatividade é a mesma do caminho antigo: cada evento recebido
 * reinicia o relógio, então uma resposta longa e viva termina e uma conexão
 * muda é encerrada.
 */
export async function callModel(options: {
  model: ModelChoice;
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
  onUsage?: (usage: ProviderUsage) => void;
  onText?: (text: string) => void;
  onPulse?: (bytes: number, reasoning: number) => void;
  /** Esforço escolhido no compositor (baixo, médio, alto). */
  effort?: Effort;
}): Promise<ModelReply> {
  const prof = profile(options.model);
  const info = modelInfo(modelKey(options.model));
  const effort = effortFor(info, options.effort);
  const fast = Boolean(info.fastProfile);
  const idle = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Primeiro byte com folga (o modelo pensa antes); depois do primeiro, um
  // silêncio de aiStallMs já é fluxo parado, e o laço tenta de novo ou troca
  // de modelo em vez de esperar os 120 s do caminho antigo.
  let started = false;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), started ? aiStallMs() : Math.min(aiTimeoutMs(), AI_FIRST_BYTE_MS));
  };
  reset();
  // Fluxo vivo que não termina também é queda: o laço tenta de novo ou troca de modelo.
  const cap = setTimeout(() => idle.abort(), aiCallMs());
  try {
    if (info.vendor === 'Anthropic')
      return await callClaude({
        key: prof.key,
        model: prof.model,
        effort,
        maxTokens: aiMaxTokens(),
        messages: options.messages,
        tools: options.tools,
        signal: AbortSignal.any([idle.signal, ...(options.signal ? [options.signal] : [])]),
        onEvent: () => {
          started = true;
          reset();
        },
        onUsage: options.onUsage,
        onText: options.onText,
        onPulse: options.onPulse,
      });
    const response = await fetch(`${prof.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${prof.key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.any([idle.signal, ...(options.signal ? [options.signal] : [])]),
      body: JSON.stringify({
        model: prof.model,
        ...(effort ? { reasoning_effort: effort } : {}),
        ...(fast ? {} : { stream_options: { include_usage: true } }),
        max_tokens: aiMaxTokens(),
        stream: true,
        tools: options.tools,
        tool_choice: 'auto',
        parallel_tool_calls: true,
        messages: options.messages,
      }),
    });
    if (response.status === 429)
      throw new Error('O provedor de IA retornou 429 (limite temporário). Tente de novo; o projeto foi preservado.');
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `O provedor de IA retornou ${response.status}. ${detail.replaceAll(prof.key, '[credencial]').slice(0, 240)}`.trim(),
      );
    }
    let content = '',
      finish: string | null = null,
      bytes = 0,
      reasoning = 0,
      thinking = '';
    const calls = new Map<number, ToolCall>();
    await readEvents(response, ({ data }) => {
      started = true;
      reset();
      bytes += data.length;
      if (data === '[DONE]') return;
      const event = JSON.parse(data) as {
        error?: unknown;
        usage?: ProviderUsage | null;
        choices?: {
          finish_reason?: string | null;
          delta?: {
            content?: string | null;
            reasoning_content?: string;
            reasoning?: string;
            tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
        }[];
      };
      if (event.error) throw new Error('A conexão com a IA foi interrompida. Tente novamente.');
      if (event.usage) options.onUsage?.(event.usage);
      const choice = event.choices?.[0];
      if (choice?.finish_reason) finish = choice.finish_reason;
      const delta = choice?.delta;
      if (!delta) return;
      const thought = delta.reasoning_content ?? delta.reasoning;
      if (thought) {
        reasoning += thought.length;
        thinking += thought;
      }
      if (delta.content) {
        content += delta.content;
        options.onText?.(content);
      }
      for (const part of delta.tool_calls ?? []) {
        const i = part.index ?? 0;
        const call = calls.get(i) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
        if (part.id) call.id = part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
        calls.set(i, call);
      }
      options.onPulse?.(bytes, reasoning);
    });
    options.signal?.throwIfAborted();
    const list = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([i, c]) => ({ ...c, id: c.id || `call-${i}` }));
    return { content: content.trim(), calls: list, finish, ...(thinking ? { reasoning: thinking } : {}) };
  } finally {
    clearTimeout(timer);
    clearTimeout(cap);
  }
}
