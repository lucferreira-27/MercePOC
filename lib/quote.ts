import { CATEGORY_INFO, categoryOf, materialOf, materials, type MaterialCategory, type MaterialId } from './furniture';
import { generateComposition, type Composition, type ModularPart } from './composition';
import { cutPlan, DEFAULT_SHEET, type CutPlan } from './cutplan';
import { fittingsOf, type Fitting } from './fittings';
import { HANDLES, LEGS, type HandleType, type LegType } from './look';
import { z } from 'zod';

/**
 * Orçamento de marcenaria a partir das peças geradas.
 *
 * A conta segue o que uma oficina cobra: chapas inteiras (contadas pelo plano
 * de corte, não pela área, porque sobra de chapa também se paga), fita de
 * borda por metro, madeira maciça por m³, pedra, vidro e palhinha por m²,
 * tubo de aço por metro, ferragens por unidade e mão de obra por peça, módulo
 * e frente. Os preços são de partida e editáveis; o valor final é estimativa,
 * não proposta comercial.
 */
export type Prices = {
  /**
   * Preço de cada material na unidade da categoria: chapa 18 mm de 2750 ×
   * 1840 mm, m³ de madeira maciça, metro de tubo 20 × 20, m² de vidro, pedra
   * ou palhinha. O nome ficou da v3, quando só havia chapas.
   */
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
  /** Puxador barra, o de sempre. */
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
  /** Ferragens e serviços da v4, por chave de `HARDWARE` (pé de cada tipo, puxadores, LED, usinagem). */
  hardware: Record<HardwareKey, number>;
};

/**
 * Itens comprados por unidade ou metro, com o preço de partida e o rótulo da
 * linha do orçamento. Pé e puxador de cada tipo são uma chave cada.
 */
export const HARDWARE = {
  'leg-palito': { label: 'Pé palito', unit: 'un', price: 38 },
  'leg-tapered': { label: 'Pé cônico de madeira', unit: 'un', price: 55 },
  'leg-splayed': { label: 'Pé inclinado de madeira', unit: 'un', price: 68 },
  'leg-block': { label: 'Pé quadrado de madeira', unit: 'un', price: 45 },
  'leg-turned': { label: 'Pé torneado', unit: 'un', price: 95 },
  'leg-bun': { label: 'Pé bola', unit: 'un', price: 42 },
  'leg-hairpin': { label: 'Pé grampo de aço', unit: 'un', price: 85 },
  'leg-tube': { label: 'Pé de tubo de aço', unit: 'un', price: 60 },
  'leg-pipe': { label: 'Pé de cano de aço', unit: 'un', price: 78 },
  'leg-casters': { label: 'Rodízio com freio', unit: 'un', price: 34 },
  'leg-plinth': { label: 'Sapata niveladora do rodapé', unit: 'un', price: 9 },
  'leg-skirt': { label: 'Sapata niveladora da base', unit: 'un', price: 9 },
  'leg-wall': { label: 'Suporte oculto de parede', unit: 'un', price: 48 },
  'leg-trestle': { label: 'Cavalete (com a travessa)', unit: 'un', price: 240 },
  hook: { label: 'Gancho de cabideiro', unit: 'un', price: 22 },
  'handle-knob': { label: 'Puxador botão', unit: 'un', price: 18 },
  'handle-cup': { label: 'Puxador concha', unit: 'un', price: 29 },
  'handle-edge': { label: 'Puxador perfil de borda', unit: 'un', price: 36 },
  'handle-strap': { label: 'Alça de couro', unit: 'un', price: 32 },
  'handle-none': { label: 'Fecho toque (sem puxador)', unit: 'un', price: 24 },
  sliding: { label: 'Kit de porta de correr (trilho e roldanas, por folha)', unit: 'un', price: 95 },
  lift: { label: 'Pistão de basculante', unit: 'un', price: 38 },
  led: { label: 'Fita de LED com perfil', unit: 'm', price: 39 },
  weld: { label: 'Serralheria (corte, solda e pintura)', unit: 'm', price: 18 },
  machining: { label: 'Usinagem de frentes (moldura, ripado, quadro, cava)', unit: 'frentes', price: 45 },
  'stone-edge': { label: 'Acabamento de borda da pedra', unit: 'm', price: 48 },
  'metal-plate': { label: 'Fator da chapa de metal (m² em metros de tubo)', unit: '×', price: 25 },
} as const;
export type HardwareKey = keyof typeof HARDWARE;
export const HARDWARE_KEYS = Object.keys(HARDWARE) as HardwareKey[];

