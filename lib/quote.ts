import { materials, type MaterialId } from './furniture';
import type { ModularPart } from './composition';
import { cutPlan, DEFAULT_SHEET, type CutPlan } from './cutplan';

/**
 * Orçamento de marcenaria a partir das peças geradas.
 *
 * A conta segue o que uma oficina cobra: chapas inteiras (contadas pelo plano
 * de corte, não pela área, porque sobra de chapa também se paga), fita de
 * borda por metro, ferragens por unidade e mão de obra por peça, módulo e
 * frente. Os preços são de partida e editáveis; o valor final é estimativa,
 * não proposta comercial.
 */
export type Prices = {
  /** Chapa 18 mm de 2750 × 1840 mm, por acabamento. */
  sheets: Record<MaterialId, number>;
  /** Fator sobre a chapa 18 para a chapa de 15 mm (caixa de gaveta). */
  factor15: number;
  /** Fator sobre a chapa 18 para a chapa de 6 mm (fundos). */
  factor6: number;
  /** Fita de borda, por metro aplicado. */
  edgePerM: number;
  /** Dobradiça com amortecedor, por unidade. */
  hinge: number;
  /** Par de corrediças telescópicas. */
  slidePair: number;
  handle: number;
  /** Com puxador; sem puxador é frente com cava ou toque. */
  handles: boolean;
  /** Cavilhas, minifix, parafusos e sapatas de um módulo. */
  moduleKit: number;
  /** Corte e fita, por peça. */
  labourPerPart: number;
  /** Montagem, por módulo. */
  labourPerModule: number;
  /** Regulagem de porta ou gaveta, por frente. */
  labourPerFront: number;
  /** Margem sobre o custo, em %. */
  margin: number;
};

export const DEFAULT_PRICES: Prices = {
  sheets: Object.fromEntries(materials.map((m) => [m.id, m.sheetPrice])) as Record<MaterialId, number>,
  factor15: 0.88,
  factor6: 0.42,
  edgePerM: 3.2,
  hinge: 14,
  slidePair: 48,
  handle: 22,
  handles: true,
  moduleKit: 28,
  labourPerPart: 7,
  labourPerModule: 140,
  labourPerFront: 30,
  margin: 35,
};

/** Preços salvos podem ser de uma versão com menos acabamentos. */
export function mergePrices(saved: unknown): Prices {
  if (!saved || typeof saved !== 'object') return structuredClone(DEFAULT_PRICES);
  const raw = saved as Partial<Prices>;
  const out = structuredClone(DEFAULT_PRICES);
  for (const key of Object.keys(out) as (keyof Prices)[]) {
    if (key === 'sheets') continue;
    const value = raw[key];
    if (typeof value === typeof out[key] && (typeof value !== 'number' || Number.isFinite(value)))
      (out as Record<string, unknown>)[key] = value;
  }
  if (raw.sheets && typeof raw.sheets === 'object')
    for (const m of materials) {
      const value = (raw.sheets as Record<string, unknown>)[m.id];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out.sheets[m.id] = value;
    }
  return out;
}

export type QuoteSection = 'Chapas' | 'Fita de borda' | 'Ferragens' | 'Mão de obra';
export type QuoteLine = {
  section: QuoteSection;
  label: string;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
  note?: string;
};
export type Quote = {
  lines: QuoteLine[];
  sections: { section: QuoteSection; total: number }[];
  cost: number;
  marginValue: number;
  total: number;
  counts: {
    modules: number;
    parts: number;
    doors: number;
    drawers: number;
    hinges: number;
    edgeMeters: number;
    sheets: number;
  };
  plan: CutPlan;
};

/** Dobradiças por folha, pela altura: a regra de bolso das fábricas. */
export function hingesFor(heightMm: number) {
  if (heightMm <= 900) return 2;
  if (heightMm <= 1500) return 3;
  if (heightMm <= 2000) return 4;
  return 5;
}

const isFront = (p: ModularPart) =>
  p.kind === 'door' || (p.kind === 'drawer' && p.id.endsWith(':front'));

