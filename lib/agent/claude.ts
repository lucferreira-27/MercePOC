import Anthropic from '@anthropic-ai/sdk';
import type { ProviderUsage } from '../models';
import type { ChatMessage, ModelReply, ToolCall, ToolSpec } from './model';

/**
 * Chamada ao Claude pela Messages API nativa, com a mesma forma de entrada e
 * saída do caminho compatível com OpenAI (`callModel`): o laço continua
 * montando mensagens de chat e recebendo `tool_calls`.
 *
 * O Claude exige que a resposta anterior volte intacta (blocos de raciocínio
 * inclusive) quando a conversa segue no mesmo modelo. O laço guarda só texto
 * e `tool_calls`, então a resposta original fica aqui, indexada pelo id da
 * primeira chamada de ferramenta, e volta no lugar da versão resumida.
 */
const replies = new Map<string, Anthropic.ContentBlockParam[]>();

let client: Anthropic | undefined;
function claude(key: string) {
  client ??= new Anthropic({ apiKey: key, maxRetries: 2 });
  return client;
}

function imageBlock(url: string): Anthropic.ImageBlockParam {
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([^]*)$/.exec(url);
  if (m) return { type: 'image', source: { type: 'base64', media_type: m[1] as 'image/png', data: m[2] } };
  return { type: 'image', source: { type: 'url', url } };
}

/** Mensagens de chat para o formato do Claude: sistema à parte, resultados de ferramenta como `tool_result`. */
export function toClaude(messages: ChatMessage[]) {
  const system: string[] = [];
  const out: Anthropic.MessageParam[] = [];
  const push = (role: 'user' | 'assistant', blocks: Anthropic.ContentBlockParam[]) => {
    const prev = out.at(-1);
    if (prev && prev.role === role) (prev.content as Anthropic.ContentBlockParam[]).push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'system') {
      if (!out.length) system.push(m.content);
      else push('user', [{ type: 'text', text: m.content }]);
    } else if (m.role === 'user') {
      if (typeof m.content === 'string') push('user', [{ type: 'text', text: m.content || '…' }]);
      else push('user', m.content.map((p) => (p.type === 'text' ? { type: 'text' as const, text: p.text || '…' } : imageBlock(p.image_url.url))));
    } else if (m.role === 'tool') {
      push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content || '(vazio)' }]);
    } else {
      const saved = m.tool_calls?.length ? replies.get(m.tool_calls[0].id) : undefined;
      if (saved) {
        push('assistant', saved);
        continue;
      }
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.tool_calls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(c.function.arguments || '{}');
        } catch {
          input = {};
        }
        blocks.push({ type: 'tool_use', id: c.id, name: c.function.name, input });
      }
      // Turno sem texto nem chamada (o laço registra e cobra de novo): o Claude não aceita conteúdo vazio.
      push('assistant', blocks.length ? blocks : [{ type: 'text', text: '…' }]);
    }
  }
  return { system: system.join('\n\n'), messages: out };
}

const FINISH: Record<string, string> = { end_turn: 'stop', tool_use: 'tool_calls', max_tokens: 'length', stop_sequence: 'stop', refusal: 'refusal', pause_turn: 'stop' };

export async function callClaude(options: {
  key: string;
  model: string;
  effort?: string;
  maxTokens: number;
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal: AbortSignal;
  onEvent: () => void;
  onUsage?: (usage: ProviderUsage) => void;
  onText?: (text: string) => void;
  onPulse?: (bytes: number, reasoning: number) => void;
}): Promise<ModelReply> {
  const { system, messages } = toClaude(options.messages);
  const effort = options.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined;
  const stream = claude(options.key).messages.stream(
    {
      model: options.model,
      max_tokens: options.maxTokens,
      // Cache automático no último bloco: cada etapa do laço relê a anterior do cache.
      cache_control: { type: 'ephemeral' },
      ...(system ? { system } : {}),
      thinking: { type: 'adaptive' },
      ...(effort ? { output_config: { effort } } : {}),
      tools: options.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
      })),
      tool_choice: { type: 'auto' },
      messages,
    },
    { signal: options.signal },
  );
  let content = '',
    bytes = 0,
    reasoning = 0;
  stream.on('streamEvent', (event) => {
    options.onEvent();
    bytes += JSON.stringify(event).length;
    if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') reasoning += event.delta.thinking.length;
    options.onPulse?.(bytes, reasoning);
  });
  stream.on('text', (delta) => {
    content += delta;
    options.onText?.(content);
  });
  const final = await stream.finalMessage();
  const u = final.usage;
  options.onUsage?.({
    prompt_tokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    prompt_tokens_details: { cached_tokens: u.cache_read_input_tokens ?? 0 },
    cache_creation_tokens: u.cache_creation_input_tokens ?? 0,
    completion_tokens: u.output_tokens,
  });
  const calls: ToolCall[] = final.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } }));
  if (calls.length) replies.set(calls[0].id, final.content as Anthropic.ContentBlockParam[]);
  const thinking = final.content
    .filter((b): b is Anthropic.ThinkingBlock => b.type === 'thinking')
    .map((b) => b.thinking)
    .join('\n');
  const text = final.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return {
    content: (text || content).trim(),
    calls,
    finish: FINISH[final.stop_reason ?? ''] ?? final.stop_reason,
    ...(thinking ? { reasoning: thinking } : {}),
  };
}
