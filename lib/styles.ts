import { z } from 'zod';
import { generateComposition, setBoxHeight, settle, type Cell, type Composition, type Module } from './composition';
import { categoryOf, materialOf, type MaterialId } from './furniture';
import {
  CORNICE,
  describeLook,
  FRONTS,
  framedFront,
  HANDLES,
  LEGS,
  STYLE_IDS,
  type FrontStyle,
  type HandleType,
  type LegType,
  type Look,
  type StyleId,
  type TopSpec,
} from './look';

/**
 * Estilos do estúdio: industrial, anos 60, escandinavo, minimalista, rústico,
 * clássico e japandi. Um estilo é uma receita de acabamento por papel do
 * móvel (baixo, balcão, alto, aéreo, painel, prateleira): materiais, base,
 * puxador, frente, tampo e detalhes. `applyStyle` grava tudo explícito em cada
 * módulo (`look`, materiais, pés); o gerador nunca lê esta tabela, então mudar
 * um estilo aqui não mexe em projeto salvo nem no orçamento dele.
 */

/** O papel do módulo no móvel decide a base, o tampo e os detalhes. */
export type StyleRole = 'low' | 'counter' | 'tall' | 'wall' | 'panel' | 'ledge';

type Legs = { type: LegType; height: number; materialId?: MaterialId };
/** Acabamento de um papel. `doorFrame`: quadro de aço das portas (frente de quadro). */
type RoleLook = {
  legs?: Legs;
  front?: FrontStyle;
  insert?: MaterialId;
  doorFrame?: MaterialId;
  handle?: HandleType;
  handleMaterial?: MaterialId;
  top?: TopSpec;
  cornice?: boolean;
  /** Contorno de aço na caixa. */
  frame?: MaterialId;
  /** Fundo em outra cor (só aparece em nicho aberto). */
  back?: MaterialId;
  led?: boolean;
};

export type StyleDef = {
  id: StyleId;
  name: string;
  /** Como entra numa frase: "no estilo anos 60". */
  label: string;
  /** Uma linha para a galeria, o cartão de mudança e a IA. */
  summary: string;
  /** Palavras que a pessoa usa para pedir o estilo. */
  keywords: string[];
  palette: { body: MaterialId; front: MaterialId; panel: MaterialId; ledge: MaterialId };
  /** O que vale para todo papel; cada papel sobrepõe o seu. */
  base: RoleLook;
  roles: Record<'low' | 'counter' | 'tall' | 'wall', RoleLook>;
  panel: { front: 'flat' | 'slatted' };
  /** Proporção dos móveis novos (fator na altura e na largura padrão do ativo). */
  proportions?: { low?: { height?: number; width?: number }; tall?: { height?: number } };
  /** Estante aberta, sem portas (escandinavo, japandi). */
  airy?: boolean;
};

const steel: MaterialId = 'steel-black';

