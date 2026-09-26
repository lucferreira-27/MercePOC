/**
 * Perguntar ou fazer: o Jev ajuda a decidir se uma pergunta do assistente é
 * necessária. A regra do produto (a mesma do rótulo askAct em
 * bench/cases.mjs): perguntar só quando um chute errado custa caro e não há
 * padrão razoável nem limite do produto para usar. Pedido acima do limite se
 * faz no limite, dizendo qual é.
 *
 * Três jeitos de perguntar ao Jev, medidos em `npm run bench:askact`:
 * - A: o par pedido + pergunta ("dá para fazer sem a resposta?");
 * - B: o que a pergunta quer saber (uma escolha sobre a pergunta sozinha),
 *   e o código decide pela espécie e pelo pedido;
 * - C: o pedido sozinho, no começo do turno ("precisa perguntar antes?").
 *
 * O Jev acerta pergunta atômica sobre um texto só; comparar dois textos na
 * mesma pergunta (A) é o formato em que ele mais erra, por isso B existe.
 */
import type { Design } from '../studio';
import { askJev, choiceOf, noulOf, type JevAnswer, type JevQuestion } from './jev';
import { axisMissing } from './router';
import { ASK } from './thresholds';

/** O que se sabe do turno além dos textos: seleção e prateleiras do projeto. */
export type AskFacts = { pedido: string; selected: boolean; shelves: number };

/** Limites e padrões do produto, em palavras, para o Jev (A+ e C+). */
export const PRODUCT_RULES =
  'Módulo: largura até 1200 mm, altura de 200 a 2400 mm, profundidade até 800 mm; até 12 módulos. Vão livre mínimo de 100 mm. De 1 a 6 gavetas por vão. Módulo novo usa as medidas do atual quando o pedido não diz. Pedido acima do limite: faz no limite e avisa.';

/** Resumo do projeto para o Jev (C+): módulos, prateleiras e seleção. */
export function askState(design: Design, selected: boolean) {
  const mods = design.modules.map((m) => `${m.name} ${Math.round(m.width)} × ${Math.round(m.height)} × ${Math.round(m.depth)} mm`);
  return `${mods.length} módulo(s): ${mods.join('; ')}. ${design.shelves.length} prateleira(s) soltas. ${selected ? 'Há uma peça selecionada.' : 'Nada selecionado.'}`;
}

// ---------------------------------------------------------------- A
export const pairQuestions = (): Record<string, JevQuestion> => ({
  sem_resposta: {
    type: 'noul',
    instructions: 'Dá para cumprir `pedido` sem a resposta de `pergunta`, usando um padrão razoável ou o limite do produto?',
  },
});
export const pairBlocks = (answers: Record<string, JevAnswer>, min: number) => (noulOf(answers.sem_resposta) ?? 0) >= min;

// ---------------------------------------------------------------- B
/** O que a pergunta quer saber. Só eixo e peça podem ser legítimas. */
export const ASK_KINDS = {
  eixo: 'Qual medida mudar: largura, altura ou profundidade',
  peca: 'Qual peça, prateleira, módulo, vão ou compartimento',
  valor: 'Um número ou uma medida que o pedido não deu',
  limite: 'O que fazer porque o pedido passa de um limite do produto',
  preferencia: 'Uma escolha entre formas ou estilos de fazer',
  ambiente: 'Medidas do ambiente: parede, pé-direito, janela, piso',
  outro: 'Outra coisa',
} as const;
export type AskKind = keyof typeof ASK_KINDS;

export const kindQuestions = (): Record<string, JevQuestion> => ({
  especie: { type: 'choice', instructions: 'O que `pergunta` quer saber da pessoa?', criteria: { ...ASK_KINDS } },
});
/** Sobre o pedido: medida sem eixo, e alvo apontado de um jeito vago. */
export const requestQuestions = (): Record<string, JevQuestion> => ({
  vague: {
    type: 'noul',
    instructions: '`pedido` manda mudar uma medida do móvel (em cm, m ou mm) sem dizer se é a largura, a altura ou a profundidade?',
  },
  alvo_vago: {
    type: 'noul',
    instructions: '`pedido` aponta a peça de um jeito vago, como "a outra", "aquela" ou "uma delas", sem dizer qual?',
  },
});

