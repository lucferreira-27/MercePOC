/**
 * Modelos que o estúdio pode usar, com o preço de tabela de cada um.
 *
 * O gateway devolve tokens (entrada, saída, raciocínio, cache), mas não o
 * preço. O custo do turno é calculado aqui, com a tabela abaixo, e por isso é
 * uma estimativa: quem tem o preço contratado ajusta em `.env` com
 * `MERCE_PRICE_<CHAVE>=entrada,saída,entrada-em-cache` (dólares por milhão de
 * tokens), por exemplo `MERCE_PRICE_LUNA=0.1,0.5,0.01`.
 *
 * Este arquivo não lê segredo nenhum: o cliente importa a lista para o seletor
 * de modelo e a conta do custo; chaves e URLs ficam em `modelProfile`, que só
 * roda no servidor.
 */
export type ModelKey = 'deepseek' | 'luna' | 'mimo' | 'qwen-fast' | 'haiku';
export const MODEL_KEYS = ['deepseek', 'luna', 'mimo', 'qwen-fast', 'haiku'] as const;
/**
 * Modelo de sessão nova e de pedido sem modelo: Claude Haiku 5.5 com esforço
 * baixo. No bench (07/10/2026) acertou 92/107 contra 96/107 da Luna, com
 * latência média de 9 s contra 36 s; o serviço da Luna foi encerrado. A
 * escolha explícita da pessoa continua valendo (ver app/page.tsx).
 */
export const DEFAULT_MODEL: ModelKey = 'haiku';

export type ModelPrice = {
  /** US$ por milhão de tokens de entrada. */
  input: number;
  /** US$ por milhão de tokens de saída (inclui o raciocínio). */
  output: number;
  /** US$ por milhão de tokens de entrada lidos do cache. */
  cachedInput: number;
};
export type ModelInfo = {
  key: ModelKey;
  label: string;
  /** Uma linha para o seletor: para que serve. */
  blurb: string;
  vendor: string;
  /** Esforço de raciocínio pedido ao provedor; ausente quando não se aplica. */
  reasoning?: 'low' | 'medium' | 'high';
  /**
   * Modelo que assume o resto do turno quando este falha duas vezes seguidas
   * por erro do provedor (fluxo parado, 5xx, limite). Ver `fallbackModel`.
   */
  fallback?: ModelKey;
  /** Provedor alternativo (AI_FAST_*), com prompt mais diretivo. */
  fastProfile?: boolean;
  price: ModelPrice;
};

export const MODELS: ModelInfo[] = [
  {
    key: 'haiku',
    label: 'Claude Haiku 5.5',
    blurb: 'Padrão do estúdio: rápido, pela API da Anthropic',
    vendor: 'Anthropic',
    // Medido no corpus inteiro: low 97/112 e medium 96/112, low mais rápido
    // (8,8 s contra 11 s de média) e mais barato.
    reasoning: 'low',
    // Tabela de prompts até 100 mil tokens (escrita no cache 0,125). Acima
    // disso a chamada inteira custa 5× (0,5 / 2,5 / 0,05); o laço fica abaixo
    // (maior chamada medida: ~83 mil).
    price: { input: 0.1, output: 0.5, cachedInput: 0.01 },
  },
  {
    key: 'luna',
    label: 'GPT-6 Luna',
    blurb: 'Cuidadoso em composições e pedidos longos',
    vendor: 'Command Code',
    // Medido nos casos difíceis: low acerta 4/10, high 9/10. Pergunta demais
    // sem o portão do perguntar (lib/agent/ask-gate.ts).
    reasoning: 'high',
    price: { input: 0.1, output: 0.5, cachedInput: 0.01 },
  },
  {
    key: 'deepseek',
    label: 'DeepSeek V4.1 Flash',
    blurb: 'Mais barato por token, porém mais lento; a Luna assume se o provedor falhar',
    vendor: 'Command Code',
    // No Command Code, low, medium e high acertam igual (o proxy sempre
    // raciocina); xhigh e max custam 3× e estouram o tempo do laço.
    reasoning: 'low',
    fallback: 'luna',
    price: { input: 0.14, output: 0.56, cachedInput: 0.014 },
  },
  {
    key: 'mimo',
    label: 'MiMo V2.6 Flash',
    blurb: 'Xiaomi: saída barata e cache quase de graça',
    vendor: 'Command Code',
    reasoning: 'low',
    price: { input: 0.14, output: 0.28, cachedInput: 0.0028 },
  },
  {
    key: 'qwen-fast',
    label: 'Qwen 3.8 27B',
    blurb: 'Modo rápido via Cerebras, para ajustes simples',
    vendor: 'Cerebras',
    fastProfile: true,
    price: { input: 0.6, output: 1.2, cachedInput: 0.6 },
  },
];

