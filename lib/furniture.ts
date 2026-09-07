import { z } from 'zod';
export const materials = [
  { id: 'white', name: 'Branco fosco', color: '#ecece6', thickness: 18 },
  { id: 'oak', name: 'Carvalho natural', color: '#bd925c', thickness: 18 },
  { id: 'graphite', name: 'Grafite', color: '#4b5055', thickness: 18 },
] as const;
export const paramsSchema = z
  .object({
    width: z.number().min(300).max(1200),
    height: z.number().min(400).max(2400),
    depth: z.number().min(200).max(600),
    shelfCount: z.number().int().min(0).max(8),
    materialId: z.enum(['white', 'oak', 'graphite']),
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
  id: string;
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
export function generate(input: Params) {
  const p = paramsSchema.parse(input),
    t = 18,
    b = 6,
    w = p.width,
    h = p.height,
    d = p.depth - b,
    inner = w - 2 * t,
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
  const mat = materials.find((m) => m.id === p.materialId)!;
  const edge = `${mat.name} 0.4`;
  const parts: Part[] = [];
  const add = (
    id: string,
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
  add(
    'left',
    'Lateral esquerda',
    [t, h, d],
    [-w / 2 + t / 2, h / 2, b / 2],
    h,
    d,
  );
  add(
    'right',
    'Lateral direita',
    [t, h, d],
    [w / 2 - t / 2, h / 2, b / 2],
    h,
    d,
  );
  add('base', 'Base', [inner, t, d], [0, t / 2, b / 2], inner, d);
  add('top', 'Tampo', [inner, t, d], [0, h - t / 2, b / 2], inner, d);
  add(
    'back',
    'Fundo sobreposto',
    [w, h, b],
    [0, h / 2, -p.depth / 2 + b / 2],
    h,
    w,
    6,
    false,
  );
  let y = t;
  for (let i = 0; i < n; i++) {
    y += openings[i];
    add(
      `shelf-${i + 1}`,
      `Prateleira ${i + 1}`,
      [inner - 2, t, d - 10],
      [0, y + t / 2, b / 2 + 5],
      inner - 2,
      d - 10,
    );
    y += t;
  }
  return {
    parts,
    openings,
    warnings: [
      ...(inner > 800
        ? ['Vão acima de 800 mm: revisar flecha e carga com um marceneiro.']
        : []),
      'Perfil demonstrativo: fixações, carga, estabilidade e desconto de fita precisam de revisão antes da fabricação.',
    ],
    area: parts.reduce((a, v) => a + (v.c * v.l) / 1e6, 0),
  };
}
export function cutCSV(p: Params) {
  const quote = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
  const rows = generate(p).parts.map((v) => [
    v.id,
    v.name,
    1,
    v.c,
    v.l,
    v.thickness,
    v.material,
    v.edges.c1 ?? '',
    v.edges.c2 ?? '',
    v.edges.l1 ?? '',
    v.edges.l2 ?? '',
  ]);
  return (
    '\uFEFF' +
    [
      [
        'ID',
        'Peça',
        'Quantidade',
        'C (mm)',
        'L (mm)',
        'Espessura (mm)',
        'Material',
        'C1',
        'C2',
        'L1',
        'L2',
      ],
      ...rows,
    ]
      .map((r) => r.map(quote).join(';'))
      .join('\r\n')
  );
}
export function cortecloud(p: Params) {
  return {
    parts: generate(p).parts.map((v) => ({
      quantity: 1,
      c: v.c,
      l: v.l,
      function: v.name,
      complement: 'Merce - Estante',
      ...v.edges,
      material: v.material,
      machining: null,
    })),
  };
}
