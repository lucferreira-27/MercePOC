import { z } from 'zod';
import type { HandleType } from './look';
/**
 * Categoria diz como o material é comprado e cortado, e onde ele pode ir:
 * - `sheet`: chapa de MDF 2750 × 1840 (corpo, frentes, fundos, prateleiras),
 *   contada pelo plano de corte;
 * - `solid`: madeira maciça (tampo, prateleira aberta, pés), por m³;
 * - `metal`: aço e metais (pés, estrutura, puxadores, tela), por metro de tubo
 *   20 × 20 (ou m² de chapa, quando é tampo);
 * - `glass`, `stone`, `fiber`: vidro, pedra e palhinha, por m².
 */
export type MaterialCategory = 'sheet' | 'solid' | 'metal' | 'glass' | 'stone' | 'fiber';
export const CATEGORY_INFO: Record<MaterialCategory, { label: string; unit: string; price: string }> = {
  sheet: { label: 'Chapas (MDF)', unit: 'chapa', price: 'Chapa 18 mm · 2750 × 1840' },
  solid: { label: 'Madeira maciça', unit: 'm³', price: 'Por m³' },
  metal: { label: 'Metais', unit: 'm', price: 'Por metro de tubo 20 × 20' },
  glass: { label: 'Vidros', unit: 'm²', price: 'Por m²' },
  stone: { label: 'Pedras', unit: 'm²', price: 'Por m² (20 mm)' },
  fiber: { label: 'Palhinha', unit: 'm²', price: 'Por m²' },
};
/**
 * Acabamentos. `finish` diz como a superfície aparece: `wood` tem veio (trava
 * a rotação da peça no plano de corte e muda a textura da cena), `solid` é
 * liso, e metal, vidro, pedra e palhinha têm material próprio na cena.
 * `price` é o preço de partida na unidade da categoria (chapa 18 mm inteira,
 * m³, metro de tubo ou m²), em reais; quem orça troca no painel de orçamento.
 */
