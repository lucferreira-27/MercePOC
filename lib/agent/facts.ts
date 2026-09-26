import type { ModularPart } from '../composition';
import { generateDesign, type Design } from '../studio';
import { mergePrices, money, quote, type Prices } from '../quote';

/**
 * Fatos do objetivo, calculados pelo app no estado que fica: chapas por
 * material e espessura, total do orçamento. A resposta cita estes números,
 * nunca os de uma leitura feita antes da última mudança.
 */
export type DesignFacts = {
  sheets: number;
  groups: { material: string; thickness: number; sheets: number }[];
  total: number;
};

export function designFacts(design: Design, prices: Prices): DesignFacts {
  const q = quote(generateDesign(design).parts as ModularPart[], design.modules.length, mergePrices(prices));
  return {
    sheets: q.plan.sheets.length,
    groups: q.plan.groups.map((g) => ({ material: g.material, thickness: g.thickness, sheets: g.sheets })),
    total: q.total,
  };
}

/** "3 chapas (Nogueira 25 mm: 2; Nogueira 18 mm: 1), total R$ 3.138,21". */
export function factsLine(f: DesignFacts) {
  const groups = f.groups.map((g) => `${g.material} ${g.thickness} mm: ${g.sheets}`).join('; ');
  return `${f.sheets} ${f.sheets === 1 ? 'chapa' : 'chapas'} (${groups}), total ${money(f.total)}`;
}

/** Antes e depois do pedido, só o que mudou: vai no relatório e no cartão da resposta. */
export function factChanges(before: DesignFacts, after: DesignFacts) {
  const out: { label: string; before: string; after: string }[] = [];
  if (before.sheets !== after.sheets) out.push({ label: 'Chapas', before: String(before.sheets), after: String(after.sheets) });
  if (Math.abs(before.total - after.total) >= 0.01) out.push({ label: 'Orçamento', before: money(before.total), after: money(after.total) });
  return out;
}

const WORD: Record<string, number> = { uma: 1, um: 1, duas: 2, dois: 2, três: 3, tres: 3, quatro: 4, cinco: 5, seis: 6 };
/** Palavras que marcam o número como passado ou como troca ("de 25 mm para 18 mm", "eram 3"). */
const THEN = /\b(antes|era|eram|tinha|tinham|de\s*$|troquei|passou|passaram|reduzi|elimin|tirei|sem\b|no lugar)/i;

/**
 * O que a resposta afirma e o estado final desmente: espessura de chapa que
 * não sobrou, contagem de chapas que não é a do plano, total em reais que não
 * é nem o de antes nem o de agora, e "não dá para reduzir" quando reduziu.
 */
export function factClaims(text: string, now: DesignFacts, before: DesignFacts): string[] {
  const out: string[] = [];
  const thick = new Set(now.groups.map((g) => g.thickness));
  for (const m of text.matchAll(/(chapas?|placas?)[^.;]{0,50}?\b(\d{1,2})\s*mm|\b(\d{1,2})\s*mm[^.;]{0,25}?(chapas?|placas?)/gi)) {
    const t = Number(m[2] ?? m[3]);
    const lead = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index);
    if (!thick.has(t) && !THEN.test(m[0]) && !THEN.test(lead))
      out.push(`fala em chapa de ${t} mm, mas o plano final só tem ${[...thick].sort((a, b) => b - a).join(' e ')} mm`);
  }
  for (const m of text.matchAll(/\b(\d{1,2}|uma|um|duas|dois|três|tres|quatro|cinco|seis)\s+(chapas?|placas?)\b/gi)) {
    const n = WORD[m[1].toLowerCase()] ?? Number(m[1]);
    const lead = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index);
    if (n !== now.sheets && !now.groups.some((g) => g.sheets === n) && !THEN.test(lead) && !(n === before.sheets && /\bpara\b/.test(text)))
      out.push(`fala em ${n} ${n === 1 ? 'chapa' : 'chapas'}, mas o plano final tem ${now.sheets}`);
  }
  for (const m of text.matchAll(/R\$\s?([\d.]+,\d{2})/g)) {
    const v = Number(m[1].replace(/\./g, '').replace(',', '.'));
    if (Math.abs(v - now.total) >= 0.01 && Math.abs(v - before.total) >= 0.01)
      out.push(`cita ${m[0]}, mas o total agora é ${money(now.total)}${before.total !== now.total ? ` (antes do pedido ${money(before.total)})` : ''}`);
  }
  if (now.sheets < before.sheets && /não (dá|da|deu|foi possível|consegui|é possível)[^.]{0,40}reduzir/i.test(text))
    out.push(`diz que não dá para reduzir, mas as chapas foram de ${before.sheets} para ${now.sheets}`);
  return [...new Set(out)];
}

/**
 * O objetivo mensurável do pedido, quando há: menos chapas ou menor custo.
 * Fazer a ação ("tudo no mesmo material") não prova que o objetivo melhorou;
 * a conferência compara antes e depois.
 */
export function objectiveOf(request: string): 'sheets' | 'cost' | null {
  // "Reduco" (digitado assim num pedido real) também conta.
  const less = /(reduz|reduc|reduç|diminu|menos|economi|poupar|otimiz|aproveit)/i;
  if (less.test(request) && /(chapa|placa)/i.test(request)) return 'sheets';
  if ((less.test(request) && /(custo|preço|preco|valor|orçamento|orcamento|gast)/i.test(request)) || /mais barat/i.test(request)) return 'cost';
  return null;
}

/**
 * De onde vêm as chapas: cada acabamento e espessura, com os módulos que
 * usam. É a alavanca que a IA não via ("troquei a cor, continua 3 chapas").
 */
export function sheetLevers(design: Design) {
  const parts = generateDesign(design).parts as ModularPart[];
  const groups = new Map<string, Set<string>>();
  for (const p of parts) {
    const names = groups.get(p.material) ?? new Set<string>();
    for (const o of p.owners) names.add(design.modules.find((m) => m.id === o)?.name ?? o);
    groups.set(p.material, names);
  }
  const list = [...groups].map(([mat, names]) => `${mat} mm: ${[...names].slice(0, 6).join(', ')}`).join('; ');
  const panels = design.modules.filter((m) => m.kind === 'panel').map((m) => `${m.name} (${m.depth} mm)`);
  const ledges = design.modules.filter((m) => m.kind === 'ledge').map((m) => `${m.name} (${m.height} mm)`);
  return `Chapas por acabamento e espessura: ${list}.${panels.length ? ` Painel de parede aceita de 15 a 60 mm de espessura (depth): ${panels.join(', ')}.` : ''}${ledges.length ? ` Prateleira de parede aceita de 15 a 60 mm (altura): ${ledges.join(', ')}.` : ''} Caixas e frentes são de 18 mm.`;
}
