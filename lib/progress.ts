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
 * O que mudou no projeto, em linguagem de quem desenha móvel: é o conteúdo
 * principal da resposta, não o log da execução. Medidas e fatos vêm do desenho
 * depois de aplicar, nunca do texto da IA.
 */
export type ChangeHighlight = {
  tool: string;
  title: string;
  summary: string;
  /** Dimensões externas em mm, quando a mudança tem tamanho (desenha a peça). */
  size?: [number, number, number];
  measures?: { label: string; value: string }[];
  facts?: { label: string; value: string }[];
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
  /** Texto próprio da IA, para a interface não repetir o resumo do diff. */
  prose?: string;
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
