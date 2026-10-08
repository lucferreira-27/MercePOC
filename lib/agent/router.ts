import { askJev, choiceOf, noulOf, type JevAnswer, type JevQuestion } from './jev';
import { ROUTE } from './thresholds';

/**
 * Roteador do pedido, antes do LLM. Uma chamada ao Jev com o pedido como
 * estado responde, em paralelo: a intenção, se há mais de uma ação, se é uma
 * medida sem eixo, se pede algo fora das ações diretas, e uma pergunta sim/não
 * por ação direta. O código decide com limiares fixos:
 *
 * - ação direta (vista, abas, abrir tudo, desfazer, arquivo): executa sem LLM;
 * - medida sem eixo ("aumente 10 cm"): pergunta o eixo sem LLM;
 * - o resto vai para o laço, com o orçamento de etapas da intenção.
 *
 * Qualquer dúvida (sem chave, confiança baixa, ações em conflito) cai no laço:
 * o roteador só atalha quando tem certeza.
 */
export const INTENTS = {
  build: 'Criar um móvel novo, uma cozinha ou um projeto inteiro a partir de descrição ou foto',
  edit: 'Mudar medidas, módulos, prateleiras, portas, gavetas ou acabamento do móvel atual',
  ask: 'Pergunta sobre preço, chapas, peças, medidas ou o projeto, sem pedir mudança',
  view: 'Mudar a câmera ou a vista, enquadrar, abrir ou fechar frentes, mostrar peças',
  studio: 'Ação do app: exportar arquivo, PDF, preços, margem, versões, desfazer, renomear, trocar de aba',
  options: 'Pedir alternativas ou opções comparadas lado a lado',
} as const;
export type Intent = keyof typeof INTENTS;

/** Ações que o app faz sem LLM: a pergunta do Jev e a ferramenta que roda. */
export const DIRECT = {
  vista_frente: { q: 'O pedido pede para ver o móvel de frente (vista frontal)?', tool: 'view_camera', args: { vista: 'front' } },
  vista_lado: { q: 'O pedido pede para ver o móvel de lado (vista lateral)?', tool: 'view_camera', args: { vista: 'side' } },
  vista_topo: { q: 'O pedido pede para ver o móvel de cima (vista de topo)?', tool: 'view_camera', args: { vista: 'top' } },
  vista_perspectiva: { q: 'O pedido pede a vista em perspectiva ou 3D?', tool: 'view_camera', args: { vista: 'perspective' } },
  enquadrar: { q: 'O pedido pede para enquadrar ou centralizar o móvel inteiro na tela?', tool: 'view_frame', args: {} },
  abrir_frentes: { q: 'O pedido pede para abrir as portas e gavetas do móvel, sem escolher uma específica?', tool: 'fronts_open', args: { ids: [], abrir: true } },
  fechar_frentes: { q: 'O pedido pede para fechar as portas e gavetas do móvel, sem escolher uma específica?', tool: 'fronts_open', args: { ids: [], abrir: false } },
  explodir: { q: 'O pedido pede a vista explodida, com as peças afastadas?', tool: 'view_toggle', args: { o_que: 'explode', ligado: true } },
  juntar: { q: 'O pedido pede para juntar as peças de volta, saindo da vista explodida?', tool: 'view_toggle', args: { o_que: 'explode', ligado: false } },
  cotas_mostrar: { q: 'O pedido pede para mostrar as cotas ou medidas na cena?', tool: 'view_toggle', args: { o_que: 'dims', ligado: true } },
  cotas_esconder: { q: 'O pedido pede para esconder as cotas ou medidas da cena?', tool: 'view_toggle', args: { o_que: 'dims', ligado: false } },
  aba_orcamento: { q: 'O pedido pede para abrir a aba ou tela de orçamento?', tool: 'ui_tab', args: { aba: 'quote' } },
  aba_corte: { q: 'O pedido pede para abrir a aba ou tela do plano de corte?', tool: 'ui_tab', args: { aba: 'cut' } },
  aba_pecas: { q: 'O pedido pede para abrir a aba ou lista de peças?', tool: 'ui_tab', args: { aba: 'parts' } },
  aba_versoes: { q: 'O pedido pede para abrir a aba de versões ou histórico?', tool: 'ui_tab', args: { aba: 'history' } },
  aba_ambiente: { q: 'O pedido pede para abrir a aba do ambiente ou da parede?', tool: 'ui_tab', args: { aba: 'room' } },
  desfazer: { q: 'O pedido pede para desfazer a última mudança (voltar um passo)?', tool: 'history_undo', args: {} },
  refazer: { q: 'O pedido pede para refazer a mudança desfeita?', tool: 'history_redo', args: {} },
  pdf: { q: 'O pedido pede para gerar, baixar ou imprimir o PDF?', tool: 'export_file', args: { formato: 'pdf' } },
  pdf_orcamento: { q: 'O pedido pede o orçamento em PDF (só o orçamento, para o cliente)?', tool: 'export_file', args: { formato: 'quote-pdf' } },
  foto: { q: 'O pedido pede uma foto ou imagem PNG da vista?', tool: 'export_file', args: { formato: 'png' } },
  csv_pecas: { q: 'O pedido pede para baixar a lista de peças (CSV)?', tool: 'export_file', args: { formato: 'parts-csv' } },
  csv_corte: { q: 'O pedido pede para baixar o plano de corte (CSV)?', tool: 'export_file', args: { formato: 'cut-csv' } },
  json: { q: 'O pedido pede para baixar o projeto completo em JSON?', tool: 'export_file', args: { formato: 'json' } },
} as const;
export type DirectAction = keyof typeof DIRECT;
/** Pares que não fazem sentido juntos: o pedido vai para o laço. */
const CONFLICTS: [DirectAction, DirectAction][] = [
  ['abrir_frentes', 'fechar_frentes'],
  ['explodir', 'juntar'],
  ['cotas_mostrar', 'cotas_esconder'],
  ['desfazer', 'refazer'],
  // "PDF do orçamento" acende as duas: o laço escolhe o formato pelo prompt.
  ['pdf', 'pdf_orcamento'],
];

