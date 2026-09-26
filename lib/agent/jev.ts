/**
 * Jev (TypeSafe), modelo "System One": recebe um estado em texto e perguntas
 * tipadas (escolha, nota, sim/não) e devolve respostas com probabilidade e
 * confiança em ~0,7 s. Não gera texto nem números: aqui ele só decide rápido
 * (qual caminho, se pergunta, se a resposta bate com o que foi feito).
 *
 * Medido com pedidos em português: acerta quando cada pedido vai num estado
 * próprio; perguntas que apontam para "o item i" de uma lista erram com
 * confiança alta. Por isso cada chamada leva UM pedido.
 *
 * Sem chave, com erro ou com demora, devolve null e o assistente segue só
 * com o LLM: Jev acelera e confere, nunca é obrigatório.
 */
export type JevQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: 'score'; instructions: string; criteria: string[] };
export type JevAnswer =
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'noul'; noul: number }
  | { type: 'score'; score: number; confidence: number };

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const TIMEOUT_MS = 2500;

export function jevAvailable() {
  return Boolean(process.env.TYPESAFE_API_KEY) && process.env.MERCE_JEV !== '0';
}

export async function askJev<Q extends Record<string, JevQuestion>>(
  state: unknown,
  questions: Q,
  signal?: AbortSignal,
): Promise<{ [K in keyof Q]: JevAnswer } | null> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key || process.env.MERCE_JEV === '0') return null;
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(signal ? [signal] : [])]),
      body: JSON.stringify({ model: process.env.MERCE_JEV_MODEL || 'jev-latest', state, questions }),
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { answers?: Record<string, JevAnswer> };
    return (body.answers as { [K in keyof Q]: JevAnswer }) ?? null;
  } catch {
    return null;
  }
}

export const choiceOf = (a: JevAnswer | undefined) => (a?.type === 'choice' ? a : null);
export const noulOf = (a: JevAnswer | undefined) => (a?.type === 'noul' ? a.noul : null);