export function quote(parts: readonly ModularPart[], moduleCount: number, prices: Prices): Quote {
  const plan = cutPlan(parts, DEFAULT_SHEET);
  const lines: QuoteLine[] = [];
  for (const g of plan.groups) {
    const base = g.materialId ? prices.sheets[g.materialId as MaterialId] : prices.sheets.white;
    const factor = g.thickness <= 6 ? prices.factor6 : g.thickness < 18 ? prices.factor15 : 1;
    const unitPrice = Math.round(base * factor * 100) / 100;
    lines.push({
      section: 'Chapas',
      label: `${g.material} ${g.thickness} mm`,
      qty: g.sheets,
      unit: g.sheets === 1 ? 'chapa' : 'chapas',
      unitPrice,
      total: g.sheets * unitPrice,
      note: `${g.parts} peças · aproveitamento ${Math.round(g.efficiency * 100)}%`,
    });
  }
  // Frente leva fita nas quatro bordas; as demais peças, na borda da frente.
  // Os 10% cobrem o excesso aparado na coladeira.
  let edge = 0;
  for (const p of parts) {
    if (isFront(p)) edge += 2 * (p.c + p.l);
    else if (p.edges.c1) edge += p.c;
  }
  const edgeMeters = Math.ceil((edge / 1000) * 1.1);
  if (edgeMeters)
    lines.push({
      section: 'Fita de borda',
      label: 'Fita de borda 22 mm',
      qty: edgeMeters,
      unit: 'm',
      unitPrice: prices.edgePerM,
      total: edgeMeters * prices.edgePerM,
      note: 'Frentes nas 4 bordas, demais peças na borda frontal, +10% de sobra',
    });
  const doors = parts.filter((p) => p.kind === 'door');
  const drawers = parts.filter((p) => p.kind === 'drawer' && p.id.endsWith(':front'));
  const hinges = doors.reduce((a, d) => a + hingesFor(d.size[1]), 0);
  if (hinges)
    lines.push({
      section: 'Ferragens',
      label: 'Dobradiça 35 mm com amortecedor',
      qty: hinges,
      unit: 'un',
      unitPrice: prices.hinge,
      total: hinges * prices.hinge,
      note: `${doors.length} ${doors.length === 1 ? 'porta' : 'portas'}, pela altura de cada folha`,
    });
  if (drawers.length)
    lines.push({
      section: 'Ferragens',
      label: 'Corrediça telescópica (par)',
      qty: drawers.length,
      unit: drawers.length === 1 ? 'par' : 'pares',
      unitPrice: prices.slidePair,
      total: drawers.length * prices.slidePair,
    });
  const fronts = doors.length + drawers.length;
  if (prices.handles && fronts)
    lines.push({
      section: 'Ferragens',
      label: 'Puxador',
      qty: fronts,
      unit: 'un',
      unitPrice: prices.handle,
      total: fronts * prices.handle,
    });
  lines.push({
    section: 'Ferragens',
    label: 'Kit de montagem',
    qty: moduleCount,
    unit: moduleCount === 1 ? 'módulo' : 'módulos',
    unitPrice: prices.moduleKit,
    total: moduleCount * prices.moduleKit,
    note: 'Cavilhas, minifix, parafusos e sapatas',
  });
  lines.push({
    section: 'Mão de obra',
    label: 'Corte e fita',
    qty: parts.length,
    unit: 'peças',
    unitPrice: prices.labourPerPart,
    total: parts.length * prices.labourPerPart,
  });
  lines.push({
    section: 'Mão de obra',
    label: 'Montagem',
    qty: moduleCount,
    unit: moduleCount === 1 ? 'módulo' : 'módulos',
    unitPrice: prices.labourPerModule,
    total: moduleCount * prices.labourPerModule,
  });
  if (fronts)
    lines.push({
      section: 'Mão de obra',
      label: 'Regulagem de frentes',
      qty: fronts,
      unit: 'frentes',
      unitPrice: prices.labourPerFront,
      total: fronts * prices.labourPerFront,
    });
  for (const line of lines) line.total = Math.round(line.total * 100) / 100;
  const order: QuoteSection[] = ['Chapas', 'Fita de borda', 'Ferragens', 'Mão de obra'];
  const sections = order
    .map((section) => ({
      section,
      total: lines.filter((l) => l.section === section).reduce((a, l) => a + l.total, 0),
    }))
    .filter((s) => s.total > 0);
  const cost = Math.round(lines.reduce((a, l) => a + l.total, 0) * 100) / 100;
  const marginValue = Math.round(cost * prices.margin) / 100;
  return {
    lines,
    sections,
    cost,
    marginValue,
    total: Math.round((cost + marginValue) * 100) / 100,
    counts: {
      modules: moduleCount,
      parts: parts.length,
      doors: doors.length,
      drawers: drawers.length,
      hinges,
      edgeMeters,
      sheets: plan.sheets.length,
    },
    plan,
  };
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function money(value: number) {
  return brl.format(value);
}