export const STYLES: Record<StyleId, StyleDef> = {
  industrial: {
    id: 'industrial',
    name: 'Industrial',
    label: 'industrial',
    summary: 'Carvalho e aço preto: contorno de metalon, pé de tubo, portas de tela em quadro de aço e puxador barra',
    keywords: ['industrial', 'loft', 'ferro', 'metalon', 'serralheria', 'urbano', 'galpão'],
    palette: { body: 'oak', front: 'oak', panel: 'smoked', ledge: 'oak-solid' },
    base: { front: 'mesh', insert: steel, doorFrame: steel, handle: 'bar', handleMaterial: steel, frame: steel },
    roles: {
      low: { legs: { type: 'tube', height: 100, materialId: steel } },
      tall: { legs: { type: 'tube', height: 100, materialId: steel } },
      // Balcão de cozinha: porta lisa de madeira, tampo maciço de bancada.
      counter: { legs: { type: 'tube', height: 100, materialId: steel }, front: 'flat', insert: undefined, doorFrame: undefined, top: { materialId: 'oak-solid', thickness: 40, overhang: 20, edge: 'square' } },
      wall: { front: 'glass', insert: 'glass-smoked' },
    },
    panel: { front: 'flat' },
  },
  midcentury: {
    id: 'midcentury',
    name: 'Anos 60',
    label: 'anos 60',
    summary: 'Nogueira sobre pé palito inclinado, puxador recortado na frente, proporção baixa e comprida',
    keywords: ['anos 60', 'anos 50', 'mid-century', 'midcentury', 'retrô', 'retro', 'vintage', 'pé palito', 'modernista'],
    palette: { body: 'walnut', front: 'walnut', panel: 'freijo', ledge: 'walnut-solid' },
    base: { front: 'flat', handle: 'cutout' },
    roles: {
      low: { legs: { type: 'splayed', height: 200, materialId: 'walnut-solid' } },
      tall: { legs: { type: 'splayed', height: 150, materialId: 'walnut-solid' }, back: 'petrol' },
      counter: { legs: { type: 'plinth', height: 100 }, top: { materialId: 'marble', thickness: 20, overhang: 20, edge: 'square' } },
      wall: {},
    },
    panel: { front: 'slatted' },
    proportions: { low: { height: 0.9, width: 1.1 } },
  },
  scandinavian: {
    id: 'scandinavian',
    name: 'Escandinavo',
    label: 'escandinavo',
    summary: 'Branco com madeira clara: pé cônico de freixo, puxador botão de madeira, estante aberta e linhas limpas',
    keywords: ['escandinavo', 'escandinava', 'nórdico', 'nórdica', 'nordico', 'nordica', 'scandi', 'hygge', 'madeira clara'],
    palette: { body: 'white', front: 'white', panel: 'ash', ledge: 'ash-solid' },
    base: { front: 'flat', handle: 'knob', handleMaterial: 'ash-solid' },
    roles: {
      low: { legs: { type: 'tapered', height: 150, materialId: 'ash-solid' } },
      tall: { legs: { type: 'tapered', height: 100, materialId: 'ash-solid' }, back: 'sage' },
      counter: { legs: { type: 'plinth', height: 100 }, top: { materialId: 'ash-solid', thickness: 30, overhang: 20, edge: 'rounded' } },
      wall: {},
    },
    panel: { front: 'flat' },
    airy: true,
  },
  minimalist: {
    id: 'minimalist',
    name: 'Minimalista',
    label: 'minimalista',
    summary: 'Grafite liso, cava no lugar do puxador, rodapé recuado, LED nos nichos, correr e basculante no armário',
    keywords: ['minimalista', 'contemporâneo', 'contemporânea', 'contemporaneo', 'contemporanea', 'moderno', 'moderna', 'sem puxador', 'clean'],
    palette: { body: 'graphite', front: 'graphite', panel: 'graphite', ledge: 'graphite' },
    base: { front: 'flat', handle: 'groove' },
    roles: {
      low: { legs: { type: 'plinth', height: 80 } },
      tall: { legs: { type: 'plinth', height: 80 }, led: true },
      counter: { legs: { type: 'plinth', height: 100 }, top: { materialId: 'marble', thickness: 20, overhang: 10, edge: 'square' } },
      wall: { handle: 'none', led: true },
    },
    panel: { front: 'flat' },
  },
  rustic: {
    id: 'rustic',
    name: 'Rústico',
    label: 'rústico',
    summary: 'Pinus com frente de moldura, tampo maciço grosso, pé quadrado e puxador concha de bronze',
    keywords: ['rústico', 'rústica', 'rustico', 'rustica', 'fazenda', 'country', 'casa de campo', 'farmhouse', 'demolição'],
    palette: { body: 'pine', front: 'pine', panel: 'pine', ledge: 'pine-solid' },
    base: { front: 'shaker', handle: 'cup', handleMaterial: 'bronze' },
    roles: {
      low: { legs: { type: 'block', height: 100, materialId: 'pine-solid' }, top: { materialId: 'pine-solid', thickness: 40, overhang: 20, edge: 'square' } },
      tall: { legs: { type: 'skirt', height: 100 } },
      counter: { legs: { type: 'skirt', height: 100 }, top: { materialId: 'pine-solid', thickness: 40, overhang: 20, edge: 'square' } },
      wall: {},
    },
    panel: { front: 'slatted' },
  },
  classic: {
    id: 'classic',
    name: 'Clássico',
    label: 'clássico',
    summary: 'Creme com frente de moldura, puxador botão de latão, pé bola, tampo de mármore e moldura no topo',
    keywords: ['clássico', 'clássica', 'classico', 'classica', 'provençal', 'provencal', 'tradicional', 'colonial', 'francês', 'frances'],
    palette: { body: 'sand', front: 'sand', panel: 'sand', ledge: 'sand' },
    base: { front: 'shaker', handle: 'knob', handleMaterial: 'brass' },
    roles: {
      low: { legs: { type: 'bun', height: 80, materialId: 'sand' }, top: { materialId: 'marble', thickness: 20, overhang: 15, edge: 'rounded' } },
      tall: { legs: { type: 'skirt', height: 100 }, cornice: true },
      counter: { legs: { type: 'skirt', height: 100 }, top: { materialId: 'marble', thickness: 30, overhang: 20, edge: 'rounded' } },
      wall: { cornice: true },
    },
    panel: { front: 'flat' },
  },
  japandi: {
    id: 'japandi',
    name: 'Japandi',
    label: 'japandi',
    summary: 'Freixo ripado sobre base baixa de madeira escura, sem puxador aparente, estante aberta e proporção baixa',
    keywords: ['japandi', 'japonês', 'japonesa', 'japones', 'zen', 'wabi-sabi', 'ripado', 'ripada', 'oriental'],
    palette: { body: 'ash', front: 'ash', panel: 'smoked', ledge: 'smoked-solid' },
    base: { front: 'slatted', handle: 'none' },
    roles: {
      low: { legs: { type: 'block', height: 60, materialId: 'smoked-solid' } },
      tall: { legs: { type: 'block', height: 60, materialId: 'smoked-solid' } },
      counter: { legs: { type: 'plinth', height: 100 }, top: { materialId: 'travertine', thickness: 20, overhang: 15, edge: 'square' } },
      wall: {},
    },
    panel: { front: 'slatted' },
    proportions: { low: { height: 0.85 }, tall: { height: 0.9 } },
    airy: true,
  },
};

