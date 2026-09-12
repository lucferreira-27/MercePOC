export type Progress = {
  stage:
    | 'connecting'
    | 'interpreting'
    | 'proposing'
    | 'retrying'
    | 'validating'
    | 'applying'
    | 'saving';
  label: string;
  detail: string;
  attempt?: number;
};
/**
 * Uma etapa do turno: a ferramenta usada (ou a etapa do servidor) e o efeito
 * real no projeto. Alimenta o painel "Etapas", que mostra o que o assistente
 * fez em vez de só dizer que terminou.
 */
export type TurnStep = {
  tool: string;
  label: string;
  detail?: string;
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
  /** Roteiro do turno: interpretação, validação, ferramentas usadas e versão. */
  steps?: TurnStep[];
  approach?: string;
  selected?: SelectedPart[];
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