export const materials = [
  { id: 'white', name: 'Branco fosco', color: '#ecece6', thickness: 18, finish: 'solid', category: 'sheet', price: 329 },
  { id: 'sand', name: 'Areia', color: '#d8ccb6', thickness: 18, finish: 'solid', category: 'sheet', price: 389 },
  { id: 'oak', name: 'Carvalho natural', color: '#bd925c', thickness: 18, finish: 'wood', category: 'sheet', price: 459 },
  { id: 'freijo', name: 'Freijó', color: '#a9773f', thickness: 18, finish: 'wood', category: 'sheet', price: 479 },
  { id: 'walnut', name: 'Nogueira', color: '#6f4b33', thickness: 18, finish: 'wood', category: 'sheet', price: 519 },
  { id: 'sage', name: 'Verde sálvia', color: '#98a68b', thickness: 18, finish: 'solid', category: 'sheet', price: 419 },
  { id: 'petrol', name: 'Azul petróleo', color: '#2f5561', thickness: 18, finish: 'solid', category: 'sheet', price: 419 },
  { id: 'graphite', name: 'Grafite', color: '#4b5055', thickness: 18, finish: 'solid', category: 'sheet', price: 399 },
  { id: 'black', name: 'Preto fosco', color: '#27292b', thickness: 18, finish: 'solid', category: 'sheet', price: 409 },
  { id: 'pine', name: 'Pinus', color: '#d6b37c', thickness: 18, finish: 'wood', category: 'sheet', price: 389 },
  { id: 'ash', name: 'Freixo', color: '#d4c09c', thickness: 18, finish: 'wood', category: 'sheet', price: 489 },
  { id: 'smoked', name: 'Carvalho defumado', color: '#4d3a2c', thickness: 18, finish: 'wood', category: 'sheet', price: 549 },
  { id: 'oak-solid', name: 'Carvalho maciço', color: '#b88a56', thickness: 30, finish: 'wood', category: 'solid', price: 14500 },
  { id: 'walnut-solid', name: 'Nogueira maciça', color: '#694530', thickness: 30, finish: 'wood', category: 'solid', price: 19500 },
  { id: 'freijo-solid', name: 'Freijó maciço', color: '#a27040', thickness: 30, finish: 'wood', category: 'solid', price: 12500 },
  { id: 'pine-solid', name: 'Pinus maciço', color: '#d2ad74', thickness: 30, finish: 'wood', category: 'solid', price: 4800 },
  { id: 'ash-solid', name: 'Freixo maciço', color: '#cfba94', thickness: 30, finish: 'wood', category: 'solid', price: 13500 },
  { id: 'smoked-solid', name: 'Defumado maciço', color: '#4a3729', thickness: 30, finish: 'wood', category: 'solid', price: 16500 },
  { id: 'steel-black', name: 'Aço preto', color: '#2a2b2d', thickness: 2, finish: 'metal', category: 'metal', price: 42 },
  { id: 'steel-brushed', name: 'Aço escovado', color: '#b9bfc5', thickness: 2, finish: 'metal', category: 'metal', price: 68 },
  { id: 'brass', name: 'Latão', color: '#c7a14b', thickness: 2, finish: 'metal', category: 'metal', price: 150 },
  { id: 'bronze', name: 'Bronze', color: '#86653f', thickness: 2, finish: 'metal', category: 'metal', price: 130 },
  { id: 'glass-clear', name: 'Vidro incolor', color: '#d6e5e6', thickness: 4, finish: 'glass', category: 'glass', price: 260 },
  { id: 'glass-smoked', name: 'Vidro fumê', color: '#5a5f61', thickness: 4, finish: 'glass', category: 'glass', price: 320 },
  { id: 'glass-ribbed', name: 'Vidro canelado', color: '#cddbdb', thickness: 4, finish: 'glass', category: 'glass', price: 420 },
  { id: 'marble', name: 'Mármore branco', color: '#e9e6e0', thickness: 20, finish: 'stone', category: 'stone', price: 1100 },
  { id: 'nero', name: 'Mármore Nero', color: '#222224', thickness: 20, finish: 'stone', category: 'stone', price: 1500 },
  { id: 'travertine', name: 'Travertino', color: '#d6c4a4', thickness: 20, finish: 'stone', category: 'stone', price: 950 },
  { id: 'cane', name: 'Palhinha', color: '#d8bd89', thickness: 3, finish: 'cane', category: 'fiber', price: 140 },
] as const;
export type MaterialId = (typeof materials)[number]['id'];
export type Material = (typeof materials)[number];
/** Chapa de MDF: o que o corpo, as frentes e o fundo aceitam. */
export type SheetId = Extract<Material, { category: 'sheet' }>['id'];
/** Ids para `z.enum`: uma lista só, e o contrato da IA acompanha sozinho. */
export const materialIds = materials.map((m) => m.id) as [MaterialId, ...MaterialId[]];
export function materialOf(id: string) {
  return materials.find((m) => m.id === id) ?? materials[0];
}
export function categoryOf(id: string): MaterialCategory {
  return (materials.find((m) => m.id === id)?.category ?? 'sheet') as MaterialCategory;
}
/** Ids de uma ou mais categorias, na ordem do catálogo. */
export function idsOf(...categories: MaterialCategory[]): MaterialId[] {
  return materials.filter((m) => categories.includes(m.category)).map((m) => m.id);
}
export const sheetIds = idsOf('sheet') as SheetId[];
export const paramsSchema = z
  .object({
    width: z.number().min(300).max(1200),
    height: z.number().min(400).max(2400),
    depth: z.number().min(200).max(600),
    shelfCount: z.number().int().min(0).max(8),
    materialId: z.enum(materialIds),
    bottomOpening: z.number().min(100).max(1500).nullable(),
  })
  .strict();
export type Params = z.infer<typeof paramsSchema>;
export const defaults: Params = {
  width: 800,
  height: 1800,
  depth: 350,
  shelfCount: 4,
  materialId: 'oak',
  bottomOpening: null,
};
/**
 * Tipos de peça. Os de caixa vêm da v3; `slab` é o tampo sobreposto (pedra,
 * madeira maciça, vidro, metal ou MDF) que corre por cima de uma fileira,
 * `plinth` o rodapé ou a base aparente, `cornice` a moldura do topo e
 * `insert` o vidro, a tela ou a palhinha dentro do quadro de uma porta.
 */
export type PartKind =
  | 'side'
  | 'base'
  | 'top'
  | 'back'
  | 'shelf'
  | 'divider'
  | 'door'
  | 'drawer'
  | 'panel'
  | 'slab'
  | 'plinth'
  | 'cornice'
  | 'insert';
export const PART_KINDS: PartKind[] = ['side', 'base', 'top', 'back', 'shelf', 'divider', 'door', 'drawer', 'panel', 'slab', 'plinth', 'cornice', 'insert'];
/**
 * Superfície da peça além da caixa lisa, para a cena e os desenhos: frente
 * com moldura (shaker), ripada, quadro vazado para vidro, tela ou palhinha, e
 * borda boleada ou chanfrada do tampo. A peça continua uma só na lista de corte.
 */
export type Face =
  | { kind: 'shaker'; frame: number }
  | { kind: 'slatted'; pitch: number }
  | { kind: 'frame'; frame: number }
  | { kind: 'edge'; profile: 'rounded' | 'chamfer'; radius: number };