/** O acabamento de um papel no estilo: o comum com o do papel por cima. */
export function roleLook(style: StyleId, role: 'low' | 'counter' | 'tall' | 'wall'): RoleLook {
  const s = STYLES[style];
  return { ...s.base, ...s.roles[role] };
}

/** Quanto o topo do estilo avança para os lados (tampo ou moldura), em mm. */
export function styleReach(style: StyleId | undefined, role: 'low' | 'counter' | 'tall' | 'wall') {
  if (!style) return 0;
  const look = roleLook(style, role);
  return Math.max(look.top?.overhang ?? 0, look.cornice ? CORNICE.capReach : 0);
}

/** Pés que o estilo dá a um móvel novo (o ativo monta já com a altura certa). */
export function styleFeet(style: StyleId, role: 'low' | 'counter' | 'tall') {
  return roleLook(style, role).legs?.height ?? 0;
}

const corniceHeight = CORNICE.fascia + CORNICE.cap;
/** Do piso (ou da base do módulo suspenso) ao topo: pés, caixa, tampo e moldura. */
function outer(m: Module) {
  return (m.feet ?? 0) + m.height + (m.look?.top?.thickness ?? 0) + (m.look?.cornice ? corniceHeight : 0);
}

/**
 * Papel do módulo: painel e prateleira de parede pelo tipo; suspenso (ou
 * fora do piso sem estar em cima de outro) é aéreo; no piso, pela altura do
 * chão ao topo: alto a partir de 1,2 m, balcão quando fundo (52 cm ou mais)
 * na altura de bancada, baixo no resto. Quem está em cima de outro móvel
 * conta a altura a partir do chão.
 */
