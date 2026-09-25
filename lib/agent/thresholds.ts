/**
 * Limiares do roteador. Calibrados com o conjunto de
 * pedidos reais em `bench/router-cases.mjs`: ao mudar um número aqui, rode
 * `npm run bench:router` e compare a taxa de acerto e de atalho errado.
 */
export const ROUTE = {
  /** Confiança mínima na intenção para atalhar. */
  intentConfidence: 0.85,
  /** Qualquer porta de saída (muda o móvel, config, pergunta, alvo) acima disto: vai para o laço. */
  otherMax: 0.3,
  /** "Pede para criar um móvel" acima disto: vai para o laço. */
  createMin: 0.6,
  /** Probabilidade mínima de cada ação direta para executar. */
  actionMin: 0.8,
  /** "Várias ações" acima disto com uma só ação escolhida: vai para o laço. */
  multiMin: 0.6,
  /** Mais ações diretas que isto num pedido: melhor o laço conferir. */
  maxDirect: 4,
  /** Medida sem eixo acima disto: pergunta o eixo antes de chamar o LLM. */
  vagueMin: 0.7,
  /** Chamadas ao modelo por intenção (o plano ainda soma um bônus). */
  budget: { default: 12, build: 16, options: 16, edit: 12, ask: 6, view: 8, studio: 8 } as Record<string, number>,
};