/**
 * Esforço de raciocínio enviado ao provedor. MERCE_REASONING_EFFORT troca o
 * do modelo (ex.: "none" no OpenCode Zen, que desliga o raciocínio e mantém
 * a visão; o Command Code só aceita de "low" para cima).
 */
export function reasoningEffort(info: ModelInfo): string | undefined {
  return process.env.MERCE_REASONING_EFFORT || info.reasoning;
}
/** Nome do esforço para a interface ("raciocínio alto"). */
export function reasoningLabel(info: ModelInfo) {
  return info.reasoning ? `raciocínio ${info.reasoning === 'high' ? 'alto' : info.reasoning === 'medium' ? 'médio' : 'baixo'}` : null;
}
/**
 * Reserva do modelo quando o provedor falha. MERCE_FALLBACK_MODEL troca a da
 * tabela; "none" desliga.
 */
export function fallbackModel(key: ModelKey): ModelKey | null {
  const env = process.env.MERCE_FALLBACK_MODEL;
  if (env === 'none') return null;
  const alt = (env && (MODEL_KEYS as readonly string[]).includes(env) ? env : modelInfo(key).fallback) as ModelKey | undefined;
  return alt && alt !== key ? alt : null;
}
export function modelInfo(key: string | undefined): ModelInfo {
  return MODELS.find((m) => m.key === key) ?? MODELS.find((m) => m.key === DEFAULT_MODEL)!;
}

/** Preço efetivo: a tabela, ou o que o `.env` do servidor disser. */
export function priceOf(key: ModelKey, env: Record<string, string | undefined> = {}): ModelPrice {
  const base = modelInfo(key).price;
  const raw = env[`MERCE_PRICE_${key.replace('-', '_').toUpperCase()}`];
  if (!raw) return base;
  const [input, output, cachedInput] = raw.split(',').map((v) => Number(v.trim()));
  const ok = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && v >= 0;
  return {
    input: ok(input) ? input : base.input,
    output: ok(output) ? output : base.output,
    cachedInput: ok(cachedInput) ? cachedInput : ok(input) ? input : base.cachedInput,
  };
}

/** O `usage` que o provedor manda no fim de cada chamada. */
export type ProviderUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  /** Escrita no cache (Claude): já contada em prompt_tokens, paga 1,25× a entrada. */
  cache_creation_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
};

/** Gasto de um turno: todas as chamadas ao provedor que ele fez. */
export type TurnUsage = {
  model: ModelKey;
  calls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
};

export function emptyUsage(model: ModelKey): TurnUsage {
  return { model, calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 };
}

/** Soma uma chamada ao turno. Tokens em cache pagam o preço de cache. */
export function addUsage(total: TurnUsage, usage: ProviderUsage, price: ModelPrice): TurnUsage {
  const input = usage.prompt_tokens ?? 0;
  const cached = Math.min(input, usage.prompt_tokens_details?.cached_tokens ?? 0);
  const output = usage.completion_tokens ?? 0;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? 0;
  const cost =
    ((input - cached) * price.input + (usage.cache_creation_tokens ?? 0) * price.input * 0.25 + cached * price.cachedInput + output * price.output) / 1_000_000;
  return {
    ...total,
    calls: total.calls + 1,
    inputTokens: total.inputTokens + input,
    cachedTokens: total.cachedTokens + cached,
    outputTokens: total.outputTokens + output,
    reasoningTokens: total.reasoningTokens + reasoning,
    costUsd: total.costUsd + cost,
  };
}