export const DEFAULT_PRICES: Prices = {
  sheets: Object.fromEntries(materials.map((m) => [m.id, m.price])) as Record<MaterialId, number>,
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
  hardware: Object.fromEntries(HARDWARE_KEYS.map((k) => [k, HARDWARE[k].price])) as Record<HardwareKey, number>,
};

/** Preços salvos podem ser de uma versão com menos acabamentos ou sem ferragens novas. */
export function mergePrices(saved: unknown): Prices {
  if (!saved || typeof saved !== 'object') return structuredClone(DEFAULT_PRICES);
  const raw = saved as Partial<Prices>;
  const out = structuredClone(DEFAULT_PRICES);
  for (const key of Object.keys(out) as (keyof Prices)[]) {
    if (key === 'sheets' || key === 'hardware') continue;
    const value = raw[key];
    if (typeof value === typeof out[key] && (typeof value !== 'number' || Number.isFinite(value)))
      (out as Record<string, unknown>)[key] = value;
  }
  const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (raw.sheets && typeof raw.sheets === 'object')
    for (const m of materials) {
      const value = (raw.sheets as Record<string, unknown>)[m.id];
      if (valid(value)) out.sheets[m.id] = value;
    }
  if (raw.hardware && typeof raw.hardware === 'object')
    for (const k of HARDWARE_KEYS) {
      const value = (raw.hardware as Record<string, unknown>)[k];
      if (valid(value)) out.hardware[k] = value;
    }
  return out;
}

export type QuoteSection = 'Chapas' | 'Fita de borda' | 'Materiais' | 'Ferragens' | 'Mão de obra' | 'Outros';
export const QUOTE_SECTIONS: QuoteSection[] = ['Chapas', 'Fita de borda', 'Materiais', 'Ferragens', 'Mão de obra', 'Outros'];
/** Preço da tabela que a linha usa: editar na linha grava na tabela. */
export type PriceKey = Exclude<keyof Prices, 'sheets' | 'handles' | 'factor15' | 'factor6' | 'margin' | 'hardware'>;
export type PriceRef = { sheet: MaterialId } | { key: PriceKey } | { hardware: HardwareKey };
export type QuoteLine = {
  section: QuoteSection;
  label: string;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
  note?: string;
  /** Preço editável; ausente quando o unitário é derivado (chapa fina = fator × chapa 18). */
  price?: PriceRef;
  /** Peças que a linha conta, para acender no móvel. Vazio: vale o móvel todo. */
  parts: string[];
  /** Chave estável (seção|rótulo): o ajuste à mão se prende a ela. */
  key?: string;
  /** Quantidade que o app calculou, quando a pessoa trocou a quantidade. */
  computedQty?: number;
  /** Item à parte, posto à mão (frete, instalação): o id dele no ajuste. */
  extra?: string;
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
  /** Linhas calculadas que a pessoa tirou do orçamento (para voltar). */
  removed: QuoteLine[];
  /** Quantos ajustes à mão valem nesta conta (removidos, quantidades, extras). */
  adjusted: number;
};

/**
 * Ajustes do orçamento feitos à mão, guardados na versão do projeto: tirar
 * uma linha calculada, trocar a quantidade dela e pôr itens à parte. O
 * cálculo segue o móvel; o ajuste vale enquanto a linha existir (a chave é
 * seção|rótulo). Editar vira versão, como qualquer mudança do projeto.
 */
export type QuoteExtra = { id: string; label: string; qty: number; unit: string; unitPrice: number };
export type QuoteAdjust = {
  lines?: Record<string, { qty?: number; removed?: boolean }>;
  extras?: QuoteExtra[];
};
export const quoteExtraSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    label: z.string().trim().min(1).max(80),
    qty: z.number().min(0).max(100000),
    unit: z.string().trim().min(1).max(16),
    unitPrice: z.number().min(0).max(10000000),
  })
  .strict();