export function roleOf(d: Composition, m: Module): StyleRole {
  if (m.kind === 'panel') return 'panel';
  if (m.kind === 'ledge') return 'ledge';
  const onTop = d.connections.some((c) => c.side === 'top' && c.child === m.id);
  if (m.wall || (!onTop && m.position[1] > 1)) return 'wall';
  const top = m.position[1] + outer(m);
  if (top >= 1200) return 'tall';
  if (m.depth >= 520 && top >= 780 && top <= 1000) return 'counter';
  return 'low';
}

/** Fileiras de painel compartilhado (lado a lado): base, altura e corpo são os mesmos. */
function rowsOf(d: Composition, ids?: string[]) {
  const wanted = new Set(ids ?? d.modules.map((m) => m.id));
  for (const id of wanted) if (!d.modules.some((m) => m.id === id)) throw new Error(`Módulo ${id} não encontrado.`);
  const seen = new Set<string>();
  const rows: string[][] = [];
  for (const m of d.modules) {
    if (seen.has(m.id) || !wanted.has(m.id)) continue;
    const row = new Set([m.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const c of d.connections.filter((c) => c.shared && c.side !== 'top'))
        for (const [a, b] of [
          [c.parent, c.child],
          [c.child, c.parent],
        ])
          if (row.has(a) && !row.has(b)) {
            row.add(b);
            grew = true;
          }
    }
    for (const id of row) seen.add(id);
    // A fileira na ordem do projeto, para o primeiro decidir o papel.
    rows.push(d.modules.filter((v) => row.has(v.id)).map((v) => v.id));
  }
  return rows;
}

function cells(node: Cell, fn: (c: Cell) => void) {
  fn(node);
  if (node.split) node.split.children.forEach((c) => cells(c, fn));
}

export type StyleOptions = {
  /** Só estes módulos (e quem divide painel com eles); ausente, o projeto todo. */
  ids?: string[];
  /** Corpo e frentes que a pessoa escolheu: o estilo não troca. */
  body?: MaterialId;
  front?: MaterialId;
  /** Mantém os materiais de corpo e frente de cada módulo; só a forma muda. */
  keepMaterials?: boolean;
  /** Altura dos pés pedida pela pessoa (0 tira): vale no lugar da do estilo. */
  feet?: number;
};

type Attempt = { legs: Legs | null; top: TopSpec | null; front: FrontStyle | undefined };

/**
 * Veste o projeto (ou só os módulos pedidos) no estilo. Função pura: devolve
 * a composição nova, validada. O envelope de cada módulo fica: a caixa cede
 * a altura que o pé, o tampo ou a moldura ganham, então o móvel não cresce
 * nem encolhe. Fileira de painel compartilhado muda junta. Quando a medida
 * não comporta o acabamento (caixa baixa demais para o pé, porta pequena
 * para o quadro), o estilo recua um passo de cada vez: pé na altura mínima
 * do tipo, sem tampo, base de antes, frente lisa.
 */
export function applyStyle(input: Composition, style: StyleId, opts: StyleOptions = {}): Composition {
  const s = STYLES[style];
  const d: Composition = structuredClone(input);
  settle(d);
  const rows = rowsOf(d, opts.ids);
  for (const row of rows) restyleRow(d, s, row, opts);
  const everything = rows.flat().length === d.modules.length;
  if (everything) d.style = style;
  generateComposition(d);
  return d;
}

