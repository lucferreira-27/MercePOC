import { z } from 'zod';
import { generateComposition, setBoxHeight, settle, type Cell, type Composition, type Module } from './composition';
import { categoryOf, materialOf, type MaterialId } from './furniture';
import { DEFAULT_TABLE_BASE } from './tables';
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
 * clássico, japandi, boho, brasileiro, art déco, provençal e praiano (a
 * pesquisa dos cinco últimos está em docs/plans/more-styles.md). Um estilo é uma receita de acabamento por papel do
 * móvel (baixo, balcão, alto, aéreo, painel, prateleira): materiais, base,
 * puxador, frente, tampo e detalhes. `applyStyle` grava tudo explícito em cada
 * módulo (`look`, materiais, pés); o gerador nunca lê esta tabela, então mudar
 * um estilo aqui não mexe em projeto salvo nem no orçamento dele.
 */

/** O papel do módulo no móvel decide a base, o tampo e os detalhes. */
export type StyleRole = 'low' | 'counter' | 'tall' | 'wall' | 'table' | 'panel' | 'ledge';

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
  /** `accent`: a cor que marca o estilo na amostra (aço, petróleo, latão…). */
  palette: { body: MaterialId; front: MaterialId; panel: MaterialId; ledge: MaterialId; accent: MaterialId };
  /** O que vale para todo papel; cada papel sobrepõe o seu. */
  base: RoleLook;
  roles: Record<'low' | 'counter' | 'tall' | 'wall' | 'table', RoleLook>;
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
    palette: { body: 'oak', front: 'oak', panel: 'smoked', ledge: 'oak-solid', accent: steel },
    base: { front: 'mesh', insert: steel, doorFrame: steel, handle: 'bar', handleMaterial: steel, frame: steel },
    roles: {
      low: { legs: { type: 'tube', height: 100, materialId: steel } },
      tall: { legs: { type: 'tube', height: 100, materialId: steel } },
      // Balcão de cozinha: porta lisa de madeira, tampo maciço de bancada.
      counter: { legs: { type: 'tube', height: 100, materialId: steel }, front: 'flat', insert: undefined, doorFrame: undefined, top: { materialId: 'oak-solid', thickness: 40, overhang: 20, edge: 'square' } },
      wall: { front: 'glass', insert: 'glass-smoked' },
      table: { legs: { type: 'frame', height: 0, materialId: steel }, front: 'flat', top: { materialId: 'oak-solid', thickness: 40, overhang: 20, edge: 'square' } },
    },
    panel: { front: 'flat' },
  },
  midcentury: {
    id: 'midcentury',
    name: 'Anos 60',
    label: 'anos 60',
    summary: 'Nogueira sobre pé palito inclinado, puxador recortado na frente, proporção baixa e comprida',
    keywords: ['anos 60', 'anos 50', 'mid-century', 'midcentury', 'retrô', 'retro', 'vintage', 'pé palito', 'modernista'],
    palette: { body: 'walnut', front: 'walnut', panel: 'freijo', ledge: 'walnut-solid', accent: 'petrol' },
    base: { front: 'flat', handle: 'cutout' },
    roles: {
      low: { legs: { type: 'splayed', height: 200, materialId: 'walnut-solid' } },
      tall: { legs: { type: 'splayed', height: 150, materialId: 'walnut-solid' }, back: 'petrol' },
      counter: { legs: { type: 'plinth', height: 100 }, top: { materialId: 'marble', thickness: 20, overhang: 20, edge: 'square' } },
      wall: {},
      table: { legs: { type: 'splayed', height: 0, materialId: 'walnut-solid' }, top: { materialId: 'walnut-solid', thickness: 30, overhang: 30, edge: 'rounded' } },
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
    palette: { body: 'white', front: 'white', panel: 'ash', ledge: 'ash-solid', accent: 'ash-solid' },
    base: { front: 'flat', handle: 'knob', handleMaterial: 'ash-solid' },
    roles: {
      low: { legs: { type: 'tapered', height: 150, materialId: 'ash-solid' } },
      tall: { legs: { type: 'tapered', height: 100, materialId: 'ash-solid' }, back: 'sage' },
      counter: { legs: { type: 'plinth', height: 100 }, top: { materialId: 'ash-solid', thickness: 30, overhang: 20, edge: 'rounded' } },
      wall: {},
      table: { legs: { type: 'tapered', height: 0, materialId: 'ash-solid' }, top: { materialId: 'ash-solid', thickness: 30, overhang: 30, edge: 'rounded' } },
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
    palette: { body: 'graphite', front: 'graphite', panel: 'graphite', ledge: 'graphite', accent: 'marble' },
    base: { front: 'flat', handle: 'groove' },
    roles: {
      low: { legs: { type: 'plinth', height: 80 } },
      tall: { legs: { type: 'plinth', height: 80 }, led: true },
      counter: { legs: { type: 'plinth', height: 100 }, top: { materialId: 'marble', thickness: 20, overhang: 10, edge: 'square' } },
      wall: { handle: 'none', led: true },
      table: { legs: { type: 'sled', height: 0, materialId: steel }, top: { materialId: 'graphite', thickness: 25, overhang: 30, edge: 'square' } },
    },
    panel: { front: 'flat' },
  },
  rustic: {
    id: 'rustic',
    name: 'Rústico',
    label: 'rústico',
    summary: 'Pinus com frente de moldura, tampo maciço grosso, pé quadrado e puxador concha de bronze',
    keywords: ['rústico', 'rústica', 'rustico', 'rustica', 'fazenda', 'country', 'casa de campo', 'farmhouse', 'demolição'],
    palette: { body: 'pine', front: 'pine', panel: 'pine', ledge: 'pine-solid', accent: 'bronze' },
    base: { front: 'shaker', handle: 'cup', handleMaterial: 'bronze' },
    roles: {
      low: { legs: { type: 'block', height: 100, materialId: 'pine-solid' }, top: { materialId: 'pine-solid', thickness: 40, overhang: 20, edge: 'square' } },
      tall: { legs: { type: 'skirt', height: 100 } },
      counter: { legs: { type: 'skirt', height: 100 }, top: { materialId: 'pine-solid', thickness: 40, overhang: 20, edge: 'square' } },
      wall: {},
      table: { legs: { type: 'trestle', height: 0, materialId: 'pine-solid' }, top: { materialId: 'pine-solid', thickness: 40, overhang: 40, edge: 'square' } },
    },
    panel: { front: 'slatted' },
  },
  classic: {
    id: 'classic',
    name: 'Clássico',
    label: 'clássico',
    summary: 'Creme com frente de moldura, puxador botão de latão, pé bola, tampo de mármore e moldura no topo',
    keywords: ['clássico', 'clássica', 'classico', 'classica', 'tradicional', 'colonial', 'neoclássico', 'neoclassico'],
    palette: { body: 'sand', front: 'sand', panel: 'sand', ledge: 'sand', accent: 'brass' },
    base: { front: 'shaker', handle: 'knob', handleMaterial: 'brass' },
    roles: {
      low: { legs: { type: 'bun', height: 80, materialId: 'sand' }, top: { materialId: 'marble', thickness: 20, overhang: 15, edge: 'rounded' } },
      tall: { legs: { type: 'skirt', height: 100 }, cornice: true },
      counter: { legs: { type: 'skirt', height: 100 }, top: { materialId: 'marble', thickness: 30, overhang: 20, edge: 'rounded' } },
      wall: { cornice: true },
      table: { legs: { type: 'turned', height: 0, materialId: 'sand' }, top: { materialId: 'marble', thickness: 20, overhang: 30, edge: 'rounded' } },
    },
    panel: { front: 'flat' },
  },
  japandi: {
    id: 'japandi',
    name: 'Japandi',
    label: 'japandi',
    summary: 'Freixo ripado sobre base baixa de madeira escura, sem puxador aparente, estante aberta e proporção baixa',
    keywords: ['japandi', 'japonês', 'japonesa', 'japones', 'zen', 'wabi-sabi', 'ripado', 'ripada', 'oriental'],
    palette: { body: 'ash', front: 'ash', panel: 'smoked', ledge: 'smoked-solid', accent: 'smoked-solid' },
    base: { front: 'slatted', handle: 'none' },
    roles: {
      low: { legs: { type: 'block', height: 60, materialId: 'smoked-solid' } },
      tall: { legs: { type: 'block', height: 60, materialId: 'smoked-solid' } },
      counter: { legs: { type: 'plinth', height: 100 }, top: { materialId: 'travertine', thickness: 20, overhang: 15, edge: 'square' } },
      wall: {},
      table: { legs: { type: 'block', height: 0, materialId: 'smoked-solid' }, top: { materialId: 'ash-solid', thickness: 40, overhang: 25, edge: 'square' } },
    },
    panel: { front: 'slatted' },
    proportions: { low: { height: 0.85 }, tall: { height: 0.9 } },
    airy: true,
  },
  boho: {
    id: 'boho',
    name: 'Boho',
    label: 'boho',
    summary: 'Carvalho claro com portas de palhinha, alça de couro, pé cônico de madeira e fundo terracota na estante aberta',
    keywords: ['boho', 'boêmio', 'boêmia', 'boemio', 'boemia', 'rattan', 'ratan', 'de vime', 'em vime', 'fibra natural', 'étnico', 'étnica', 'etnico', 'etnica', 'hippie'],
    palette: { body: 'oak', front: 'oak', panel: 'terracotta', ledge: 'oak-solid', accent: 'terracotta' },
    base: { front: 'cane', insert: 'cane', handle: 'strap' },
    roles: {
      low: { legs: { type: 'tapered', height: 150, materialId: 'oak-solid' } },
      tall: { legs: { type: 'tapered', height: 100, materialId: 'oak-solid' }, back: 'terracotta' },
      counter: { legs: { type: 'plinth', height: 100 }, top: { materialId: 'oak-solid', thickness: 30, overhang: 20, edge: 'rounded' } },
      wall: {},
      table: { legs: { type: 'block', height: 0, materialId: 'oak-solid' }, top: { materialId: 'oak-solid', thickness: 40, overhang: 30, edge: 'rounded' } },
    },
    panel: { front: 'flat' },
    airy: true,
  },
  brazilian: {
    id: 'brazilian',
    name: 'Brasileiro',
    label: 'brasileiro moderno',
    summary: 'Freijó com palhinha, pé palito de madeira maciça, cava no lugar do puxador, proporção baixa e comprida',
    keywords: [
      'brasileiro',
      'brasileira',
      'modernismo brasileiro',
      'modernista brasileiro',
      'design brasileiro',
      'brasilidade',
      'tropical',
      'palhinha',
      'sergio rodrigues',
      'zanine',
      'tenreiro',
      'jacarandá',
      'jacaranda',
    ],
    palette: { body: 'freijo', front: 'freijo', panel: 'freijo', ledge: 'freijo-solid', accent: 'cane' },
    base: { front: 'cane', insert: 'cane', handle: 'groove' },
    roles: {
      low: { legs: { type: 'palito', height: 200, materialId: 'freijo-solid' } },
      tall: { legs: { type: 'palito', height: 150, materialId: 'freijo-solid' } },
      counter: { legs: { type: 'plinth', height: 100 }, top: { materialId: 'freijo-solid', thickness: 30, overhang: 20, edge: 'square' } },
      wall: {},
      table: { legs: { type: 'splayed', height: 0, materialId: 'freijo-solid' }, top: { materialId: 'freijo-solid', thickness: 30, overhang: 30, edge: 'rounded' } },
    },
    panel: { front: 'slatted' },
    proportions: { low: { height: 0.9, width: 1.1 } },
  },
  artdeco: {
    id: 'artdeco',
    name: 'Art déco',
    label: 'art déco',
    summary: 'Preto com latão: portas de vidro canelado, puxador barra e pé de latão, tampo de mármore chanfrado e LED na cristaleira',
    keywords: ['art déco', 'art deco', 'artdeco', 'glam', 'hollywood', 'gatsby', 'anos 20', 'anos 30', 'luxo', 'luxuoso', 'luxuosa'],
    palette: { body: 'black', front: 'black', panel: 'black', ledge: 'black', accent: 'brass' },
    base: { front: 'glass', insert: 'glass-ribbed', handle: 'bar', handleMaterial: 'brass' },
    roles: {
      low: { legs: { type: 'tube', height: 100, materialId: 'brass' }, top: { materialId: 'marble', thickness: 20, overhang: 15, edge: 'chamfer' } },
      tall: { legs: { type: 'tube', height: 100, materialId: 'brass' }, led: true },
      // Cozinha: porta lisa laqueada e bancada de mármore escuro.
      counter: { legs: { type: 'plinth', height: 100 }, front: 'flat', insert: undefined, top: { materialId: 'nero', thickness: 20, overhang: 15, edge: 'chamfer' } },
      wall: { led: true },
      table: { legs: { type: 'sled', height: 0, materialId: 'brass' }, top: { materialId: 'marble', thickness: 20, overhang: 30, edge: 'chamfer' } },
    },
    panel: { front: 'slatted' },
  },
  provencal: {
    id: 'provencal',
    name: 'Provençal',
    label: 'provençal',
    summary: 'Branco com portas de almofada, pé torneado, puxador botão de bronze, tampo de carvalho e moldura no topo do armário',
    keywords: ['provençal', 'provencal', 'francês', 'frances', 'francesa', 'campestre', 'romântico', 'romântica', 'romantico', 'romantica', 'shabby', 'pátina', 'patina'],
    palette: { body: 'white', front: 'white', panel: 'white', ledge: 'white', accent: 'sage' },
    base: { front: 'framed', insert: 'white', handle: 'knob', handleMaterial: 'bronze' },
    roles: {
      low: { legs: { type: 'turned', height: 150, materialId: 'white' }, top: { materialId: 'oak-solid', thickness: 30, overhang: 15, edge: 'rounded' } },
      tall: { legs: { type: 'skirt', height: 100 }, cornice: true, back: 'sage' },
      counter: { legs: { type: 'skirt', height: 100 }, top: { materialId: 'oak-solid', thickness: 30, overhang: 20, edge: 'rounded' } },
      wall: { cornice: true },
      table: { legs: { type: 'turned', height: 0, materialId: 'white' }, top: { materialId: 'oak-solid', thickness: 30, overhang: 30, edge: 'rounded' } },
    },
    panel: { front: 'flat' },
  },
  coastal: {
    id: 'coastal',
    name: 'Praiano',
    label: 'praiano',
    summary: 'Branco com frentes ripadas em azul claro, puxador botão de madeira, pé quadrado e tampo de freixo',
    keywords: ['praiano', 'praiana', 'praia', 'coastal', 'litorâneo', 'litorânea', 'litoraneo', 'litoranea', 'litoral', 'beira-mar', 'beira mar', 'navy', 'náutico', 'nautico', 'hamptons'],
    palette: { body: 'white', front: 'sky', panel: 'white', ledge: 'ash-solid', accent: 'sky' },
    base: { front: 'slatted', handle: 'knob', handleMaterial: 'ash-solid' },
    roles: {
      low: { legs: { type: 'block', height: 100, materialId: 'ash-solid' }, top: { materialId: 'ash-solid', thickness: 30, overhang: 15, edge: 'rounded' } },
      tall: { legs: { type: 'block', height: 80, materialId: 'ash-solid' } },
      counter: { legs: { type: 'plinth', height: 100 }, top: { materialId: 'ash-solid', thickness: 30, overhang: 20, edge: 'rounded' } },
      wall: {},
      table: { legs: { type: 'block', height: 0, materialId: 'ash-solid' }, top: { materialId: 'ash-solid', thickness: 30, overhang: 30, edge: 'rounded' } },
    },
    panel: { front: 'slatted' },
  },
};

/** O acabamento de um papel no estilo: o comum com o do papel por cima. */
export function roleLook(style: StyleId, role: 'low' | 'counter' | 'tall' | 'wall' | 'table'): RoleLook {
  const s = STYLES[style];
  return { ...s.base, ...s.roles[role] };
}

/** Pés que o estilo dá a um móvel novo (o ativo monta já com a altura certa). */
export function styleFeet(style: StyleId, role: 'low' | 'counter' | 'tall') {
  return roleLook(style, role).legs?.height ?? 0;
}

const corniceHeight = CORNICE.fascia + CORNICE.cap;
/** Do piso (ou da base do módulo suspenso) ao topo: pés, caixa, tampo e moldura. */
function outer(m: Module) {
  // Mesa: a altura já é a do tampo.
  if (m.kind === 'table') return m.height;
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
  if (m.kind === 'table') return 'table';
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
  if (role === 'table') {
    for (const m of mods) dressTable(m, s, opts);
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

/**
 * Mesa no estilo: base, tampo, puxador e cores. A altura é a do tampo, então
 * o envelope fica por construção. O que é função fica: rodízio (carrinho),
 * suporte de parede, estrutura de aço com níveis (estante aberta) e tampo de
 * vidro (penteadeira); nesses o estilo troca só o acabamento.
 */
function dressTable(m: Module, s: StyleDef, opts: StyleOptions) {
  const plan = roleLook(s.id, 'table');
  const current = m.look?.legs ?? DEFAULT_TABLE_BASE;
  const keep = current === 'casters' || current === 'wall' || (current === 'frame' && (m.shelves ?? 0) >= 2);
  const legs = keep ? current : (plan.legs?.type ?? current);
  const legMaterial = plan.legs?.materialId;
  const accepts = LEGS[legs].materials;
  const glass = m.look?.top && categoryOf(m.look.top.materialId) === 'glass';
  const front = plan.front && !framedFront(plan.front) && !FRONTS[plan.front].panelOnly ? plan.front : 'flat';
  if (!opts.keepMaterials) m.materialId = opts.body && ['sheet', 'solid'].includes(categoryOf(opts.body)) ? opts.body : s.palette.body;
  const handle = plan.handle ?? 'bar';
  m.look = {
    legs,
    ...(legMaterial && accepts?.includes(categoryOf(legMaterial)) ? { legMaterialId: legMaterial } : keep && m.look?.legMaterialId ? { legMaterialId: m.look.legMaterialId } : {}),
    handle,
    ...(plan.handleMaterial && HANDLES[handle].materials ? { handleMaterialId: plan.handleMaterial } : {}),
    front,
    ...(glass ? { top: m.look!.top } : plan.top ? { top: plan.top } : {}),
  };
}

/** Um módulo no estilo, numa das tentativas. */
function dress(m: Module, s: StyleDef, plan: RoleLook, attempt: Attempt, envelope: number, carries: boolean, bodyMaterial: MaterialId, opts: StyleOptions) {
  const legs = attempt.legs;
  const cornice = !!plan.cornice && !carries;
  const top = attempt.top;
  const height = envelope - (legs?.height ?? 0) - (top?.thickness ?? 0) - (cornice ? corniceHeight : 0);
  if (height < 150) throw new Error('a caixa ficaria baixa demais para esse acabamento.');
  m.materialId = bodyMaterial;
  // Tela, vidro, palhinha e almofada só aparecem em porta: módulo só de
  // gavetas (ou aberto) grava a moldura que ele mostra, e o estado diz a verdade.
  let doors = false;
  cells(m.root, (c) => {
    if (c.front && c.front.type !== 'drawers') doors = true;
  });
  const wanted = attempt.front ?? 'flat';
  const front = framedFront(wanted) && !doors ? 'shaker' : wanted;
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

/** Amostra do estilo: a cor do corpo e a que marca o estilo. */
export function styleSwatch(style: StyleId): [string, string] {
  const p = STYLES[style].palette;
  return [materialOf(p.body).color, materialOf(p.accent).color];
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
  const up = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
  return [materialOf(s.palette.body).name, ...describeLook({ look }).map(up)];
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

/**
 * Estilo pelo id ou pelas palavras da pessoa ("anos 60", "nórdico"). Vale a
 * palavra mais longa que aparece: "modernista brasileiro" é brasileiro, não
 * anos 60; no empate, a ordem da tabela.
 */
export function styleFrom(text: string): StyleId | null {
  const norm = (v: string) => v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const t = norm(text);
  let best: { id: StyleId; length: number } | null = null;
  for (const s of Object.values(STYLES))
    for (const k of [s.name, ...s.keywords].map(norm)) if (t.includes(k) && (!best || k.length > best.length)) best = { id: s.id, length: k.length };
  return best?.id ?? null;
}

/**
 * Os estilos para o prompt da IA, uma linha cada: id, nome e as palavras que
 * a pessoa usa. Sai da tabela, então estilo novo chega à IA sem mexer no prompt.
 */
export function styleCatalogForPrompt() {
  return Object.values(STYLES)
    .map((s) => `- ${s.id}: ${s.name}; pedidos como ${s.keywords.slice(0, 4).join(', ')}`)
    .join('\n');
}