export type Route =
  | { kind: 'direct'; actions: DirectAction[]; intent: Intent | null }
  | { kind: 'ask_axis'; intent: Intent }
  | { kind: 'agent'; intent: Intent | null; budget: number };

export function routerQuestions() {
  const q: Record<string, JevQuestion> = {
    intent: { type: 'choice', instructions: 'Qual é a intenção principal de `pedido`?', criteria: { ...INTENTS } },
    multi: { type: 'noul', instructions: '`pedido` pede duas ou mais ações diferentes?' },
    vague: {
      type: 'noul',
      instructions: '`pedido` manda mudar uma medida do móvel (em cm, m ou mm) sem dizer se é a largura, a altura ou a profundidade?',
      criteria: { true: 'Número de medida sem eixo, como "aumente 10 cm" ou "deixe com 2 metros"', false: 'Diz o eixo, ou não é medida do móvel (porcentagem, preço, quantidade)' },
    },
    // O "pede algo a mais?" é dividido em perguntas atômicas: uma pergunta
    // com lista longa o Jev lê ao pé da letra e erra.
    g_movel: { type: 'noul', instructions: '`pedido` pede para mudar o móvel: medidas, módulos, prateleiras, portas, gavetas ou acabamento?' },
    // "Mudar o móvel" não cobre criar um: "faça uma cozinha ... e mande o
    // PDF" passava como só vista e PDF.
    g_criar: { type: 'noul', instructions: '`pedido` pede para criar, montar ou desenhar um móvel, uma cozinha ou um ambiente?' },
    g_config: { type: 'noul', instructions: '`pedido` pede para mudar preço, margem, nome do projeto, a parede do ambiente, ou ir para uma versão de número específico?' },
    g_pergunta: { type: 'noul', instructions: '`pedido` faz uma pergunta que precisa de uma resposta em palavras ou números?' },
    g_alvo: { type: 'noul', instructions: '`pedido` fala de uma peça, porta, gaveta, vão ou módulo específico (por exemplo "a da esquerda", "essa porta")?' },
  };
  for (const [id, a] of Object.entries(DIRECT)) q[`d_${id}`] = { type: 'noul', instructions: a.q.replace('O pedido', '`pedido`') };
  return q;
}

/** Palavra de eixo no texto: nunca pergunta o eixo de quem já disse. */
const AXIS_WORDS = /\b(larg|alt[oa]|altura|profund|fundo|comprim|pé[- ]direito|espessura|grossura)/i;
const HAS_MEASURE = /\d/;
/** Número que não é medida do móvel: porcentagem, dinheiro, quantidade de peças. */
const NOT_SIZE = /%|r\$|reais|pre[çc]o|margem|gavetas?|portas?|prateleiras?|m[óo]dulos?|vers[ãa]o/i;
/** Medida do móvel no texto sem dizer o eixo ("aumente 10 cm"). */
export const axisMissing = (request: string) => HAS_MEASURE.test(request) && !AXIS_WORDS.test(request) && !NOT_SIZE.test(request);
const GATES = ['g_movel', 'g_config', 'g_pergunta', 'g_alvo'] as const;

/** A decisão, separada da chamada: testável com respostas gravadas. */
export function decideRoute(request: string, answers: Record<string, JevAnswer> | null): Route {
  if (!answers) return { kind: 'agent', intent: null, budget: ROUTE.budget.default };
  const intent = choiceOf(answers.intent);
  const name = (intent?.choice ?? null) as Intent | null;
  const sure = !!intent && intent.confidence >= ROUTE.intentConfidence;
  const other = Math.max(...GATES.map((g) => noulOf(answers[g]) ?? 1));
  // Criar é bimodal (pedidos de montar dão ~0,97, vistas até ~0,45): limiar próprio.
  const create = noulOf(answers.g_criar) ?? 1;
  const vague = noulOf(answers.vague) ?? 0;
  // Atalho: nenhuma porta de saída aberta e ao menos uma ação com certeza. A
  // intenção não entra: "junta as peças" já foi lida como "construir".
  if (other <= ROUTE.otherMax && create < ROUTE.createMin) {
    const picked = (Object.keys(DIRECT) as DirectAction[]).filter((id) => (noulOf(answers[`d_${id}`]) ?? 0) >= ROUTE.actionMin);
    const clash = CONFLICTS.some(([a, b]) => picked.includes(a) && picked.includes(b));
    // Pedido de várias ações com uma só escolhida: atalhar faria metade dele.
    const partial = (noulOf(answers.multi) ?? 0) >= ROUTE.multiMin && picked.length < 2;
    if (picked.length && picked.length <= ROUTE.maxDirect && !clash && !partial) return { kind: 'direct', actions: picked, intent: name };
  }
  if (sure && name === 'edit' && vague >= ROUTE.vagueMin && axisMissing(request))
    return { kind: 'ask_axis', intent: name };
  return { kind: 'agent', intent: name, budget: (name && ROUTE.budget[name]) || ROUTE.budget.default };
}

export async function routeRequest(request: string, signal?: AbortSignal, ask = askJev): Promise<Route> {
  const answers = await ask({ pedido: request }, routerQuestions(), signal);
  return decideRoute(request, answers as Record<string, JevAnswer> | null);
}
