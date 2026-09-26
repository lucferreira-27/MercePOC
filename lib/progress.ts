export type Progress = {
  stage:
    | 'connecting'
    | 'interpreting'
    | 'proposing'
    | 'retrying'
    | 'validating'
    | 'applying'
    | 'reviewing'
    | 'saving';
  label: string;
  detail: string;
  attempt?: number;
};
/**
 * O que mudou no projeto, em linguagem de quem desenha móvel: é o conteúdo
 * principal da resposta, não o log da execução. Medidas e fatos vêm do desenho
 * depois de aplicar, nunca do texto da IA.
 */
export type ChangeHighlight = {
  tool: string;
  title: string;
  summary: string;
  /** + entrou, − saiu, ~ mudou. Ausente em mensagem antiga: vem da ferramenta. */
  sign?: '+' | '-' | '~';
  /** Índices, no lote aplicado, das operações que esta linha conta. */
  ops?: number[];
  /** Módulos, compartimentos ou peças que a linha destaca na cena. */
  targets?: string[];
  /** Dimensões externas em mm, quando a mudança tem tamanho (desenha a peça). */
  size?: [number, number, number];
  measures?: { label: string; value: string }[];
  facts?: { label: string; value: string }[];
  /**
   * Várias mudanças do mesmo tipo no mesmo lote: uma linha por alvo. `parts`
   * são as medidas que a linha produziu, na ordem, para o desenho proporcional
   * deixar claro que cada alvo saiu diferente.
   */
  rows?: ChangeRow[];
};
export type ChangeRow = {
  label: string;
  value: string;
  parts?: number[];
};
export type SelectedPart = {
  id: string;
  name: string;
  dims: string;
  material: string;
  size?: [number, number, number];
  color?: string;
};
export type TurnOutcome =
  | 'applied'
  | 'clarification'
  | 'answered'
  | 'highlighted'
  | 'unchanged'
  | 'rejected';
export type ChatReport = {
  durationMs: number;
  outcome: TurnOutcome;
  changes: string[];
  /** O que mudou, em cartões: o conteúdo principal da mensagem. */
  highlights?: ChangeHighlight[];
  /**
   * O que a IA viu no próprio desenho depois de aplicar, comparando com a foto
   * de referência. Fica separado do texto do turno: um é a proposta, o outro é
   * a conferência.
   */
  review?: {
    fidelity: 'parecido' | 'parcial' | 'diferente';
    verdict: string;
    /** Operações de correção que a conferência pediu, já aplicadas. */
    corrections: number;
  };
  /** Texto próprio da IA, para a interface não repetir o resumo do diff. */
  prose?: string;
  /** Ferramentas que o assistente usou no pedido, na ordem, como a conversa conta. */
  steps?: { tool: string; label: string; ok: boolean; detail?: string }[];
  /** Plano anunciado para um trabalho grande. */
  plan?: string[];
  /** Efeitos na interface (vista, aba, preços, arquivos) que o pedido pediu. */
  effects?: { type: string }[];
  selected?: SelectedPart[];
  /**
   * Como o pedido terminou, separado do que mudou: completo (finish),
   * parcial (etapas ou tempo acabaram, o rascunho válido ficou) ou desfeito
   * (acabaram com o rascunho inválido, que voltou ao começo).
   */
  completion?: 'complete' | 'partial' | 'rolled-back';
  /** Fatos do objetivo antes e depois, calculados no estado gravado (chapas, orçamento). */
  facts?: { label: string; before: string; after: string }[];
  /** Conferência do app no estado gravado: a versão e o que ficou de problema novo. */
  checks?: { revisionId: string; issues: string[] };
  /** Operações que chegaram ao rascunho e foram descartadas no pedido. */
  reverted?: number;
  /**
   * Leituras que a IA fez (orçamento, corte, peças, desenho) e se ainda
   * descrevem o estado gravado: `stale` quando o móvel mudou depois dela.
   */
  evidence?: Record<string, 'fresh' | 'stale'>;
  /** Lotes recusados pela validação no pedido. */
  rejected?: number;
  /** Pedido que falhou no meio: o que dá para diagnosticar depois. */
  failure?: {
    requestId: string;
    baseRevisionId: string | null;
    cause: 'cancelled' | 'timeout' | 'provider' | 'internal';
    message: string;
    committed: 'none' | 'persisted-before-failure';
    draftChanged: boolean;
    draftOperations: number;
    rejected: number;
  };
};
export type TextPreview = {
  approach: string;
  answer: string;
  attempt: number;
  /** Bytes recebidos do provedor neste turno, incluindo raciocínio privado. */
  bytes?: number;
  /**
   * Raciocínio novo desde o evento anterior, para depuração. Só é enviado
   * quando a transmissão ao vivo está ligada, nunca é salvo nem volta ao
   * modelo.
   */
  reasoningDelta?: string;
  /** Total de raciocínio recebido neste turno, em caracteres. */
  reasoningTotal?: number;
};