export const quoteAdjustSchema = z
  .object({
    lines: z
      .record(
        z.string().min(3).max(160),
        z.object({ qty: z.number().min(0).max(100000).optional(), removed: z.boolean().optional() }).strict(),
      )
      .optional(),
    extras: z.array(quoteExtraSchema).max(30).optional(),
  })
  .strict();

/** Ajuste vazio vira `undefined`: a versão não guarda objeto sem conteúdo. */
export function cleanAdjust(adj: QuoteAdjust | undefined): QuoteAdjust | undefined {
  if (!adj) return undefined;
  const lines = Object.fromEntries(
    Object.entries(adj.lines ?? {})
      .map(([k, v]) => [k, { ...(v.qty !== undefined ? { qty: v.qty } : {}), ...(v.removed ? { removed: true } : {}) }] as const)
      .filter(([, v]) => v.qty !== undefined || v.removed),
  );
  const extras = adj.extras?.filter((e) => e.label.trim()) ?? [];
  const out: QuoteAdjust = {
    ...(Object.keys(lines).length ? { lines } : {}),
    ...(extras.length ? { extras } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** Os ajustes à mão sobre a conta calculada; custo, margem e total refeitos. */
export function adjustQuote(q: Quote, adj: QuoteAdjust | undefined, margin: number): Quote {
  const lines: QuoteLine[] = [];
  const removed: QuoteLine[] = [];
  let adjusted = 0;
  for (const line of q.lines) {
    const key = line.key ?? `${line.section}|${line.label}`;
    const a = adj?.lines?.[key];
    if (a?.removed) {
      removed.push({ ...line, key });
      adjusted++;
      continue;
    }
    if (a?.qty !== undefined && a.qty !== line.qty) {
      adjusted++;
      lines.push({ ...line, key, computedQty: line.qty, qty: a.qty, total: Math.round(a.qty * line.unitPrice * 100) / 100 });
    } else lines.push({ ...line, key });
  }
  for (const e of adj?.extras ?? []) {
    adjusted++;
    lines.push({
      section: 'Outros',
      label: e.label,
      qty: e.qty,
      unit: e.unit,
      unitPrice: e.unitPrice,
      total: Math.round(e.qty * e.unitPrice * 100) / 100,
      parts: [],
      key: `Outros|${e.id}`,
      extra: e.id,
    });
  }
  const sections = QUOTE_SECTIONS.map((section) => ({
    section,
    total: Math.round(lines.filter((l) => l.section === section).reduce((a, l) => a + l.total, 0) * 100) / 100,
  })).filter((s) => s.total > 0);
  const cost = Math.round(lines.reduce((a, l) => a + l.total, 0) * 100) / 100;
  const marginValue = Math.round(cost * margin) / 100;
  return { ...q, lines, sections, cost, marginValue, total: Math.round((cost + marginValue) * 100) / 100, removed, adjusted };
}

/** Dobradiças por folha, pela altura: a regra de bolso das fábricas. */
export function hingesFor(heightMm: number) {
  if (heightMm <= 900) return 2;
  if (heightMm <= 1500) return 3;
  if (heightMm <= 2000) return 4;
  return 5;
}

export const isFront = (p: Pick<ModularPart, 'kind' | 'id'>) =>
  p.kind === 'door' || (p.kind === 'drawer' && p.id.endsWith(':front'));

/** Peça de chapa (a v3 não marcava categoria: era tudo chapa). */
export const isSheet = (p: Pick<ModularPart, 'category'>) => !p.category || p.category === 'sheet';

/**
 * Bordas com fita, pela mesma regra do orçamento: frente leva nas quatro,
 * as demais peças nas bordas que o gerador marcou. Vidro, pedra, metal e
 * palhinha não levam fita.
 */
export function edgeSides(p: Pick<ModularPart, 'kind' | 'id' | 'edges' | 'category'>) {
  if (!isSheet(p)) return { c1: false, c2: false, l1: false, l2: false };
  if (isFront(p)) return { c1: true, c2: true, l1: true, l2: true };
  // Peças da v4 (tampo, moldura, rodapé) contam todas as bordas marcadas; as
  // da v3 seguem a conta de antes (só a da frente), para orçamento antigo
  // não mudar.
  if (V4_KINDS.has(p.kind)) return { c1: !!p.edges.c1, c2: !!p.edges.c2, l1: !!p.edges.l1, l2: !!p.edges.l2 };
  return { c1: !!p.edges.c1, c2: false, l1: false, l2: false };
}
const V4_KINDS = new Set<ModularPart['kind']>(['slab', 'cornice', 'plinth']);

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Sobra de compra por categoria: madeira maciça perde no aplainar, pedra e vidro no corte. */
const WASTE: Partial<Record<MaterialCategory, number>> = { solid: 1.25, stone: 1.15, glass: 1.1, fiber: 1.15, metal: 1.1 };

export function quote(
  parts: readonly ModularPart[],
  moduleCount: number,
  prices: Prices,
  fittings: readonly Fitting[] = [],
  adjust?: QuoteAdjust,
): Quote {
  const plan = cutPlan(parts, DEFAULT_SHEET);
  const lines: QuoteLine[] = [];
  const hw = prices.hardware ?? DEFAULT_PRICES.hardware;
  for (const g of plan.groups) {
    const base = g.materialId ? prices.sheets[g.materialId as MaterialId] : prices.sheets.white;
    const factor = g.thickness <= 6 ? prices.factor6 : g.thickness < 18 ? prices.factor15 : 1;
    const unitPrice = Math.round(base * factor * 100) / 100;
    lines.push({
      section: 'Chapas',
      parts: parts.filter((p) => isSheet(p) && p.material === g.key).map((p) => p.id),
      ...(factor === 1 && g.materialId ? { price: { sheet: g.materialId as MaterialId } } : {}),
      label: `${g.material} ${g.thickness} mm`,
      qty: g.sheets,
      unit: g.sheets === 1 ? 'chapa' : 'chapas',
      unitPrice,
      total: g.sheets * unitPrice,
      note:
        `${g.parts} peças · aproveitamento ${Math.round(g.efficiency * 100)}%` +
        (factor === 1 ? '' : ` · ${String(factor).replace('.', ',')} × chapa 18`),
    });
  }
  // Frente leva fita nas quatro bordas; as demais peças, nas bordas marcadas.
  // Porta de quadro leva também a volta de dentro. Os 10% cobrem o excesso
  // aparado na coladeira.
  let edge = 0;
  const banded: string[] = [];
  for (const p of parts) {
    const e = edgeSides(p);
    let length = (e.c1 ? p.c : 0) + (e.c2 ? p.c : 0) + (e.l1 ? p.l : 0) + (e.l2 ? p.l : 0);
    if (length && p.face?.kind === 'frame') length += 2 * (p.c + p.l) - 8 * p.face.frame;
    if (length) banded.push(p.id);
    edge += length;
  }
  const edgeMeters = Math.ceil((edge / 1000) * 1.1);
  if (edgeMeters)
    lines.push({
      section: 'Fita de borda',
      parts: banded,
      price: { key: 'edgePerM' },
      label: 'Fita de borda 22 mm',
      qty: edgeMeters,
      unit: 'm',
      unitPrice: prices.edgePerM,
      total: edgeMeters * prices.edgePerM,
      note: 'Frentes nas 4 bordas, demais peças nas bordas à vista, +10% de sobra',
    });
  // Madeira maciça, pedra, vidro, palhinha e chapa de metal: pela medida, não
  // por chapa. Uma linha por material e espessura.
  const others = new Map<string, ModularPart[]>();
  // Porta de quadro de aço (serralheria): o quadro é tubo, cobrado por metro
  // de perímetro, como a estrutura; o miolo segue como material.
  const steelFrames = parts.filter((p) => p.category === 'metal' && p.face?.kind === 'frame');
  for (const p of parts) if (!isSheet(p) && !steelFrames.includes(p)) others.set(p.material, [...(others.get(p.material) ?? []), p]);
  for (const [label, list] of others) {
    const id = list[0].materialId!;
    const cat = categoryOf(id);
    const waste = WASTE[cat] ?? 1;
    const area = list.reduce((a, p) => a + (p.c * p.l) / 1e6, 0);
    const volume = list.reduce((a, p) => a + (p.c * p.l * p.thickness) / 1e9, 0);
    const solid = cat === 'solid';
    const qty = solid ? r3(volume * waste) : r2(area * waste);
    // Metal em chapa (tampo, tela): o preço do material é por metro de tubo.
    const unitPrice = cat === 'metal' ? r2(prices.sheets[id] * hw['metal-plate']) : prices.sheets[id];
    lines.push({
      section: 'Materiais',
      parts: list.map((p) => p.id),
      ...(cat === 'metal' ? {} : { price: { sheet: id } }),
      label: `${label} mm`,
      qty,
      unit: solid ? 'm³' : 'm²',
      unitPrice,
      total: qty * unitPrice,
      note: `${list.length} ${list.length === 1 ? 'peça' : 'peças'} · ${CATEGORY_INFO[cat].label.toLowerCase()}, +${Math.round((waste - 1) * 100)}% de sobra${cat === 'metal' ? ` · ${hw['metal-plate']} × metro de tubo por m²` : ''}`,
    });
    // Pedra: borda polida na frente e nas pontas (o que ficou sem encosto).
    if (cat === 'stone') {
      const metres = r2(list.reduce((a, p) => a + (p.c + (p.kind === 'slab' ? 2 * p.l : 0)) / 1000, 0));
      lines.push({ section: 'Materiais', parts: list.map((p) => p.id), price: { hardware: 'stone-edge' }, label: `${HARDWARE['stone-edge'].label} (${materialOf(id).name})`, qty: metres, unit: 'm', unitPrice: hw['stone-edge'], total: metres * hw['stone-edge'] });
    }
  }
  // Tubo de aço soldado (estrutura, contorno, base trenó): metro do material
  // mais a serralheria.
  const tubes = new Map<string, Fitting[]>();
  for (const f of fittings) if ((f.kind === 'stand' || f.kind === 'frame') && f.materialId) tubes.set(f.materialId, [...(tubes.get(f.materialId) ?? []), f]);
  let welded = 0;
  const frameGroups = new Map<string, ModularPart[]>();
  for (const p of steelFrames) frameGroups.set(p.materialId!, [...(frameGroups.get(p.materialId!) ?? []), p]);
  for (const [id, list] of frameGroups) {
    const metres = r2(list.reduce((a, p) => a + (2 * (p.c + p.l)) / 1000, 0) * (WASTE.metal ?? 1));
    welded += metres;
    lines.push({
      section: 'Materiais',
      parts: list.map((p) => p.id),
      price: { sheet: id as MaterialId },
      label: `Quadro das portas em ${materialOf(id).name.toLowerCase()} (tubo 20 × 20)`,
      qty: metres,
      unit: 'm',
      unitPrice: prices.sheets[id as MaterialId],
      total: metres * prices.sheets[id as MaterialId],
      note: `${list.length} ${list.length === 1 ? 'porta' : 'portas'}, pelo perímetro, +10% de sobra`,
    });
  }
  for (const [id, list] of tubes) {
    const metres = r2(list.reduce((a, f) => a + f.bom.qty, 0) * (WASTE.metal ?? 1));
    welded += metres;
    lines.push({
      section: 'Materiais',
      parts: [],
      price: { sheet: id as MaterialId },
      label: `Estrutura em ${materialOf(id).name.toLowerCase()} (tubo 20 × 20)`,
      qty: metres,
      unit: 'm',
      unitPrice: prices.sheets[id as MaterialId],
      total: metres * prices.sheets[id as MaterialId],
      note: `${list.length} ${list.length === 1 ? 'trecho' : 'trechos'}, +10% de sobra`,
    });
  }
  const doors = parts.filter((p) => p.kind === 'door');
  const drawers = parts.filter((p) => p.kind === 'drawer' && p.id.endsWith(':front'));
  // Dobradiça só em porta que gira: a de giro pela altura da folha, a
  // basculante duas (mais o pistão); folha de correr vai no trilho.
  const sliding = doors.filter((p) => p.motion?.type === 'slide');
  const flaps = doors.filter((p) => p.motion?.type === 'flap');
  const hinged = doors.filter((p) => p.motion?.type !== 'slide' && p.motion?.type !== 'flap');
  const hinges = hinged.reduce((a, d) => a + hingesFor(d.size[1]), 0) + 2 * flaps.length;
  if (hinges)
    lines.push({
      section: 'Ferragens',
      parts: doors.map((d) => d.id),
      price: { key: 'hinge' },
      label: 'Dobradiça 35 mm com amortecedor',
      qty: hinges,
      unit: 'un',
      unitPrice: prices.hinge,
      total: hinges * prices.hinge,
      note: `${hinged.length + flaps.length} ${hinged.length + flaps.length === 1 ? 'porta' : 'portas'}, pela altura de cada folha${flaps.length ? '; basculante leva duas' : ''}`,
    });
  if (flaps.length)
    lines.push({ section: 'Ferragens', parts: flaps.map((p) => p.id), price: { hardware: 'lift' }, label: HARDWARE.lift.label, qty: flaps.length, unit: 'un', unitPrice: hw.lift, total: flaps.length * hw.lift });
  if (sliding.length)
    lines.push({ section: 'Ferragens', parts: sliding.map((p) => p.id), price: { hardware: 'sliding' }, label: HARDWARE.sliding.label, qty: sliding.length, unit: 'un', unitPrice: hw.sliding, total: sliding.length * hw.sliding });
  if (drawers.length)
    lines.push({
      section: 'Ferragens',
      parts: drawers.map((d) => d.id),
      price: { key: 'slidePair' },
      label: 'Corrediça telescópica (par)',
      qty: drawers.length,
      unit: drawers.length === 1 ? 'par' : 'pares',
      unitPrice: prices.slidePair,
      total: drawers.length * prices.slidePair,
    });
  const fronts = doors.length + drawers.length;
  const frontIds = [...doors, ...drawers].map((p) => p.id);
  // Puxador por tipo: barra é o de sempre (preço `handle`); cava e recorte
  // são usinagem; sem puxador leva fecho toque.
  if (prices.handles && fronts) {
    const byType = new Map<HandleType, string[]>();
    for (const p of [...doors, ...drawers]) {
      const t = p.handle?.type ?? 'bar';
      byType.set(t, [...(byType.get(t) ?? []), p.id]);
    }
    for (const [type, ids] of byType) {
      if (type === 'groove' || type === 'cutout') continue;
      const key = type === 'bar' ? null : (`handle-${type}` as HardwareKey);
      const unitPrice = key ? hw[key] : prices.handle;
      lines.push({
        section: 'Ferragens',
        parts: ids,
        price: key ? { hardware: key } : { key: 'handle' },
        label: key ? HARDWARE[key].label : 'Puxador',
        qty: ids.length,
        unit: 'un',
        unitPrice,
        total: ids.length * unitPrice,
        ...(type !== 'bar' && type !== 'none' && HANDLES[type].materials ? { note: materialNote(fittings, ids) } : {}),
      });
    }
  }
  // Pés, rodízios e sapatas por unidade, um tipo por linha.
  const legs = new Map<LegType, Fitting[]>();
  for (const f of fittings) if (f.kind === 'leg' && f.bom.qty) legs.set(f.type as LegType, [...(legs.get(f.type as LegType) ?? []), f]);
  for (const [type, list] of legs) {
    const key = `leg-${type}` as HardwareKey;
    if (!(key in HARDWARE)) continue;
    const qty = list.reduce((a, f) => a + f.bom.qty, 0);
    lines.push({ section: 'Ferragens', parts: [], price: { hardware: key }, label: HARDWARE[key].label, qty, unit: 'un', unitPrice: hw[key], total: qty * hw[key], note: `${LEGS[type].name}${list[0].materialId ? ` em ${materialOf(list[0].materialId).name.toLowerCase()}` : ''}` });
  }
  const hooks = fittings.filter((f) => f.kind === 'hook').reduce((a, f) => a + f.bom.qty, 0);
  if (hooks) lines.push({ section: 'Ferragens', parts: [], price: { hardware: 'hook' }, label: HARDWARE.hook.label, qty: hooks, unit: 'un', unitPrice: hw.hook, total: hooks * hw.hook });
  const led = r2(fittings.filter((f) => f.kind === 'led').reduce((a, f) => a + f.bom.qty, 0));
  if (led) lines.push({ section: 'Ferragens', parts: [], price: { hardware: 'led' }, label: HARDWARE.led.label, qty: led, unit: 'm', unitPrice: hw.led, total: led * hw.led });
  lines.push({
    section: 'Ferragens',
    parts: [],
    price: { key: 'moduleKit' },
    label: 'Kit de montagem',
    qty: moduleCount,
    unit: moduleCount === 1 ? 'módulo' : 'módulos',
    unitPrice: prices.moduleKit,
    total: moduleCount * prices.moduleKit,
    note: 'Cavilhas, minifix, parafusos e sapatas',
  });
  lines.push({
    section: 'Mão de obra',
    parts: [],
    price: { key: 'labourPerPart' },
    label: 'Corte e fita',
    qty: parts.length,
    unit: 'peças',
    unitPrice: prices.labourPerPart,
    total: parts.length * prices.labourPerPart,
  });
  lines.push({
    section: 'Mão de obra',
    parts: [],
    price: { key: 'labourPerModule' },
    label: 'Montagem',
    qty: moduleCount,
    unit: moduleCount === 1 ? 'módulo' : 'módulos',
    unitPrice: prices.labourPerModule,
    total: moduleCount * prices.labourPerModule,
  });
  if (fronts)
    lines.push({
      section: 'Mão de obra',
      parts: frontIds,
      price: { key: 'labourPerFront' },
      label: 'Regulagem de frentes',
      qty: fronts,
      unit: 'frentes',
      unitPrice: prices.labourPerFront,
      total: fronts * prices.labourPerFront,
    });
  // Frente com moldura, ripada, de quadro ou com cava, e painel ripado ou
  // perfurado: usinagem por peça. Quadro de aço é serralheria, não usinagem.
  const machined = [...doors, ...drawers, ...parts.filter((p) => p.kind === 'panel')].filter(
    (p) => (p.face && isSheet(p)) || p.handle?.type === 'groove' || p.handle?.type === 'cutout',
  );
  if (machined.length)
    lines.push({
      section: 'Mão de obra',
      parts: machined.map((p) => p.id),
      price: { hardware: 'machining' },
      label: HARDWARE.machining.label,
      qty: machined.length,
      unit: 'frentes',
      unitPrice: hw.machining,
      total: machined.length * hw.machining,
    });
  if (welded)
    lines.push({ section: 'Mão de obra', parts: [], price: { hardware: 'weld' }, label: HARDWARE.weld.label, qty: r2(welded), unit: 'm', unitPrice: hw.weld, total: welded * hw.weld });
  for (const line of lines) {
    line.total = Math.round(line.total * 100) / 100;
    line.key = `${line.section}|${line.label}`;
  }
  const sections = QUOTE_SECTIONS
    .map((section) => ({
      section,
      total: lines.filter((l) => l.section === section).reduce((a, l) => a + l.total, 0),
    }))
    .filter((s) => s.total > 0);
  const cost = Math.round(lines.reduce((a, l) => a + l.total, 0) * 100) / 100;
  const marginValue = Math.round(cost * prices.margin) / 100;
  const computed: Quote = {
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
    removed: [],
    adjusted: 0,
  };
  return adjust ? adjustQuote(computed, adjust, prices.margin) : computed;
}

/** "em latão" quando todos os puxadores da linha têm o mesmo acabamento. */
function materialNote(fittings: readonly Fitting[], ids: string[]) {
  const set = new Set(fittings.filter((f) => f.kind === 'handle' && f.attach && ids.includes(f.attach) && f.materialId).map((f) => f.materialId!));
  return set.size === 1 ? `em ${materialOf([...set][0]).name.toLowerCase()}` : undefined;
}

/** Orçamento de um projeto inteiro: peças, ferragens e a tabela de preços. */
export function quoteOf(d: Composition, prices: Prices, adjust?: QuoteAdjust) {
  const parts = generateComposition(d, false).parts;
  return quote(parts, d.modules.length, prices, fittingsOf(d, parts), adjust);
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function money(value: number) {
  return brl.format(value);
}

/** Quantidade com a vírgula de casa: 4,66 m de tubo, 0,023 m³ de maciço. */
const amount = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
export function quantity(value: number) {
  return amount.format(value);
}
