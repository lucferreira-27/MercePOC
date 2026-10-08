import type { Quote } from './quote';
import type { RichBlock } from './rich';
import type { Design } from './studio';
import { STYLES } from './styles';

/**
 * Próximos passos do projeto como chips da conversa. A IA propõe os dela no
 * fim de cada pedido (os mais ligados à conversa); estes saem do estado do
 * projeto, com os números de verdade: a chapa quase vazia, o ambiente que
 * falta, o orçamento que ainda não virou PDF. Juntos, até seis.
 */
export type SuggestionKind = 'design' | 'finish' | 'numbers' | 'file' | 'explore';
export type Suggestion = {
  text: string;
  kind: SuggestionKind;
  /** Por que o chip está ali (dica ao passar o mouse). */
  why?: string;
};

/** Família de uma sugestão escrita pela IA, pelas palavras. */
export function suggestionKind(text: string): SuggestionKind {
  const t = text.toLowerCase();
  if (/\b(pdf|csv|json|arquivo|foto|v[ií]deo|planilha|baix|export)/.test(t)) return 'file';
  if (/(or[cç]amento|pre[cç]o|custo|chapa|margem|frete|montagem|corte|pe[cç]as)/.test(t)) return 'numbers';
  if (/(acabamento|estilo|cor\b|nogueira|freij[oó]|carvalho|branco|preto|puxador|p[eé]s?\b|tampo|laca|madeira|japandi|industrial|escandinavo)/.test(t)) return 'finish';
  if (/(op[cç](ão|ões)|alternativ|ideia|compar|ambiente|parede|janela|porta da sala)/.test(t)) return 'explore';
  return 'design';
}

const fold = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** Dois chips dizem a mesma coisa quando as palavras principais coincidem. */
function same(a: string, b: string) {
  const wa = new Set(fold(a).split(' ').filter((w) => w.length > 3));
  const wb = fold(b).split(' ').filter((w) => w.length > 3);
  if (!wa.size || !wb.length) return fold(a) === fold(b);
  const hits = wb.filter((w) => wa.has(w)).length;
  return hits / Math.min(wa.size, wb.length) >= 0.75;
}

/** O que a conversa já mostrou ou gerou (para não sugerir de novo). */
function shown(blocks: readonly RichBlock[]) {
  return {
    quote: blocks.some((b) => b.kind === 'widget' && b.widget === 'quote'),
    cut: blocks.some((b) => b.kind === 'widget' && b.widget === 'cut'),
    quotePdf: blocks.some((b) => b.kind === 'file' && b.format === 'quote-pdf'),
    pdf: blocks.some((b) => b.kind === 'file' && b.format === 'pdf'),
    csv: blocks.some((b) => b.kind === 'file' && (b.format === 'cut-csv' || b.format === 'parts-csv')),
  };
}

export function stateSuggestions(input: {
  design: Design;
  quote: Quote | null;
  /** Há ambiente informado; `fits` é o veredito (null sem ambiente). */
  hasRoom: boolean;
  fits: boolean | null;
  blocks: readonly RichBlock[];
  /** Pedidos que a pessoa já fez (para não repetir o óbvio). */
  asked: readonly string[];
}): Suggestion[] {
  const { design, quote } = input;
  const out: Suggestion[] = [];
  const seen = shown(input.blocks);
  const modules = design.modules;
  // Encaixe primeiro: um móvel que não cabe é o problema da vez.
  if (input.fits === false)
    out.push({ text: 'Ajuste o móvel para caber no ambiente', kind: 'design', why: 'O móvel não cabe no ambiente informado' });
  if (quote) {
    // Chapa quase vazia de um material só para poucas peças: dá para economizar.
    const weak = [...quote.plan.groups].filter((g) => g.efficiency < 0.3 && g.sheets >= 1).sort((a, b) => a.efficiency - b.efficiency)[0];
    if (weak && quote.plan.groups.length > 1)
      out.push({
        text: `Reduza chapas: ${weak.material.toLowerCase()} ${weak.thickness} mm usa só ${Math.round(weak.efficiency * 100)}%`,
        kind: 'numbers',
        why: `A chapa de ${weak.material} ${weak.thickness} mm usa só ${Math.round(weak.efficiency * 100)}% da área`,
      });
    if (!seen.quote) out.push({ text: 'Mostre o orçamento detalhado', kind: 'numbers', why: `Total estimado agora: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(quote.total)}` });
    else if (!seen.quotePdf) out.push({ text: 'Gere o PDF do orçamento para o cliente', kind: 'file', why: 'O orçamento já está na conversa e ainda não virou PDF' });
    if (!seen.cut) out.push({ text: `Mostre o plano de corte (${quote.plan.sheets.length} ${quote.plan.sheets.length === 1 ? 'chapa' : 'chapas'})`, kind: 'numbers' });
    else if (!seen.csv) out.push({ text: 'Mande o plano de corte em CSV para a marcenaria', kind: 'file' });
    if (quote.counts.doors + quote.counts.drawers === 0 && modules.length)
      out.push({ text: `Coloque portas no ${modules[0].name.toLowerCase()}`, kind: 'design', why: 'Nenhuma porta ou gaveta ainda' });
  }
  if (!input.hasRoom) out.push({ text: 'Informe a parede para ver se o móvel cabe', kind: 'explore', why: 'Sem ambiente: não há veredito de encaixe' });
  // Um estilo que o projeto ainda não tem, para variar o acabamento.
  const styles = Object.values(STYLES).filter((s) => s.id !== design.style);
  if (styles.length) {
    const pick = styles[(modules.length + Math.round(quote?.total ?? 0)) % styles.length];
    out.push({ text: `Mostre como fica no estilo ${pick.label.toLowerCase()}`, kind: 'finish' });
  }
  out.push({ text: 'Me dê 3 opções de acabamento para comparar', kind: 'explore' });
  if (!seen.pdf) out.push({ text: 'Gere o PDF do projeto com desenho e chapas', kind: 'file' });
  return out.filter((s) => !input.asked.some((a) => same(a, s.text)));
}

/**
 * Junta as da IA (primeiro, são as da conversa) com as do estado, sem
 * repetir, até `max`. Seleção na tela vem antes de tudo: o pedido seguinte
 * costuma ser sobre ela.
 */
export function mergeSuggestions(selection: readonly string[], ai: readonly string[], state: readonly Suggestion[], max = 6): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (s: Suggestion) => {
    if (out.length >= max || out.some((o) => same(o.text, s.text))) return;
    out.push(s);
  };
  for (const t of selection) add({ text: t, kind: suggestionKind(t), why: 'Sobre o que está selecionado' });
  for (const t of ai) add({ text: t, kind: suggestionKind(t), why: 'Proposto pela IA para este projeto' });
  // Variedade: uma de cada família por vez, na ordem em que apareceram.
  const queues = new Map<SuggestionKind, Suggestion[]>();
  for (const s of state) queues.set(s.kind, [...(queues.get(s.kind) ?? []), s]);
  const lists = [...queues.values()];
  while (out.length < max && lists.some((l) => l.length))
    for (const list of lists) {
      const next = list.shift();
      if (next) add(next);
    }
  return out;
}
