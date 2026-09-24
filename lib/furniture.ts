import { z } from 'zod';
/**
 * Acabamentos das chapas. `finish` diz se a chapa tem veio (madeira) ou é
 * lisa: o veio trava a rotação da peça no plano de corte e muda a textura da
 * cena 3D. `sheetPrice` é o preço de partida de uma chapa 18 mm de 2750 × 1840
 * mm, em reais; quem orça troca os valores no painel de orçamento.
 */
export const materials = [
  { id: 'white', name: 'Branco fosco', color: '#ecece6', thickness: 18, finish: 'solid', sheetPrice: 329 },
  { id: 'sand', name: 'Areia', color: '#d8ccb6', thickness: 18, finish: 'solid', sheetPrice: 389 },
  { id: 'oak', name: 'Carvalho natural', color: '#bd925c', thickness: 18, finish: 'wood', sheetPrice: 459 },
  { id: 'freijo', name: 'Freijó', color: '#a9773f', thickness: 18, finish: 'wood', sheetPrice: 479 },
  { id: 'walnut', name: 'Nogueira', color: '#6f4b33', thickness: 18, finish: 'wood', sheetPrice: 519 },
  { id: 'sage', name: 'Verde sálvia', color: '#98a68b', thickness: 18, finish: 'solid', sheetPrice: 419 },
  { id: 'petrol', name: 'Azul petróleo', color: '#2f5561', thickness: 18, finish: 'solid', sheetPrice: 419 },
  { id: 'graphite', name: 'Grafite', color: '#4b5055', thickness: 18, finish: 'solid', sheetPrice: 399 },
  { id: 'black', name: 'Preto fosco', color: '#27292b', thickness: 18, finish: 'solid', sheetPrice: 409 },
] as const;
export type MaterialId = (typeof materials)[number]['id'];
/** Ids para `z.enum`: uma lista só, e o contrato da IA acompanha sozinho. */
export const materialIds = materials.map((m) => m.id) as [MaterialId, ...MaterialId[]];
export function materialOf(id: string) {
  return materials.find((m) => m.id === id) ?? materials[0];
}
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
export type Part = {
  rotation?: number;
  color?: string;
  owners?: string[];
  cellId?: string;
  id: string;
  kind: 'side' | 'base' | 'top' | 'back' | 'shelf' | 'divider' | 'door' | 'drawer' | 'panel';
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