function restyleRow(d: Composition, s: StyleDef, ids: string[], opts: StyleOptions) {
  const mods = ids.map((id) => d.modules.find((m) => m.id === id)!);
  const role = roleOf(d, mods[0]);
  const body = (m: Module, fallback: MaterialId) => (opts.keepMaterials ? m.materialId : (opts.body ?? fallback));
  if (role === 'panel' || role === 'ledge') {
    for (const m of mods) {
      const keep = opts.keepMaterials && (role === 'ledge' || categoryOf(m.materialId) === 'sheet');
      if (!keep) m.materialId = role === 'panel' ? s.palette.panel : (opts.body && categoryOf(opts.body) !== 'metal' ? opts.body : s.palette.ledge);
      if (role === 'panel') m.look = { front: s.panel.front };
      else delete m.look;
    }
    generateComposition(d);
    return;
  }
  const plan = roleLook(s.id, role);
  const onTop = mods.some((m) => d.connections.some((c) => c.side === 'top' && c.child === m.id));
  const carries = mods.some((m) => d.connections.some((c) => c.side === 'top' && c.parent === m.id));
  // Envelope da fileira: do pé ao topo, o maior dela (são iguais quando válida).
  const envelope = Math.max(...mods.map(outer));
  const legsAllowed = role !== 'wall' && !onTop;
  const before = structuredClone(mods);
  const current: Legs | null = mods[0].feet ? { type: mods[0].look?.legs ?? 'palito', height: mods[0].feet, materialId: mods[0].look?.legMaterialId } : null;
  const asked = opts.feet === undefined ? undefined : opts.feet ? { ...(plan.legs ?? current ?? { type: 'palito' as const }), height: opts.feet } : null;
  const legChoices: (Legs | null)[] = !legsAllowed
    ? [null]
    : asked !== undefined
      ? [asked]
      : plan.legs
        ? [plan.legs, { ...plan.legs, height: LEGS[plan.legs.type].box![0] }, current]
        : [null, current];
  const topChoices: (TopSpec | null)[] = plan.top && !carries ? [plan.top, null] : [null];
  const attempts: Attempt[] = [];
  for (const top of topChoices) for (const legs of legChoices) attempts.push({ legs, top, front: plan.front });
  attempts.push({ legs: legChoices.at(-1) ?? null, top: null, front: 'flat' });
  let failure: Error | null = null;
  for (const attempt of attempts) {
    try {
      for (const m of mods) dress(m, s, plan, attempt, envelope, carries, body(m, s.palette.body), opts);
      generateComposition(d);
      return;
    } catch (e) {
      failure ??= e as Error;
      // Volta a fileira como estava e tenta o passo seguinte.
      mods.forEach((m, i) => Object.assign(m, structuredClone(before[i])));
      for (const m of mods) if (!before.find((b) => b.id === m.id)!.look) delete m.look;
      for (const m of mods) if (before.find((b) => b.id === m.id)!.feet === undefined) delete m.feet;
    }
  }
  throw new Error(`${STYLES[s.id].name} em ${mods.map((m) => m.name).join(', ')}: ${failure?.message ?? 'não coube'}`);
}