export type Part = {
  rotation?: number;
  color?: string;
  owners?: string[];
  cellId?: string;
  /** Material do catálogo; o rótulo `material` junta o nome e a espessura. */
  materialId?: MaterialId;
  category?: MaterialCategory;
  face?: Face;
  /** Puxador da frente (porta ou gaveta): tipo e acabamento. */
  handle?: { type: HandleType; materialId: MaterialId };
  /**
   * Giro em torno do eixo x da peça (rad), depois do giro vertical: só a
   * basculante aberta tem. A caixa de colisão é a envolvente da peça girada.
   */
  tilt?: number;
  /** Só desenho (o miolo do shaker, a junta do ripado): a cena 3D tem a forma de verdade. */
  decal?: boolean;
  id: string;
  kind: PartKind;
  name: string;
  size: [number, number, number];
  position: [number, number, number];
  c: number;
  l: number;
  thickness: number;
  material: string;
  edges: {
    c1: string | null;
    c2: string | null;
    l1: string | null;
    l2: string | null;
  };
};
export function buildParts(o: {
  width: number;
  height: number;
  depth: number;
  materialId: MaterialId;
  shelfIds: string[];
  elevations: number[];
  openings: number[];
}) {
  const t = 18,
    b = 6,
    w = o.width,
    h = o.height,
    d = o.depth - b,
    inner = w - 2 * t;
  const mat = materials.find((m) => m.id === o.materialId)!;
  const edge = `${mat.name} 0.4`;
  const parts: Part[] = [];
  const add = (
    id: string,
    kind: Part['kind'],
    name: string,
    size: Part['size'],
    position: Part['position'],
    c: number,
    l: number,
    thickness = 18,
    front = true,
  ) =>
    parts.push({
      id,
      kind,
      name,
      size,
      position,
      c,
      l,
      thickness,
      material: `${mat.name} ${thickness}`,
      edges: { c1: front ? edge : null, c2: null, l1: null, l2: null },
    });
  // Origin: centre in X/Z, floor in Y. Front is +Z. C1 is the front long edge.
  add('left', 'side', 'Lateral esquerda', [t, h, d], [-w / 2 + t / 2, h / 2, b / 2], h, d);
  add('right', 'side', 'Lateral direita', [t, h, d], [w / 2 - t / 2, h / 2, b / 2], h, d);
  add('base', 'base', 'Base', [inner, t, d], [0, t / 2, b / 2], inner, d);
  add('top', 'top', 'Tampo', [inner, t, d], [0, h - t / 2, b / 2], inner, d);
  add('back', 'back', 'Fundo sobreposto', [w, h, b], [0, h / 2, -o.depth / 2 + b / 2], h, w, 6, false);
  for (let i = 0; i < o.shelfIds.length; i++) {
    const y = o.elevations[i];
    add(
      o.shelfIds[i],
      'shelf',
      `Prateleira ${i + 1}`,
      [inner - 2, t, d - 10],
      [0, y + t / 2, b / 2 + 5],
      inner - 2,
      d - 10,
    );
  }
  return {
    parts,
    openings: o.openings,
    warnings: [
      ...(inner > 800
        ? ['Vão acima de 800 mm: revisar flecha e carga com um marceneiro.']
        : []),
      'Perfil demonstrativo: fixações, carga, estabilidade e desconto de fita precisam de revisão antes da fabricação.',
    ],
    area: parts.reduce((a, v) => a + (v.c * v.l) / 1e6, 0),
  };
}
export function generate(input: Params) {
  const p = paramsSchema.parse(input),
    t = 18,
    h = p.height,
    n = p.shelfCount;
  const free = h - 2 * t - n * t;
  let openings = Array(n + 1).fill(free / (n + 1)) as number[];
  if (p.bottomOpening !== null) {
    if (n === 0)
      throw new Error(
        'Adicione uma prateleira antes de definir o vão inferior.',
      );
    openings = [
      p.bottomOpening,
      ...Array(n).fill((free - p.bottomOpening) / n),
    ];
  }
  if (openings.some((v) => v < 100))
    throw new Error(
      'Cada vão precisa de pelo menos 100 mm. Reduza as prateleiras ou aumente a altura.',
    );
  const elevations: number[] = [];
  let y = t;
  for (let i = 0; i < n; i++) {
    y += openings[i];
    elevations.push(y);
    y += t;
  }
  return buildParts({
    width: p.width,
    height: p.height,
    depth: p.depth,
    materialId: p.materialId,
    shelfIds: elevations.map((_, i) => `shelf-${i + 1}`),
    elevations,
    openings,
  });
}