/** "Prateleira 4" num projeto com três: a peça citada sumiu. */
export function missingShelf(pedido: string, shelves: number) {
  const n = /prateleira\s*(?:n[º°o.]?\s*)?(\d+)/i.exec(pedido)?.[1];
  return !!n && Number(n) > shelves;
}

export type KindVerdict = { kind: AskKind | null; legit: boolean; why: string };
/**
 * A decisão de B, separada da chamada. Eixo só vale quando o pedido tem
 * medida sem eixo; peça só quando nada está selecionado e o pedido é vago, ou
 * cita peça que não existe; o resto tem padrão ou limite, e é para fazer.
 */
export function kindVerdict(
  kindAnswers: Record<string, JevAnswer>,
  reqAnswers: Record<string, JevAnswer>,
  facts: AskFacts,
  min = ASK.vagueMin,
): KindVerdict {
  const kind = (choiceOf(kindAnswers.especie)?.choice ?? null) as AskKind | null;
  // A peça citada sumiu: qualquer pergunta vale, seja qual for o jeito de perguntar.
  if (missingShelf(facts.pedido, facts.shelves)) return { kind, legit: true, why: 'a peça citada não existe' };
  if (!kind || kind === 'outro') return { kind, legit: true, why: 'espécie incerta' };
  if (kind === 'eixo') {
    const legit = axisMissing(facts.pedido) && (noulOf(reqAnswers.vague) ?? 0) >= min;
    return { kind, legit, why: legit ? 'medida sem eixo' : 'o pedido já diz o eixo' };
  }
  if (kind === 'peca') {
    const legit = !facts.selected && (noulOf(reqAnswers.alvo_vago) ?? 0) >= min;
    return { kind, legit, why: legit ? 'alvo vago sem seleção' : facts.selected ? 'há uma peça selecionada' : 'o pedido diz a peça' };
  }
  return { kind, legit: false, why: kind === 'limite' ? 'faz no limite e avisa' : 'há um padrão razoável' };
}

/** O portão está ligado (MERCE_ASK_GATE=0 desliga, para medir antes e depois). */
export const askGateOn = () => process.env.MERCE_ASK_GATE !== '0';

/**
 * A pergunta é necessária? As duas chamadas ao Jev vão juntas (~0,3 s, só
 * quando o assistente pergunta). null sem Jev: a pergunta segue.
 */
export async function askVerdict(pergunta: string, facts: AskFacts, ask = askJev): Promise<KindVerdict | null> {
  const [kind, req] = await Promise.all([ask({ pergunta }, kindQuestions()), ask({ pedido: facts.pedido }, requestQuestions())]);
  if (!kind || !req) return null;
  return kindVerdict(kind as Record<string, JevAnswer>, req as Record<string, JevAnswer>, facts);
}

/** O que volta para a IA quando a pergunta não é necessária: o que fazer no lugar. */
export function blockText(v: KindVerdict) {
  const instead: Record<string, string> = {
    limite: 'o pedido passa de um limite: faça no limite e diga na resposta qual é',
    valor: 'use a medida do módulo atual ou um padrão comum e diga na resposta o que assumiu',
    preferencia: 'escolha o jeito mais comum e diga na resposta que dá para mudar',
    ambiente: 'use as medidas do ambiente que já existem, ou as padrão, e diga quais usou',
    eixo: 'o pedido já diz a medida: aplique',
    peca: 'use a peça selecionada, ou a que o pedido cita, e diga qual foi',
  };
  return `Não pergunte: ${instead[v.kind ?? ''] ?? 'faça com o padrão razoável e diga na resposta o que assumiu'}. Pergunte só quando um chute errado custa caro e não há padrão nem limite para usar.`;
}

// ---------------------------------------------------------------- C
export const needQuestions = (): Record<string, JevQuestion> => ({
  precisa: { type: 'noul', instructions: '`pedido` precisa de uma resposta da pessoa antes de dar para fazer?' },
});
export const needsAsk = (answers: Record<string, JevAnswer>, min: number) => (noulOf(answers.precisa) ?? 0) >= min;