/** Um módulo no estilo, numa das tentativas. */
function dress(m: Module, s: StyleDef, plan: RoleLook, attempt: Attempt, envelope: number, carries: boolean, bodyMaterial: MaterialId, opts: StyleOptions) {
  const legs = attempt.legs;
  const cornice = !!plan.cornice && !carries;
  const top = attempt.top;
  const height = envelope - (legs?.height ?? 0) - (top?.thickness ?? 0) - (cornice ? corniceHeight : 0);
  if (height < 150) throw new Error('a caixa ficaria baixa demais para esse acabamento.');
  m.materialId = bodyMaterial;
  const front = attempt.front ?? 'flat';
  const insert = FRONTS[front].inserts ? (plan.insert ?? FRONTS[front].insertDefault) : undefined;
  const look: Look = {
    ...(legs ? { legs: legs.type, ...(legs.materialId && LEGS[legs.type].materials ? { legMaterialId: legs.materialId } : {}) } : {}),
    handle: plan.handle ?? 'bar',
    ...(plan.handleMaterial && HANDLES[plan.handle ?? 'bar'].materials ? { handleMaterialId: plan.handleMaterial } : {}),
    front,
    ...(insert ? { insertMaterialId: insert } : {}),
    ...(top ? { top } : {}),
    ...(cornice ? { cornice: true } : {}),
    ...(plan.frame ? { frame: true, frameMaterialId: plan.frame } : {}),
    ...(plan.back && m.back ? { backMaterialId: plan.back } : {}),
    ...(plan.led ? { led: true } : {}),
  };
  m.look = look;
  if (legs) m.feet = legs.height;
  else delete m.feet;
  setBoxHeight(m, height);
  // Frentes: material do estilo (ou o da pessoa), quadro de aço nas portas
  // quando a frente é de quadro, e sem os estilos e puxadores próprios de
  // cada frente: o estilo é um só no módulo.
  const steelDoors = !!plan.doorFrame && framedFront(front);
  cells(m.root, (c) => {
    const f = c.front;
    if (!f) return;
    delete f.style;
    delete f.handle;
    const door = f.type !== 'drawers';
    if (opts.keepMaterials) {
      // Aço que era quadro de porta só fica se a frente nova também é de quadro.
      const was = f.materialId ?? m.materialId;
      if (categoryOf(was) === 'metal' && !(door && framedFront(front))) f.materialId = s.palette.front;
      return;
    }
    f.materialId = door && steelDoors ? plan.doorFrame : (opts.front ?? opts.body ?? s.palette.front);
  });
}

/** Proporção de um móvel novo no estilo: o padrão do ativo escalado e dentro dos limites. */
export function styleProportion(style: StyleId, role: 'low' | 'counter' | 'tall') {
  const p = STYLES[style].proportions;
  if (role === 'tall') return { height: p?.tall?.height ?? 1, width: 1 };
  if (role === 'low') return { height: p?.low?.height ?? 1, width: p?.low?.width ?? 1 };
  return { height: 1, width: 1 };
}

/** O estilo em frases curtas para os chips da prévia e o cartão de mudança. */
export function styleChips(style: StyleId): string[] {
  const s = STYLES[style];
  const low = roleLook(style, 'low');
  const look: Look = {
    ...(low.legs ? { legs: low.legs.type, ...(low.legs.materialId ? { legMaterialId: low.legs.materialId } : {}) } : {}),
    handle: low.handle,
    ...(low.handleMaterial ? { handleMaterialId: low.handleMaterial } : {}),
    front: low.front,
    ...(low.insert ? { insertMaterialId: low.insert } : {}),
    ...(low.top ? { top: low.top } : {}),
    ...(low.frame ? { frame: true, frameMaterialId: low.frame } : {}),
  };
  return [materialOf(s.palette.body).name, ...describeLook({ look }).map((v) => v.replace(/ de \d+ mm/, ''))];
}

export const styleOpSchema = z
  .object({
    kind: z.literal('style.apply'),
    style: z.enum(STYLE_IDS),
    /** Módulos a vestir (a fileira de cada um vai junto); ausente, o projeto todo. */
    ids: z.array(z.string().min(1)).min(1).max(12).optional(),
    /** true: mantém corpo e frentes de cada módulo, só a forma muda. */
    keepMaterials: z.boolean().optional(),
  })
  .strict();
export type StyleOp = z.input<typeof styleOpSchema>;

export function applyStyleOp(d: Composition, raw: StyleOp): Composition {
  const op = styleOpSchema.parse(raw);
  return applyStyle(d, op.style, { ids: op.ids, keepMaterials: op.keepMaterials });
}

/** Estilo pelo id ou pelas palavras da pessoa ("anos 60", "nórdico"). */
export function styleFrom(text: string): StyleId | null {
  const norm = (v: string) => v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const t = norm(text);
  for (const s of Object.values(STYLES)) if (s.keywords.some((k) => t.includes(norm(k))) || t.includes(norm(s.name))) return s.id;
  return null;
}