/** Soma de vários turnos, agrupada por modelo, para o painel de custos. */
export function sumUsage(list: readonly (TurnUsage | undefined)[]) {
  const byModel = new Map<ModelKey, TurnUsage>();
  let costUsd = 0,
    tokens = 0,
    turns = 0;
  for (const u of list) {
    if (!u) continue;
    turns++;
    costUsd += u.costUsd;
    tokens += u.inputTokens + u.outputTokens;
    const cur = byModel.get(u.model) ?? emptyUsage(u.model);
    byModel.set(u.model, {
      ...cur,
      calls: cur.calls + u.calls,
      inputTokens: cur.inputTokens + u.inputTokens,
      cachedTokens: cur.cachedTokens + u.cachedTokens,
      outputTokens: cur.outputTokens + u.outputTokens,
      reasoningTokens: cur.reasoningTokens + u.reasoningTokens,
      costUsd: cur.costUsd + u.costUsd,
    });
  }
  return { costUsd, tokens, turns, byModel: [...byModel.values()] };
}

/** Tokens e custo de uma fatia do gasto (entrada nova, cache ou saída). */
export type UsageSlice = { tokens: number; costUsd: number };
export type UsageBreakdown = {
  /** Entrada lida pela primeira vez: preço cheio. */
  fresh: UsageSlice;
  /** Entrada que o provedor reaproveitou do cache: preço de cache. */
  cached: UsageSlice;
  output: UsageSlice;
  /** Fração da entrada que veio do cache (0 a 1). */
  hitRate: number;
  /** Quanto a entrada custaria a mais sem o cache. */
  savedUsd: number;
};

/**
 * Separa o custo gravado em entrada nova, cache e saída. As fatias saem da
 * tabela de preços do modelo e são escaladas para somar o custo gravado: um
 * preço trocado por variável de ambiente no servidor continua batendo.
 */
export function usageBreakdown(list: readonly (TurnUsage | undefined)[]): UsageBreakdown {
  const out: UsageBreakdown = {
    fresh: { tokens: 0, costUsd: 0 },
    cached: { tokens: 0, costUsd: 0 },
    output: { tokens: 0, costUsd: 0 },
    hitRate: 0,
    savedUsd: 0,
  };
  let input = 0;
  for (const u of list) {
    if (!u) continue;
    const price = modelInfo(u.model).price;
    const cached = Math.min(u.cachedTokens, u.inputTokens);
    const fresh = u.inputTokens - cached;
    const raw = [fresh * price.input, cached * price.cachedInput, u.outputTokens * price.output].map((v) => v / 1_000_000);
    const sum = raw[0] + raw[1] + raw[2];
    const k = sum > 0 ? u.costUsd / sum : 0;
    out.fresh.tokens += fresh;
    out.fresh.costUsd += raw[0] * k;
    out.cached.tokens += cached;
    out.cached.costUsd += raw[1] * k;
    out.output.tokens += u.outputTokens;
    out.output.costUsd += raw[2] * k;
    out.savedUsd += ((cached * Math.max(0, price.input - price.cachedInput)) / 1_000_000) * k;
    input += u.inputTokens;
  }
  out.hitRate = input > 0 ? out.cached.tokens / input : 0;
  return out;
}

/** "82%" para a fração de cache. */
export function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

/**
 * Dólares com a precisão que um turno pede: centavos somem em turnos de
 * fração de centavo, então abaixo de US$ 0,01 aparecem quatro casas.
 */
export function usd(value: number) {
  const digits = value > 0 && value < 0.01 ? 4 : value < 1 ? 3 : 2;
  return `US$ ${value.toFixed(digits).replace('.', ',')}`;
}

/** "1,2 mil" em vez de 1234: contagem de tokens para gente, não para máquina. */
export function tokensLabel(n: number) {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace('.', ',')} mil`;
  return `${(n / 1_000_000).toFixed(1).replace('.', ',')} mi`;
}
