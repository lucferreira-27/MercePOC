import { z } from 'zod';
import {
  applyModularOp,
  generateComposition,
  preset,
  SCHEMA_VERSION,
  PROFILE,
  type Composition,
  type ModularOp,
} from './composition';
import { materialIds, type MaterialId } from './furniture';
import { STYLE_IDS, type Look, type StyleId } from './look';
import { TV_CLEARANCE_MM, type Room } from './room';
import { applyStyle, STYLES, styleFeet, styleProportion } from './styles';

/**
 * Biblioteca de móveis prontos. Cada ativo é uma receita paramétrica que monta
 * o móvel com as mesmas operações do chat e do editor (e passa pela mesma
 * validação): a IA parte de uma base que já parece um rack, uma cômoda ou uma
 * cozinha, e ajusta dali. Montar do zero continua possível.
 *
 * As medidas pedidas são o envelope do móvel (com pés, quando houver); cada
 * receita divide a largura em colunas que caibam no limite de 1200 mm por
 * módulo.
 */
export type AssetCategory = 'sala' | 'quarto' | 'cozinha' | 'escritorio' | 'servico';
export const CATEGORY_LABEL: Record<AssetCategory, string> = {
  sala: 'Sala',
  quarto: 'Quarto',
  cozinha: 'Cozinha e banheiro',
  escritorio: 'Escritório',
  servico: 'Entrada e serviço',
};
export type AssetSize = { width: number; height: number; depth: number };
export type AssetInput = AssetSize & {
  body: MaterialId;
  front: MaterialId;
  /** Altura dos pés em mm (0 = sem pés). Só vale para quem aceita pés. */
  feet: number;
  /** Estilo do móvel: a receita adapta a estrutura e `applyStyle` veste. */
  style?: StyleId;
};
/**
 * Papel principal do ativo para o estilo: decide a altura dos pés com que a
 * receita monta e a proporção do móvel novo (anos 60 baixo e comprido).
 */
export type AssetRole = 'low' | 'counter' | 'tall' | 'wall' | 'panel' | 'table';
export type Asset = {
  id: string;
  name: string;
  category: AssetCategory;
  role: AssetRole;
  /** Uma linha para a galeria e para a IA. */
  summary: string;
  /** Palavras que a pessoa usa para pedir este móvel. */
  keywords: string[];
  size: { default: AssetSize; min: AssetSize; max: AssetSize };
  body: MaterialId;
  front: MaterialId;
  /** Pés padrão (mm); ausente, o móvel não usa pés. */
  feet?: number;
  /** Texto de boas-vindas quando o projeto nasce deste ativo. */
  intro: (p: AssetInput) => string;
  /** Ambiente de exemplo quando o projeto nasce deste ativo. */
  room?: (p: AssetInput, width: number) => Room;
  build: (b: Builder, p: AssetInput) => void;
  /** Estilos que combinam com o móvel; ausente, todos. */
  styles?: readonly StyleId[];
};

const P = PROFILE.panel;
const cm = (mm: number) => String(Math.round(mm / 10));

/**
 * Monta a composição de um ativo com operações do contrato. Os ids saem com o
 * prefixo pedido, para o ativo entrar em um projeto que já tem módulos.
 */
export class Builder {
  d: Composition | null = null;
  constructor(readonly pre: string) {}
  id(key: string) {
    return `${this.pre}${key}`;
  }
  op(o: ModularOp) {
    this.d = applyModularOp(this.d!, o);
  }
  /** Caixa nova: o primeiro módulo nasce direto, os outros pelo contrato. */
  box(
    key: string,
    name: string,
    [width, height, depth]: [number, number, number],
    materialId: MaterialId,
    extra: { feet?: number; position?: [number, number, number]; wall?: boolean } = {},
  ) {
    const id = this.id(key);
    if (!this.d) {
      const m = preset('niche', id);
      Object.assign(m, { name, width, height, depth, materialId, position: extra.position ?? [0, 0, 0] });
      if (extra.feet) m.feet = extra.feet;
      if (extra.wall) m.wall = true;
      this.d = { schemaVersion: SCHEMA_VERSION, profile: PROFILE, modules: [m], connections: [] };
      generateComposition(this.d);
      return id;
    }
    // Estaciona longe e só então posiciona ou conecta: crescer no lugar
    // invadiria o vizinho.
    this.op({ kind: 'module.add', id, preset: 'niche', name });
    this.op({
      kind: 'module.edit',
      id,
      width,
      height,
      depth,
      materialId,
      position: extra.position ?? [15000 + Math.random() * 1000, 0, 0],
      ...(extra.feet ? { feet: extra.feet } : {}),
      ...(extra.wall ? { wall: true } : {}),
    });
    return id;
  }
  panel(key: string, name: string, [width, height, thickness]: [number, number, number], materialId: MaterialId, position: [number, number, number], extra: { hooks?: number } = {}) {
    const id = this.id(key);
    if (!this.d) {
      const m = preset('panel', id);
      Object.assign(m, { name, width, height, depth: thickness, materialId, position, ...(extra.hooks ? { hooks: extra.hooks } : {}) });
      this.d = { schemaVersion: SCHEMA_VERSION, profile: PROFILE, modules: [m], connections: [] };
      return id;
    }
    this.op({ kind: 'module.add', id, preset: 'panel', name });
    this.op({ kind: 'module.edit', id, width, height, depth: thickness, materialId, position, ...(extra.hooks ? { hooks: extra.hooks } : {}) });
    return id;
  }
  /**
   * Mesa ou estrutura aberta: tampo de `width × depth` a `height` do piso,
   * níveis embaixo e gavetas no avental (`lib/tables.ts`).
   */
  table(
    key: string,
    name: string,
    [width, height, depth]: [number, number, number],
    materialId: MaterialId,
    extra: { position?: [number, number, number]; wall?: boolean; shelves?: number; drawers?: number; look?: Look } = {},
  ) {
    const id = this.id(key);
    const fields = {
      ...(extra.shelves ? { shelves: extra.shelves } : {}),
      ...(extra.drawers ? { drawers: extra.drawers } : {}),
      ...(extra.wall ? { wall: true } : {}),
      ...(extra.look ? { look: extra.look } : {}),
    };
    if (!this.d) {
      const m = preset('table', id);
      Object.assign(m, { name, width, height, depth, materialId, position: extra.position ?? [0, 0, 0] }, fields);
      this.d = { schemaVersion: SCHEMA_VERSION, profile: PROFILE, modules: [m], connections: [] };
      generateComposition(this.d);
      return id;
    }
    this.op({ kind: 'module.add', id, preset: 'table', name });
    this.op({ kind: 'module.edit', id, width, height, depth, materialId, position: extra.position ?? [15000 + Math.random() * 1000, 0, 0], ...fields });
    return id;
  }
  beside(parent: string, child: string, shared = true, align: 'front' | 'back' = 'front') {
    this.op({ kind: 'connect', parent, child, side: 'right', shared, align, offset: 0 });
  }
  split(cell: string, axis: 'x' | 'y', gapMm: number) {
    this.op({ kind: 'cell.split', id: cell, axis, gapMm: Math.round(gapMm) });
    return [`${cell}:low`, `${cell}:high`] as const;
  }
  /** `n` vãos iguais numa pilha: devolve os ids de baixo para cima. */
  stack(cell: string, n: number, span: number, axis: 'x' | 'y' = 'y') {
    const gap = Math.floor((span - (n - 1) * P) / n);
    const out: string[] = [];
    let current = cell;
    for (let i = 1; i < n; i++) {
      this.op({ kind: 'cell.split', id: current, axis, gapMm: gap });
      out.push(`${current}:low`);
      current = `${current}:high`;
    }
    out.push(current);
    if (n > 1) this.op({ kind: 'cell.distribute', id: cell });
    return out;
  }
  front(
    cell: string,
    type: 'single' | 'double' | 'drawers' | 'sliding' | 'flap',
    extra: { count?: number; hinge?: 'left' | 'right'; materialId?: MaterialId } = {},
  ) {
    this.op({ kind: 'front.set', id: cell, type, ...extra });
  }
  /** Fileira de colunas encostadas, com laterais compartilhadas. */
  row(
    key: string,
    names: string[],
    widths: number[],
    height: number,
    depth: number,
    materialId: MaterialId,
    extra: { feet?: number; position?: [number, number, number]; wall?: boolean } = {},
  ) {
    const ids: string[] = [];
    widths.forEach((w, i) => {
      const id = this.box(`${key}${i + 1}`, names[i], [w, height, depth], materialId, i === 0 ? extra : { feet: extra.feet, wall: extra.wall });
      if (i > 0) this.beside(ids[i - 1], id, true);
      ids.push(id);
    });
    return ids;
  }
  root(id: string) {
    return `${id}:root`;
  }
}

/** Divide `total` em `n` larguras inteiras que somam `total` (a sobra na última). */
function widthsOf(total: number, n: number) {
  // Laterais compartilhadas: cada junção economiza uma chapa de 18 mm.
  const sum = total + (n - 1) * P;
  const each = Math.floor(sum / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? sum - each * (n - 1) : each));
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** Colunas de largura perto de `target`, sem passar de 1200 mm por módulo. */
function columns(total: number, target: number, min = 1, max = 6) {
  return clamp(Math.max(Math.round(total / target), Math.ceil((total + P) / 1200)), min, max);
}
const inner = (h: number) => h - 2 * P;
/** Vão (caixa inteira) que leva porta de correr de `n` folhas: folha de 250 mm e 300 de altura. */
const slides = (w: number, h: number, n = 2) => (inner(w) - 2 * 2 + (n - 1) * 30) / n >= 250 && inner(h) - 2 * 2 >= 300;
/** Vão de altura `h` (livre) que leva basculante: folha de 150 a 700 mm. */
const flaps = (h: number) => h - 2 * 2 >= 150 && h - 2 * 2 <= 700;

/** Tamanhos comuns de TV (largura e altura com a moldura, em mm). */
const TV_SIZES = [
  { inches: 65, w: 1450, h: 830 },
  { inches: 55, w: 1230, h: 710 },
  { inches: 50, w: 1120, h: 650 },
  { inches: 43, w: 970, h: 560 },
  { inches: 32, w: 720, h: 420 },
];
/** A maior TV comum que cabe num vão com a folga dos dois lados; null se nenhuma cabe. */
function tvFor(gap: number) {
  return TV_SIZES.find((t) => t.w + 2 * TV_CLEARANCE_MM <= gap) ?? null;
}

/** TV de exemplo presa na parede: dá escala a sala. 55" por padrão; null, sem TV. */
function tvRoom(width: number, tvBottom: number, wallWidth = Math.max(3600, width + 1600), tv: { inches: number; w: number; h: number } | null = TV_SIZES[1]): Room {
  const offset = Math.round((wallWidth - width) / 2);
  if (!tv)
    return { schemaVersion: 1, widthMm: wallWidth, heightMm: 2700, depthMm: 3500, baseboardMm: 0, offsetMm: offset, obstacles: [] };
  const tvW = tv.w,
    tvH = tv.h;
  return {
    schemaVersion: 1,
    widthMm: wallWidth,
    heightMm: 2700,
    depthMm: 3500,
    baseboardMm: 0,
    offsetMm: offset,
    obstacles: [
      { id: 'ob-tv', kind: 'tv', label: `TV ${tv.inches}"`, xMm: Math.round(offset + width / 2 - tvW / 2), yMm: Math.round(tvBottom), widthMm: tvW, heightMm: tvH },
      { id: 'ob-tomada', kind: 'outlet', xMm: Math.round(offset + width + 150), yMm: 300, widthMm: 80, heightMm: 80 },
    ],
  };
}
/** Parede lisa centrada no móvel, com pé-direito comum. */
function plainRoom(width: number, extra: Partial<Room> = {}): Room {
  const wall = Math.max(3200, width + 1600);
  return { schemaVersion: 1, widthMm: wall, heightMm: 2700, depthMm: 3500, baseboardMm: 0, offsetMm: Math.round((wall - width) / 2), obstacles: [], ...extra };
}

export const assets: Asset[] = [
  {
    id: 'rack-tv',
    name: 'Rack de TV',
    category: 'sala',
    role: 'low',
    summary: 'Rack baixo: portas nas pontas, nichos e gavetas no centro',
    keywords: ['rack', 'tv', 'televisão', 'home', 'sala', 'móvel de tv', 'bancada de tv'],
    size: { default: { width: 1800, height: 550, depth: 450 }, min: { width: 1000, height: 400, depth: 350 }, max: { width: 3000, height: 750, depth: 550 } },
    body: 'freijo',
    front: 'white',
    feet: 150,
    intro: (p) =>
      `Montei um rack de TV de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm em freijó com frentes brancas${p.feet ? ` e pés palito de ${cm(p.feet)} cm` : ''}: portas nas pontas e, no centro, nicho aberto para os aparelhos com gaveta embaixo. Deixei uma TV de 55" na parede para dar a escala. Peça para trocar cores, tirar os pés ou mudar a largura.`,
    room: (p, width) => tvRoom(width, p.height + 250),
    build(b, p) {
      const boxH = p.height - p.feet;
      const n = columns(p.width, 600, 2, 5);
      const names = Array.from({ length: n }, (_, i) =>
        i === 0 ? 'Porta esquerda' : i === n - 1 ? 'Porta direita' : n === 3 ? 'Centro' : `Centro ${i}`,
      );
      const ids = b.row('r', names, widthsOf(p.width, n), boxH, p.depth, p.body, { feet: p.feet });
      ids.forEach((id, i) => {
        const cell = b.root(id);
        const end = i === 0 || i === n - 1;
        if (end && n > 2) {
          b.front(cell, 'single', { hinge: i === 0 ? 'left' : 'right', materialId: p.front });
          return;
        }
        if (n === 2 && i === 1) {
          b.front(cell, 'double', { materialId: p.front });
          return;
        }
        // Centro: nicho aberto em cima para os aparelhos e gaveta embaixo.
        if (inner(boxH) >= 260) {
          const [low] = b.split(cell, 'y', Math.min(180, inner(boxH) - P - 120));
          b.front(low, 'drawers', { count: 1, materialId: p.front });
        }
      });
    },
  },
  {
    id: 'rack-suspenso',
    name: 'Painel com rack suspenso',
    category: 'sala',
    role: 'panel',
    summary: 'Painel de parede para a TV e rack suspenso com gavetas e nichos',
    keywords: ['painel', 'painel de tv', 'rack suspenso', 'tv', 'home', 'sala', 'flutuante'],
    size: { default: { width: 2200, height: 1800, depth: 400 }, min: { width: 1400, height: 1200, depth: 300 }, max: { width: 2700, height: 1800, depth: 500 } },
    body: 'walnut',
    front: 'walnut',
    intro: (p) =>
      `Montei um painel de TV de ${cm(p.width)} × ${cm(p.height)} cm em nogueira com um rack suspenso de ${cm(p.depth)} cm de profundidade: gavetas nas pontas e nichos abertos no meio, preso no painel a 45 cm do piso. A TV de 55" na parede mostra a escala. Peça para alargar o painel, trocar o acabamento ou mudar a altura do rack.`,
    room: (p, width) => tvRoom(width, 450 + 380 + 280),
    build(b, p) {
      const thick = 25;
      const panelBottom = Math.max(0, 1850 - p.height);
      b.panel('p', 'Painel', [p.width, p.height, thick], p.body, [0, panelBottom, 0]);
      const rackW = Math.min(2400, Math.max(1000, p.width - 300));
      const n = columns(rackW, 600, 2, 5);
      const widths = widthsOf(rackW, n);
      const ids = b.row(
        'r',
        widths.map((_, i) => (i === 0 ? 'Rack gaveta esquerda' : i === n - 1 ? 'Rack gaveta direita' : n === 3 ? 'Rack nicho' : `Rack nicho ${i}`)),
        widths,
        380,
        p.depth,
        p.body,
        { position: [-rackW / 2 + widths[0] / 2, 450, thick / 2 + p.depth / 2], wall: true },
      );
      ids.forEach((id, i) => {
        if (i === 0 || i === n - 1) b.front(b.root(id), 'drawers', { count: 1, materialId: p.front });
      });
    },
  },
  {
    id: 'rack',
    name: 'Rack com torres',
    category: 'sala',
    role: 'tall',
    summary: 'Rack baixo entre duas torres de nichos, alinhados pelo fundo',
    keywords: ['estante de tv', 'torres', 'home theater', 'rack com torres', 'sala'],
    size: { default: { width: 2100, height: 1800, depth: 450 }, min: { width: 1600, height: 1200, depth: 400 }, max: { width: 3300, height: 2400, depth: 550 } },
    body: 'walnut',
    front: 'graphite',
    intro: (p) =>
      `Montei um conjunto de sala de ${cm(p.width)} cm: rack grafite de ${cm(p.width - 900)} × 50 × ${cm(p.depth)} cm com gavetas e portas, entre duas torres de nogueira de 45 × ${cm(p.height)} × 35 cm alinhadas pelo fundo. Peça para alargar o rack, trocar as torres por portas ou mudar os acabamentos.`,
    // A TV fica entre as torres: a de 55" (1230 mm) entrava nas torres no
    // tamanho padrão (1200 mm entre elas). Vai a maior que cabe com folga.
    // A moldura do estilo nas torres avança para o vão (o quanto o móvel
    // cresceu de cada lado): a TV escolhida cabe entre as molduras.
    room: (p, width) => tvRoom(width, 800, undefined, tvFor(p.width - 900 - Math.max(0, width - p.width))),
    build(b, p) {
      const tower = (key: string, name: string) => {
        const id = b.box(key, name, [450, p.height, 350], p.body);
        b.stack(b.root(id), Math.max(3, Math.round(inner(p.height) / 440)), inner(p.height));
        return id;
      };
      const left = tower('1', 'Torre esquerda');
      const rackW = p.width - 900;
      const n = Math.ceil((rackW + P) / 1200);
      const widths = widthsOf(rackW, n);
      let prev = left;
      widths.forEach((w, i) => {
        const id = b.box(`r${i + 1}`, n === 1 ? 'Rack' : `Rack ${i + 1}`, [w, 500, p.depth], p.front);
        b.beside(prev, id, i > 0, 'back');
        if (i === 0) {
          const [low, high] = b.split(b.root(id), 'x', Math.min(380, w - 2 * P - P - 200));
          b.front(low, 'drawers', { count: 2 });
          b.front(high, 'double');
        } else b.front(b.root(id), 'double');
        prev = id;
      });
      const right = tower('3', 'Torre direita');
      b.beside(prev, right, false, 'back');
    },
  },
  {
    id: 'estante',
    name: 'Estante de livros',
    category: 'sala',
    role: 'tall',
    summary: 'Corpos de nichos iguais, com portas embaixo no centro',
    keywords: ['estante', 'livros', 'biblioteca', 'nichos', 'prateleiras'],
    size: { default: { width: 2400, height: 2100, depth: 350 }, min: { width: 600, height: 1200, depth: 250 }, max: { width: 3600, height: 2400, depth: 450 } },
    body: 'oak',
    front: 'oak',
    intro: (p) =>
      `Montei uma estante de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm em carvalho: corpos de nichos iguais com painéis compartilhados e portas no vão de baixo do corpo central. Peça para trocar o acabamento, mudar a altura ou colocar gavetas.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      const n = columns(p.width, 800, 1, 6);
      const shelves = clamp(Math.round(inner(p.height) / 400), 3, 6);
      const names = Array.from({ length: n }, (_, i) => (n === 1 ? 'Estante' : i === 0 ? 'Coluna esquerda' : i === n - 1 ? 'Coluna direita' : n === 3 ? 'Coluna central' : `Coluna ${i + 1}`));
      const ids = b.row('e', names, widthsOf(p.width, n), p.height, p.depth, p.body);
      ids.forEach((id, i) => {
        const slots = b.stack(b.root(id), shelves, inner(p.height));
        if (i === Math.floor(n / 2) && n > 1 && !(p.style && STYLES[p.style].airy)) b.front(slots[0], 'double', { materialId: p.front });
      });
    },
  },
  {
    id: 'aparador',
    name: 'Aparador',
    category: 'sala',
    role: 'low',
    summary: 'Buffet: portas nas pontas e gavetas no centro',
    keywords: ['aparador', 'buffet', 'balcão de sala', 'bar', 'credenza'],
    size: { default: { width: 1800, height: 800, depth: 450 }, min: { width: 1000, height: 600, depth: 350 }, max: { width: 2700, height: 950, depth: 550 } },
    body: 'walnut',
    front: 'sage',
    feet: 150,
    intro: (p) =>
      `Montei um aparador de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm em nogueira${p.feet ? ` sobre pés de ${cm(p.feet)} cm` : ''}: portas nas pontas e gavetas no centro, com frentes em verde sálvia. Peça para trocar as cores, aumentar as gavetas ou deixar um nicho aberto.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      const boxH = p.height - p.feet;
      const n = columns(p.width, 600, 2, 5);
      const mid = Math.floor(n / 2);
      const names = Array.from({ length: n }, (_, i) => (i === mid ? 'Gavetas' : i < mid ? 'Portas esquerda' : 'Portas direita'));
      const ids = b.row('a', names.map((v, i) => (names.indexOf(v) !== i ? `${v} ${i + 1}` : v)), widthsOf(p.width, n), boxH, p.depth, p.body, { feet: p.feet });
      const widths = widthsOf(p.width, n);
      ids.forEach((id, i) => {
        if (i === mid) b.front(b.root(id), 'drawers', { count: clamp(Math.floor(inner(boxH) / 170), 2, 4), materialId: p.front });
        else if ((p.style === 'midcentury' || p.style === 'brazilian') && slides(widths[i], boxH)) b.front(b.root(id), 'sliding', { count: 2, materialId: p.front });
        else b.front(b.root(id), 'double', { materialId: p.front });
      });
    },
  },
  {
    id: 'guarda-roupa',
    name: 'Guarda-roupa',
    category: 'quarto',
    role: 'tall',
    summary: 'Cabideiro, gaveteiro e portas, com maleiro em cima',
    keywords: ['guarda-roupa', 'roupeiro', 'armário de quarto', 'closet', 'maleiro'],
    size: { default: { width: 2400, height: 2400, depth: 600 }, min: { width: 1200, height: 2000, depth: 500 }, max: { width: 3600, height: 2400, depth: 650 } },
    body: 'white',
    front: 'freijo',
    intro: (p) =>
      `Montei um guarda-roupa de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm: cabideiro à esquerda, gaveteiro com portas no centro e portas à direita, todos com maleiro em cima. Corpo branco e frentes em freijó. Também deixei um quarto de exemplo em Ambiente, com a porta do quarto, para você ver o encaixe; troque pelas suas medidas.`,
    room: (p, width) => ({
      schemaVersion: 1,
      widthMm: Math.max(3300, width + 900),
      heightMm: 2700,
      depthMm: 3000,
      baseboardMm: 0,
      offsetMm: 0,
      obstacles: [
        { id: 'ob-porta', kind: 'door', xMm: width + 80, yMm: 0, widthMm: 760, heightMm: 2100 },
        { id: 'ob-tomada', kind: 'outlet', xMm: width + 650, yMm: 300, widthMm: 80, heightMm: 80 },
      ],
    }),
    build(b, p) {
      const n = columns(p.width, 800, 2, 5);
      // Com três colunas ou mais, a última é estreita, de porta simples; as
      // outras dividem o resto por igual.
      const widths = n >= 3 ? [...widthsOf(p.width - 600 + P, n - 1), 600] : widthsOf(p.width, n);
      const names = widths.map((_, i) => (i === 0 ? 'Cabideiro' : i === 1 && n > 2 ? 'Gaveteiro' : n === 2 || i === n - 1 ? 'Coluna de portas' : `Portas ${i}`));
      const ids = b.row('g', names, widths, p.height, p.depth, p.body);
      const low = inner(p.height) - P - 450;
      // Minimalista: portas de correr no corpo e basculante no maleiro.
      const minimal = p.style === 'minimalist';
      ids.forEach((id, i) => {
        const [body, top] = b.split(b.root(id), 'y', low);
        const doors = (cell: string, h: number) =>
          minimal && slides(widths[i], h + 2 * P)
            ? b.front(cell, 'sliding', { count: 2, materialId: p.front })
            : widths[i] >= 700
              ? b.front(cell, 'double', { materialId: p.front })
              : b.front(cell, 'single', { hinge: i === n - 1 ? 'right' : 'left', materialId: p.front });
        if (minimal && flaps(450)) b.front(top, 'flap', { materialId: p.front });
        else doors(top, 450);
        if (i === 1 && n > 2) {
          const [drawers, upper] = b.split(body, 'y', 640);
          b.front(drawers, 'drawers', { count: 3, materialId: p.front });
          doors(upper, low - 640 - P);
        } else doors(body, low);
      });
    },
  },
  {
    id: 'comoda',
    name: 'Cômoda',
    category: 'quarto',
    role: 'low',
    summary: 'Gaveteiro largo, quatro gavetas por coluna',
    keywords: ['cômoda', 'comoda', 'gaveteiro', 'gavetas', 'quarto'],
    size: { default: { width: 1200, height: 900, depth: 450 }, min: { width: 600, height: 650, depth: 380 }, max: { width: 2000, height: 1200, depth: 550 } },
    body: 'white',
    front: 'oak',
    feet: 120,
    intro: (p) =>
      `Montei uma cômoda de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm branca com gavetas em carvalho${p.feet ? ` e pés de ${cm(p.feet)} cm` : ''}. Peça para mudar o número de gavetas, a cor ou a largura.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      const boxH = p.height - p.feet;
      const n = p.width > 1200 ? 2 : 1;
      const count = clamp(Math.floor(inner(boxH) / 165), 2, 6);
      const ids = b.row('c', n === 1 ? ['Cômoda'] : ['Gavetas esquerda', 'Gavetas direita'], widthsOf(p.width, n), boxH, p.depth, p.body, { feet: p.feet });
      for (const id of ids) b.front(b.root(id), 'drawers', { count, materialId: p.front });
    },
  },
  {
    id: 'criado-mudo',
    name: 'Criado-mudo',
    category: 'quarto',
    role: 'low',
    summary: 'Mesa de cabeceira com gaveta em cima e nicho embaixo',
    keywords: ['criado-mudo', 'criado mudo', 'mesa de cabeceira', 'mesinha'],
    size: { default: { width: 500, height: 550, depth: 400 }, min: { width: 350, height: 400, depth: 300 }, max: { width: 700, height: 750, depth: 500 } },
    body: 'oak',
    front: 'white',
    feet: 150,
    intro: (p) =>
      `Montei um criado-mudo de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm em carvalho com gaveta branca em cima e nicho embaixo${p.feet ? `, sobre pés de ${cm(p.feet)} cm` : ''}. Peça um par, outra cor ou duas gavetas.`,
    room: (_, width) => plainRoom(width, { widthMm: 2400, offsetMm: Math.round((2400 - width) / 2) }),
    build(b, p) {
      const boxH = p.height - p.feet;
      const id = b.box('m', 'Criado-mudo', [p.width, boxH, p.depth], p.body, { feet: p.feet });
      const span = inner(boxH);
      if (span >= 2 * 100 + P + 40) {
        const [, top] = b.split(b.root(id), 'y', span - P - Math.min(170, span - P - 100));
        b.front(top, 'drawers', { count: 1, materialId: p.front });
      } else b.front(b.root(id), 'drawers', { count: 1, materialId: p.front });
    },
  },
  {
    id: 'cabeceira',
    name: 'Cabeceira com criados suspensos',
    category: 'quarto',
    role: 'panel',
    summary: 'Painel de cabeceira na parede e dois criados-mudos suspensos',
    keywords: ['cabeceira', 'painel de cama', 'criado suspenso', 'quarto', 'cama'],
    size: { default: { width: 2600, height: 1100, depth: 350 }, min: { width: 1800, height: 700, depth: 300 }, max: { width: 2700, height: 1600, depth: 450 } },
    body: 'freijo',
    front: 'white',
    intro: (p) =>
      `Montei uma cabeceira de ${cm(p.width)} × ${cm(p.height)} cm em freijó com dois criados-mudos suspensos de 45 cm, um de cada lado, com gaveta branca. O vão do meio (${cm(p.width - 900)} cm) é o da cama. Peça outra altura, outro acabamento ou criados maiores.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      const thick = 25;
      b.panel('p', 'Cabeceira', [p.width, p.height, thick], p.body, [0, 0, 0]);
      for (const [key, name, sx] of [['e', 'Criado esquerdo', -1], ['d', 'Criado direito', 1]] as const) {
        const id = b.box(key, name, [450, 300, p.depth], p.body, {
          position: [sx * (p.width / 2 - 225), 400, thick / 2 + p.depth / 2],
          wall: true,
        });
        b.front(b.root(id), 'drawers', { count: 1, materialId: p.front });
      }
    },
  },
  {
    id: 'cozinha',
    name: 'Cozinha linear',
    category: 'cozinha',
    role: 'counter',
    summary: 'Balcão com gaveteiro e portas, e armário aéreo alinhado em cima',
    keywords: ['cozinha', 'armário de cozinha', 'balcão e aéreo', 'planejado de cozinha'],
    size: { default: { width: 2400, height: 2200, depth: 580 }, min: { width: 1200, height: 2000, depth: 500 }, max: { width: 3600, height: 2400, depth: 650 } },
    body: 'white',
    front: 'sage',
    feet: 100,
    intro: (p) =>
      `Montei uma cozinha linear de ${cm(p.width)} cm: balcão de 85 cm de altura com gaveteiro e portas, sobre pés de ${cm(p.feet || 100)} cm, e armário aéreo de portas a 1,50 m do piso, alinhado pelo fundo. Corpo branco e frentes verde sálvia. O tampo de pedra fica por conta da marmoraria. Peça outra cor, mais gavetas ou um nicho para o micro-ondas.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      const feet = p.feet || 100;
      const n = columns(p.width, 700, 2, 6);
      const widths = widthsOf(p.width, n);
      const base = b.row('b', widths.map((_, i) => (i === 0 ? 'Gaveteiro' : `Balcão ${i}`)), widths, 850 - feet, p.depth, p.body, { feet });
      base.forEach((id, i) => {
        if (i === 0) b.front(b.root(id), 'drawers', { count: 4, materialId: p.front });
        else b.front(b.root(id), widths[i] >= 600 ? 'double' : 'single', { materialId: p.front, hinge: 'right' });
      });
      const upperH = clamp(p.height - 1500, 500, 900);
      const upperD = 350;
      const up = b.row('a', widths.map((_, i) => `Aéreo ${i + 1}`), widths, upperH, upperD, p.body, {
        position: [0, 1500, -p.depth / 2 + upperD / 2],
        wall: true,
      });
      // Minimalista: aéreo de basculante, quando a altura deixa.
      up.forEach((id, i) =>
        p.style === 'minimalist' && flaps(inner(upperH))
          ? b.front(b.root(id), 'flap', { materialId: p.front })
          : b.front(b.root(id), widths[i] >= 600 ? 'double' : 'single', { materialId: p.front, hinge: 'right' }),
      );
    },
  },
  {
    id: 'balcao-cozinha',
    name: 'Balcão de cozinha',
    category: 'cozinha',
    role: 'counter',
    summary: 'Gabinete de pia ou balcão com gaveteiro; o tampo vem com o estilo',
    keywords: ['balcão', 'gabinete de pia', 'pia', 'cozinha', 'bancada'],
    size: { default: { width: 1800, height: 850, depth: 580 }, min: { width: 800, height: 750, depth: 450 }, max: { width: 3600, height: 950, depth: 650 } },
    body: 'white',
    front: 'graphite',
    feet: 100,
    intro: (p) =>
      `Montei um balcão de cozinha de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm, sem o tampo de pedra: gaveteiro de quatro gavetas à esquerda e portas no resto, sobre pés de ${cm(p.feet || 100)} cm. Peça outra cor, mais gavetas ou um vão para a lava-louças.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      const feet = p.feet || 100;
      const n = columns(p.width, 700, 1, 6);
      const widths = widthsOf(p.width, n);
      const ids = b.row('b', widths.map((_, i) => (i === 0 && n > 1 ? 'Gaveteiro' : n === 1 ? 'Balcão' : `Balcão ${i}`)), widths, p.height - feet, p.depth, p.body, { feet });
      ids.forEach((id, i) => {
        if (i === 0 && n > 1) b.front(b.root(id), 'drawers', { count: 4, materialId: p.front });
        else b.front(b.root(id), widths[i] >= 600 ? 'double' : 'single', { materialId: p.front, hinge: 'right' });
      });
    },
  },
  {
    id: 'aereo-cozinha',
    name: 'Armário aéreo',
    category: 'cozinha',
    role: 'wall',
    summary: 'Armário suspenso de portas, preso na parede',
    keywords: ['aéreo', 'aereo', 'armário suspenso', 'armário de parede', 'cozinha', 'lavanderia'],
    size: { default: { width: 1800, height: 700, depth: 350 }, min: { width: 600, height: 400, depth: 280 }, max: { width: 3600, height: 900, depth: 450 } },
    body: 'white',
    front: 'white',
    intro: (p) =>
      `Montei um armário aéreo de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm, preso na parede a 1,50 m do piso, com portas. Peça outra altura de instalação, portas basculantes em outra cor ou um nicho aberto.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      const n = columns(p.width, 700, 1, 6);
      const widths = widthsOf(p.width, n);
      const ids = b.row('a', widths.map((_, i) => (n === 1 ? 'Aéreo' : `Aéreo ${i + 1}`)), widths, p.height, p.depth, p.body, { position: [0, 1500, 0], wall: true });
      ids.forEach((id, i) =>
        p.style === 'minimalist' && flaps(inner(p.height))
          ? b.front(b.root(id), 'flap', { materialId: p.front })
          : b.front(b.root(id), widths[i] >= 600 ? 'double' : 'single', { materialId: p.front, hinge: 'right' }),
      );
    },
  },
  {
    id: 'gabinete-banheiro',
    name: 'Gabinete de banheiro',
    category: 'cozinha',
    role: 'wall',
    summary: 'Gabinete suspenso com gavetas, para a cuba',
    keywords: ['banheiro', 'gabinete', 'lavabo', 'cuba', 'pia do banheiro'],
    size: { default: { width: 800, height: 500, depth: 450 }, min: { width: 450, height: 350, depth: 350 }, max: { width: 1600, height: 650, depth: 550 } },
    body: 'freijo',
    front: 'freijo',
    intro: (p) =>
      `Montei um gabinete de banheiro suspenso de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm em freijó, com duas gavetas, preso na parede a 35 cm do piso para a bancada ficar a uns 88 cm. Peça outra cor, uma porta no lugar das gavetas ou um nicho embaixo.`,
    room: (_, width) => plainRoom(width, { widthMm: Math.max(2000, width + 1000), offsetMm: Math.round((Math.max(2000, width + 1000) - width) / 2) }),
    build(b, p) {
      const n = p.width > 1200 ? 2 : 1;
      const ids = b.row('g', n === 1 ? ['Gabinete'] : ['Gabinete esquerdo', 'Gabinete direito'], widthsOf(p.width, n), p.height, p.depth, p.body, { position: [0, 350, 0], wall: true });
      for (const id of ids) b.front(b.root(id), 'drawers', { count: 2, materialId: p.front });
    },
  },
  {
    id: 'armario-escritorio',
    name: 'Armário de escritório',
    category: 'escritorio',
    role: 'tall',
    summary: 'Portas embaixo para pastas e nichos abertos em cima',
    keywords: ['escritório', 'home office', 'armário de escritório', 'arquivo', 'estante com portas'],
    size: { default: { width: 1600, height: 2000, depth: 400 }, min: { width: 600, height: 1400, depth: 300 }, max: { width: 3600, height: 2400, depth: 500 } },
    body: 'oak',
    front: 'petrol',
    intro: (p) =>
      `Montei um armário de escritório de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm em carvalho: portas azul petróleo embaixo, na altura de pastas, e nichos abertos em cima. Peça gavetas, mais nichos ou outra cor de porta.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      const n = columns(p.width, 800, 1, 6);
      const widths = widthsOf(p.width, n);
      const ids = b.row('o', widths.map((_, i) => (n === 1 ? 'Armário' : `Coluna ${i + 1}`)), widths, p.height, p.depth, p.body);
      const upper = inner(p.height) - P - 720;
      ids.forEach((id, i) => {
        const [low, high] = b.split(b.root(id), 'y', 720);
        b.front(low, widths[i] >= 600 ? 'double' : 'single', { materialId: p.front, hinge: 'right' });
        b.stack(high, clamp(Math.round(upper / 360), 2, 4), upper);
      });
    },
  },
  {
    id: 'sapateira',
    name: 'Sapateira de entrada',
    category: 'servico',
    role: 'low',
    summary: 'Nichos para sapatos, porta e gavetas',
    keywords: ['sapateira', 'entrada', 'hall', 'sapatos', 'calçados'],
    size: { default: { width: 1600, height: 1100, depth: 350 }, min: { width: 800, height: 800, depth: 300 }, max: { width: 2400, height: 1600, depth: 450 } },
    body: 'sand',
    front: 'sand',
    intro: (p) =>
      `Montei uma sapateira de entrada de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm em areia: nichos abertos para sapatos à esquerda e, à direita, porta em cima e duas gavetas embaixo. Peça para aumentar a quantidade de nichos ou trocar a porta por gavetas.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      const n = columns(p.width, 800, 2, 3);
      const widths = widthsOf(p.width, n);
      const names = widths.map((_, i) => (i === n - 1 ? 'Porta e gavetas' : n > 2 ? `Nichos ${i + 1}` : 'Nichos'));
      const ids = b.row('s', names, widths, p.height, p.depth, p.body);
      ids.forEach((id, i) => {
        if (i < n - 1) b.stack(b.root(id), clamp(Math.round(inner(p.height) / 200), 3, 7), inner(p.height));
        else {
          const [low, high] = b.split(b.root(id), 'y', Math.min(440, inner(p.height) - P - 250));
          b.front(low, 'drawers', { count: 2, materialId: p.front });
          b.front(high, 'single', { hinge: 'right', materialId: p.front });
        }
      });
    },
  },
  {
    id: 'armario-lavanderia',
    name: 'Armário de lavanderia',
    category: 'servico',
    role: 'tall',
    summary: 'Vassoureiro alto ao lado de portas, nicho e maleiro',
    keywords: ['lavanderia', 'área de serviço', 'vassoureiro', 'armário de limpeza'],
    size: { default: { width: 1200, height: 2200, depth: 500 }, min: { width: 900, height: 1800, depth: 400 }, max: { width: 1600, height: 2400, depth: 600 } },
    body: 'white',
    front: 'white',
    intro: (p) =>
      `Montei um armário de lavanderia de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm: vassoureiro alto de porta inteira à esquerda e, ao lado, portas embaixo, um nicho aberto para os produtos do dia a dia e maleiro em cima. Peça outra cor ou prateleiras no vassoureiro.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      const [broom, rest] = b.row('l', ['Vassoureiro', 'Portas e nicho'], widthsOf(p.width, 2).map((w, i, all) => (i === 0 ? Math.min(450, w) : all[0] + all[1] - Math.min(450, all[0]))), p.height, p.depth, p.body);
      b.front(b.root(broom), 'single', { hinge: 'left', materialId: p.front });
      const span = inner(p.height);
      const [low, upper] = b.split(b.root(rest), 'y', 900);
      b.front(low, 'double', { materialId: p.front });
      const [niche, top] = b.split(upper, 'y', Math.max(300, span - 900 - 2 * P - 450));
      void niche;
      b.front(top, 'double', { materialId: p.front });
    },
  },
  {
    id: 'escrivaninha',
    name: 'Escrivaninha',
    category: 'escritorio',
    role: 'table',
    summary: 'Mesa de trabalho com gaveta embaixo do tampo',
    keywords: ['escrivaninha', 'mesa de escritório', 'mesa de estudo', 'mesa de computador', 'home office'],
    size: { default: { width: 1200, height: 750, depth: 600 }, min: { width: 800, height: 700, depth: 450 }, max: { width: 1800, height: 780, depth: 800 } },
    body: 'oak',
    front: 'oak',
    intro: (p) =>
      `Montei uma escrivaninha de ${cm(p.width)} × ${cm(p.depth)} cm com o tampo a ${cm(p.height)} cm do piso, em carvalho sobre pés cônicos, com ${p.width >= 1100 ? 'duas gavetas' : 'uma gaveta'} no avental. Peça outra base, um tampo maciço ou mais fundo para o monitor.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      b.table('m', 'Escrivaninha', [p.width, p.height, p.depth], p.body, { drawers: p.width >= 1100 ? 2 : 1, look: { legs: 'tapered', legMaterialId: 'oak-solid' } });
    },
  },
  {
    id: 'escrivaninha-suspensa',
    name: 'Escrivaninha suspensa',
    category: 'escritorio',
    role: 'table',
    summary: 'Tampo preso na parede com gaveta, sem pés no piso',
    keywords: ['escrivaninha suspensa', 'mesa suspensa', 'mesa de parede', 'bancada de estudo'],
    size: { default: { width: 1000, height: 750, depth: 450 }, min: { width: 600, height: 700, depth: 350 }, max: { width: 1600, height: 800, depth: 600 } },
    body: 'walnut',
    front: 'walnut',
    intro: (p) =>
      `Montei uma escrivaninha suspensa de ${cm(p.width)} × ${cm(p.depth)} cm presa na parede a ${cm(p.height)} cm do piso, com uma gaveta embaixo do tampo e o piso livre. Peça outra altura, outro acabamento ou um painel na parede.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      b.table('m', 'Escrivaninha suspensa', [p.width, p.height, p.depth], p.body, { wall: true, drawers: 1, look: { legs: 'wall' } });
    },
  },
  {
    id: 'console',
    name: 'Console',
    category: 'servico',
    role: 'table',
    summary: 'Mesa estreita de entrada ou de sala, com gaveta e nível embaixo',
    keywords: ['console', 'aparador de entrada', 'mesa de hall', 'mesa estreita', 'buffet estreito'],
    size: { default: { width: 1000, height: 800, depth: 350 }, min: { width: 600, height: 700, depth: 250 }, max: { width: 1800, height: 900, depth: 450 } },
    body: 'freijo',
    front: 'freijo',
    intro: (p) =>
      `Montei um console de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm em freijó sobre pés quadrados, com gaveta no avental e um nível embaixo para cestos ou livros. Peça outra base, mais gavetas ou tampo de pedra.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      // Console raso (menos de 30 cm) fica sem gaveta e sem nível: não sobra fundo entre os pés.
      b.table('m', 'Console', [p.width, p.height, p.depth], p.body, { drawers: p.depth < 300 ? 0 : p.width >= 1300 ? 2 : 1, shelves: p.depth < 300 ? 0 : 1, look: { legs: 'block', legMaterialId: 'freijo-solid' } });
    },
  },
  {
    id: 'mesa-centro',
    name: 'Mesa de centro',
    category: 'sala',
    role: 'table',
    summary: 'Mesa baixa de sala, com nível embaixo para revistas',
    keywords: ['mesa de centro', 'mesinha de centro', 'mesa de sala', 'centro'],
    size: { default: { width: 1000, height: 420, depth: 550 }, min: { width: 500, height: 300, depth: 400 }, max: { width: 1400, height: 500, depth: 1000 } },
    body: 'oak',
    front: 'oak',
    intro: (p) =>
      `Montei uma mesa de centro de ${cm(p.width)} × ${cm(p.depth)} cm a ${cm(p.height)} cm do piso, em carvalho${p.height >= 420 ? ', com um nível embaixo para revistas' : ''}. Peça outra base, tampo de pedra ou vidro, ou outra medida.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      b.table('m', 'Mesa de centro', [p.width, p.height, p.depth], p.body, { shelves: p.height >= 420 ? 1 : 0, look: { legs: 'block', legMaterialId: 'oak-solid' } });
    },
  },
  {
    id: 'mesa-lateral',
    name: 'Mesa lateral',
    category: 'sala',
    role: 'table',
    summary: 'Mesinha de apoio ao lado do sofá ou da poltrona',
    keywords: ['mesa lateral', 'mesa de apoio', 'mesinha', 'mesa de canto'],
    size: { default: { width: 450, height: 550, depth: 450 }, min: { width: 300, height: 400, depth: 300 }, max: { width: 650, height: 700, depth: 650 } },
    body: 'walnut',
    front: 'walnut',
    intro: (p) =>
      `Montei uma mesa lateral de ${cm(p.width)} × ${cm(p.depth)} cm a ${cm(p.height)} cm do piso, em nogueira${p.height >= 420 ? ', com um nível embaixo' : ''}. Peça um par, outra base ou tampo redondo de borda boleada.`,
    room: (_, width) => plainRoom(width, { widthMm: 2400, offsetMm: Math.round((2400 - width) / 2) }),
    build(b, p) {
      b.table('m', 'Mesa lateral', [p.width, p.height, p.depth], p.body, { shelves: p.height >= 420 ? 1 : 0, look: { legs: 'tapered', legMaterialId: 'walnut-solid' } });
    },
  },
  {
    id: 'mesa-jantar',
    name: 'Mesa de jantar',
    category: 'sala',
    role: 'table',
    summary: 'Mesa de jantar para quatro a oito lugares',
    keywords: ['mesa de jantar', 'mesa de refeição', 'mesa de cozinha', 'mesa para 6'],
    size: { default: { width: 1600, height: 760, depth: 900 }, min: { width: 800, height: 720, depth: 700 }, max: { width: 2700, height: 780, depth: 1200 } },
    body: 'oak',
    front: 'oak',
    intro: (p) =>
      `Montei uma mesa de jantar de ${cm(p.width)} × ${cm(p.depth)} cm a ${cm(p.height)} cm do piso, em carvalho sobre pés cônicos, para ${p.width >= 2000 ? 'oito' : p.width >= 1400 ? 'seis' : 'quatro'} lugares. Peça cavalete, estrutura de aço, tampo de pedra ou outra medida.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      b.table('m', 'Mesa de jantar', [p.width, p.height, p.depth], p.body, { look: { legs: 'tapered', legMaterialId: 'oak-solid', top: { materialId: 'oak-solid', thickness: 30, overhang: 40, edge: 'square' } } });
    },
  },
  {
    id: 'banco',
    name: 'Banco',
    category: 'servico',
    role: 'table',
    summary: 'Banco de entrada ou de pé de cama, com nível para sapatos',
    keywords: ['banco', 'banco de entrada', 'banco pé de cama', 'banqueta', 'recamier'],
    size: { default: { width: 1200, height: 450, depth: 380 }, min: { width: 600, height: 380, depth: 280 }, max: { width: 2000, height: 500, depth: 450 } },
    body: 'oak',
    front: 'oak',
    intro: (p) =>
      `Montei um banco de ${cm(p.width)} × ${cm(p.depth)} cm a ${cm(p.height)} cm do piso, em carvalho${p.height >= 420 ? ', com um nível embaixo para os sapatos' : ''}. Peça outro acabamento, outra base ou mais comprido.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      b.table('m', 'Banco', [p.width, p.height, p.depth], p.body, { shelves: p.height >= 420 ? 1 : 0, look: { legs: 'block', legMaterialId: 'oak-solid', top: { materialId: 'oak-solid', thickness: 40, overhang: 20, edge: 'square' } } });
    },
  },
  {
    id: 'estante-aberta',
    name: 'Estante aberta de aço',
    category: 'sala',
    role: 'tall',
    summary: 'Prateleiras sobre estrutura de aço, aberta dos quatro lados',
    keywords: ['estante de aço', 'estante industrial', 'estante aberta', 'prateleira de ferro', 'torre'],
    size: { default: { width: 1000, height: 1800, depth: 350 }, min: { width: 400, height: 1000, depth: 250 }, max: { width: 1600, height: 2400, depth: 500 } },
    body: 'oak',
    front: 'oak',
    intro: (p) =>
      `Montei uma estante aberta de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm: estrutura de tubo de aço preto e ${levelsFor(p.height) + 1} níveis de carvalho maciço. Peça mais níveis, outra madeira ou duas torres lado a lado.`,
    room: (_, width) => plainRoom(width),
    styles: ['industrial', 'minimalist', 'scandinavian', 'japandi', 'artdeco'],
    build(b, p) {
      b.table('m', 'Estante aberta', [p.width, p.height, p.depth], p.body, { shelves: levelsFor(p.height), look: { legs: 'frame', legMaterialId: 'steel-black', top: { materialId: 'oak-solid', thickness: 30, overhang: 0, edge: 'square' } } });
    },
  },
  {
    id: 'carrinho-bar',
    name: 'Carrinho de bar',
    category: 'sala',
    role: 'table',
    summary: 'Carrinho com rodízios e dois níveis para garrafas e copos',
    keywords: ['carrinho de bar', 'bar móvel', 'carrinho', 'bar de rodinhas'],
    size: { default: { width: 700, height: 850, depth: 420 }, min: { width: 500, height: 750, depth: 350 }, max: { width: 1000, height: 950, depth: 550 } },
    body: 'walnut',
    front: 'walnut',
    intro: (p) =>
      `Montei um carrinho de bar de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm sobre rodízios com freio: estrutura de aço, tampo e dois níveis em nogueira. Peça vidro nos níveis, outra madeira ou mais largo.`,
    room: (_, width) => plainRoom(width, { widthMm: 2400, offsetMm: Math.round((2400 - width) / 2) }),
    build(b, p) {
      b.table('m', 'Carrinho de bar', [p.width, p.height, p.depth], p.body, { shelves: 2, look: { legs: 'casters', top: { materialId: 'walnut-solid', thickness: 25, overhang: 10, edge: 'rounded' } } });
    },
  },
  {
    id: 'adega',
    name: 'Adega',
    category: 'sala',
    role: 'tall',
    summary: 'Grade de nichos para garrafas deitadas',
    keywords: ['adega', 'adega de vinho', 'porta-vinho', 'garrafeiro', 'nichos de vinho'],
    size: { default: { width: 600, height: 1100, depth: 350 }, min: { width: 400, height: 600, depth: 300 }, max: { width: 1000, height: 2000, depth: 450 } },
    body: 'walnut',
    front: 'walnut',
    intro: (p) =>
      `Montei uma adega de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm em nogueira, com uma grade de nichos de uns 12 cm para as garrafas deitadas. Peça portas embaixo, outra madeira ou mais nichos.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      const id = b.box('w', 'Adega', [p.width, p.height, p.depth], p.body);
      // Grade de nichos de ~12 cm, no máximo 32 por módulo.
      const cols = clamp(Math.floor((inner(p.width) + P) / 130), 2, 6);
      const rows = clamp(Math.floor((inner(p.height) + P) / 130), 2, Math.floor(32 / cols));
      for (const col of b.stack(b.root(id), cols, inner(p.width), 'x')) b.stack(col, rows, inner(p.height));
    },
  },
  {
    id: 'penteadeira',
    name: 'Penteadeira',
    category: 'quarto',
    role: 'table',
    summary: 'Mesa de maquiagem com gavetas e tampo de vidro',
    keywords: ['penteadeira', 'mesa de maquiagem', 'toucador', 'mesa de quarto'],
    size: { default: { width: 1000, height: 760, depth: 450 }, min: { width: 700, height: 720, depth: 350 }, max: { width: 1400, height: 800, depth: 550 } },
    body: 'white',
    front: 'white',
    intro: (p) =>
      `Montei uma penteadeira de ${cm(p.width)} × ${cm(p.depth)} cm a ${cm(p.height)} cm do piso: corpo branco sobre pés cônicos, duas gavetas no avental e tampo de vidro incolor. Peça espelho na parede, outra cor ou três gavetas.`,
    room: (_, width) => plainRoom(width, { widthMm: 2400, offsetMm: Math.round((2400 - width) / 2) }),
    build(b, p) {
      b.table('m', 'Penteadeira', [p.width, p.height, p.depth], p.body, { drawers: 2, look: { legs: 'tapered', legMaterialId: 'oak-solid', top: { materialId: 'glass-clear', thickness: 10, overhang: 20, edge: 'rounded' } } });
    },
  },
  {
    id: 'estante-tv',
    name: 'Estante de TV com moldura',
    category: 'sala',
    role: 'tall',
    summary: 'Nichos em volta da TV: torres nas laterais, ponte em cima e rack embaixo',
    keywords: ['estante de tv', 'home theater', 'moldura de nichos', 'estante com vão para tv', 'home'],
    size: { default: { width: 2400, height: 2000, depth: 400 }, min: { width: 1800, height: 1600, depth: 300 }, max: { width: 3300, height: 2400, depth: 450 } },
    body: 'freijo',
    front: 'graphite',
    intro: (p) =>
      `Montei uma estante de TV de ${cm(p.width)} × ${cm(p.height)} cm em freijó: torres de nichos nas laterais, uma ponte de nichos em cima e o rack com portas embaixo, formando a moldura da TV. Peça portas nas torres, outra cor ou mais larga.`,
    room: (p, width) => tvRoom(width, 700, undefined, tvFor(p.width - 900)),
    build(b, p) {
      const towerW = 450,
        rackH = 500,
        bridgeH = 350;
      const tower = (key: string, name: string, x: number) => {
        const id = b.box(key, name, [towerW, p.height, p.depth], p.body, { position: [x, 0, 0] });
        b.stack(b.root(id), Math.max(3, Math.round(inner(p.height) / 420)), inner(p.height));
        return id;
      };
      const gap = p.width - 2 * towerW;
      tower('1', 'Torre esquerda', -p.width / 2 + towerW / 2);
      tower('2', 'Torre direita', p.width / 2 - towerW / 2);
      // Rack entre as torres, no piso, em colunas de até 1,2 m.
      const n = Math.ceil((gap + P) / 1200);
      const widths = widthsOf(gap, n);
      const rack = b.row('r', widths.map((_, i) => (n === 1 ? 'Rack' : `Rack ${i + 1}`)), widths, rackH, p.depth, p.body, { position: [-gap / 2 + widths[0] / 2, 0, 0] });
      rack.forEach((id) => b.front(b.root(id), 'double', { materialId: p.front }));
      // Ponte de nichos em cima, presa nas torres.
      const bridge = b.row('p', widths.map((_, i) => (n === 1 ? 'Ponte' : `Ponte ${i + 1}`)), widths, bridgeH, p.depth, p.body, { position: [-gap / 2 + widths[0] / 2, p.height - bridgeH, 0], wall: true });
      bridge.forEach((id, i) => b.stack(b.root(id), clamp(Math.round(widths[i] / 450), 1, 3), inner(widths[i]), 'x'));
    },
  },
  {
    id: 'entrada',
    name: 'Entrada com banco e cabideiro',
    category: 'servico',
    role: 'table',
    summary: 'Banco com nível para sapatos e painel de ganchos na parede',
    keywords: ['entrada', 'hall de entrada', 'cabideiro', 'banco com ganchos', 'mudroom'],
    size: { default: { width: 1200, height: 1800, depth: 380 }, min: { width: 700, height: 1500, depth: 300 }, max: { width: 2000, height: 2200, depth: 450 } },
    body: 'oak',
    front: 'oak',
    intro: (p) =>
      `Montei uma entrada de ${cm(p.width)} cm: banco de ${cm(p.depth)} cm de fundo com nível para sapatos e, na parede, um painel com ${hooksFor(p.width)} ganchos de cabideiro até ${cm(p.height)} cm do piso. Peça outra cor, mais ganchos ou uma prateleira em cima.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      // O painel começa logo acima do banco: os dois leem como uma peça só.
      const benchH = 450,
        panelBottom = 650;
      b.table('b', 'Banco', [p.width, benchH, p.depth], p.body, { position: [0, 0, 0], shelves: 1, look: { legs: 'block', legMaterialId: 'oak-solid', top: { materialId: 'oak-solid', thickness: 40, overhang: 20, edge: 'square' } } });
      b.panel('c', 'Painel de ganchos', [p.width, p.height - panelBottom, 20], p.body, [0, panelBottom, -p.depth / 2 + 10], { hooks: hooksFor(p.width) });
    },
  },
  {
    id: 'estante-desencontrada',
    name: 'Estante de nichos desencontrados',
    category: 'sala',
    role: 'tall',
    summary: 'Colunas com prateleiras em alturas diferentes, sem fundo, sobre base',
    keywords: ['estante desencontrada', 'nichos desencontrados', 'estante vazada', 'estante divisória'],
    size: { default: { width: 800, height: 1740, depth: 320 }, min: { width: 600, height: 1200, depth: 280 }, max: { width: 1200, height: 2400, depth: 400 } },
    body: 'walnut',
    front: 'walnut',
    intro: (p) =>
      `Montei uma estante de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm em nogueira, sem fundo e sobre base aparente: as colunas têm prateleiras em alturas diferentes, como numa estante de nichos desencontrados. Peça mais colunas, outra madeira ou fundo.`,
    room: (_, width) => plainRoom(width),
    build(b, p) {
      const id = b.box('e', 'Estante', [p.width, p.height - 60, p.depth], p.body, { feet: 60 });
      b.op({ kind: 'module.edit', id, back: false, look: { legs: 'skirt' } });
      const span = inner(p.height - 60);
      const cols = clamp(Math.round(inner(p.width) / 380), 2, 4);
      // Cada coluna com o seu passo: as prateleiras de uma caem no meio do vão da vizinha.
      b.stack(b.root(id), cols, inner(p.width), 'x').forEach((col, i) => {
        const n = clamp(Math.round(span / 420), 3, 6);
        const step = Math.floor((span - (n - 1) * P) / n);
        if (i % 2 === 0) b.stack(col, n, span);
        else {
          // Coluna desencontrada: meio vão embaixo, vãos inteiros no meio e o resto em cima.
          let current = col;
          const first = Math.floor(step / 2);
          b.split(current, 'y', first);
          current = `${current}:high`;
          for (let k = 0; k < n - 1; k++) {
            b.split(current, 'y', step);
            current = `${current}:high`;
          }
        }
      });
    },
  },
];

/** Níveis da estante aberta embaixo do tampo: um a cada ~40 cm. */
function levelsFor(height: number) {
  return clamp(Math.round((height - 100) / 400), 2, 6) - 1;
}
/** Ganchos no painel da entrada: um a cada ~25 cm. */
function hooksFor(width: number) {
  return clamp(Math.round(width / 250), 2, 8);
}

export const ASSET_IDS = assets.map((a) => a.id) as [string, ...string[]];
export function assetById(id: string) {
  return assets.find((a) => a.id === id);
}

/**
 * Medidas pedidas dentro dos limites do ativo, com o padrão no que faltar.
 * Com estilo, o que a pessoa não disse vem dele: a proporção do móvel novo
 * (anos 60 baixo e comprido, japandi baixo), os pés na altura do estilo e o
 * corpo e as frentes da paleta.
 */
export function resolveInput(asset: Asset, want: Partial<AssetInput> = {}): AssetInput {
  const style = want.style;
  const scale = style && (asset.role === 'low' || asset.role === 'tall') ? styleProportion(style, asset.role) : { width: 1, height: 1 };
  const pick = (k: keyof AssetSize) => {
    const factor = k === 'width' ? scale.width : k === 'height' ? scale.height : 1;
    const v = want[k] ?? clamp(Math.round(asset.size.default[k] * factor), asset.size.min[k], asset.size.max[k]);
    if (v < asset.size.min[k] || v > asset.size.max[k])
      throw new Error(
        `${asset.name}: ${k === 'width' ? 'largura' : k === 'height' ? 'altura' : 'profundidade'} de ${asset.size.min[k]} a ${asset.size.max[k]} mm.`,
      );
    return Math.round(v);
  };
  const styled = style && asset.feet !== undefined ? styleFeet(style, asset.role === 'counter' ? 'counter' : 'low') : undefined;
  const feet = asset.feet === undefined ? 0 : (want.feet ?? styled ?? asset.feet);
  if (asset.feet === undefined && want.feet)
    throw new Error(`${asset.name} não leva pés.`);
  if (feet && (feet < 50 || feet > 300)) throw new Error('Pés: 0 (sem pés) ou de 50 a 300 mm.');
  const palette = style ? STYLES[style].palette : undefined;
  return {
    width: pick('width'),
    height: pick('height'),
    depth: pick('depth'),
    body: want.body ?? palette?.body ?? asset.body,
    front: want.front ?? want.body ?? palette?.front ?? asset.front,
    feet,
    ...(style ? { style } : {}),
  };
}

/** Boas-vindas do móvel novo no estilo: o que foi montado e o que pedir. */
export function introOf(asset: Asset, p: AssetInput) {
  if (!p.style) return asset.intro(p);
  const s = STYLES[p.style];
  return `${asset.name} de ${cm(p.width)} × ${cm(p.height)} × ${cm(p.depth)} cm no estilo ${s.label}: ${s.summary.charAt(0).toLowerCase()}${s.summary.slice(1)}. Peça para trocar de estilo, mudar as cores ou as medidas.`;
}

/**
 * Monta o ativo sozinho, com ids `<prefixo><chave>`, e valida. Com estilo, a
 * receita adapta a estrutura (correr no armário minimalista, estante aberta
 * no escandinavo) e `applyStyle` veste o resultado, guardando o envelope.
 */
export function buildAsset(asset: Asset, want: Partial<AssetInput> = {}, pre = ''): Composition {
  const input = resolveInput(asset, want);
  const b = new Builder(pre);
  try {
    asset.build(b, input);
    if (input.style)
      b.d = applyStyle(b.d!, input.style, {
        ...(want.body ? { body: want.body } : {}),
        ...((want.front ?? want.body) ? { front: want.front ?? want.body } : {}),
        ...(want.feet !== undefined && asset.feet !== undefined ? { feet: want.feet } : {}),
      });
  } catch (e) {
    throw new Error(`${asset.name}: ${(e as Error).message}`);
  }
  generateComposition(b.d!);
  return b.d!;
}

export const assetOpSchema = z
  .object({
    kind: z.literal('asset.add'),
    asset: z.enum(ASSET_IDS),
    /** Prefixo dos ids dos módulos novos (padrão: gerado). */
    id: z.string().regex(/^[a-z][a-z0-9-]{0,20}$/).optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    depth: z.number().optional(),
    materialId: z.enum(materialIds).optional(),
    frontMaterialId: z.enum(materialIds).optional(),
    feet: z.number().min(0).max(300).optional(),
    /** Estilo do móvel; ausente, segue o do projeto quando entra ao lado. */
    style: z.enum(STYLE_IDS).optional(),
    placement: z.enum(['replace', 'right', 'left']).default('replace'),
  })
  .strict();
export type AssetOp = z.input<typeof assetOpSchema>;

/** Prefixo livre no projeto: "rack-tv" vira "rt-", "rt2-"... */
function freePrefix(d: Composition, asset: string) {
  const base = asset
    .split('-')
    .map((w) => w[0])
    .join('');
  for (let i = 1; ; i++) {
    const pre = `${base}${i === 1 ? '' : i}-`;
    if (!d.modules.some((m) => m.id.startsWith(pre))) return pre;
  }
}

/**
 * Coloca o ativo no projeto: `replace` troca o projeto inteiro pelo ativo;
 * `right`/`left` encosta o conjunto ao lado do que existe, alinhado pelo
 * fundo (a parede). Módulos soltos do ativo andam juntos, os conectados
 * seguem os pais.
 */
export function applyAssetOp(d: Composition, raw: AssetOp): Composition {
  const op = assetOpSchema.parse(raw);
  const asset = assetById(op.asset)!;
  const pre = op.id ? `${op.id}-` : freePrefix(d, op.asset);
  if (op.placement !== 'replace' && d.modules.some((m) => m.id.startsWith(pre)))
    throw new Error(`Prefixo ${op.id} já usado no projeto: escolha outro id.`);
  // Móvel que entra ao lado segue o estilo do projeto, se a pessoa não disse outro.
  const style = op.style ?? (op.placement === 'replace' ? undefined : d.style);
  const piece = buildAsset(
    asset,
    { width: op.width, height: op.height, depth: op.depth, body: op.materialId, front: op.frontMaterialId, feet: op.feet, ...(style ? { style } : {}) },
    pre,
  );
  if (op.placement === 'replace') return piece;
  const here = generateComposition(d).bounds,
    there = generateComposition(piece).bounds;
  const dx = op.placement === 'right' ? here.max[0] - there.min[0] : here.min[0] - there.max[0];
  const dz = here.min[2] - there.min[2];
  const children = new Set(piece.connections.map((c) => c.child));
  for (const m of piece.modules)
    if (!children.has(m.id)) m.position = [m.position[0] + dx, m.position[1], m.position[2] + dz];
  const merged: Composition = {
    ...d,
    modules: [...d.modules, ...piece.modules],
    connections: [...d.connections, ...piece.connections],
  };
  if (merged.modules.length > 12)
    throw new Error(`O projeto passaria de 12 módulos com ${asset.name} (${piece.modules.length} módulos).`);
  generateComposition(merged);
  return merged;
}

/**
 * Catálogo em uma linha por ativo, para o prompt da IA (bloco fixo). Linha
 * curta, com a legenda das medidas em cima: trinta ativos cabem no orçamento
 * de caracteres do prompt.
 */
export function assetCatalogForPrompt() {
  const lines = assets.map((a) => {
    const s = a.size;
    const r = (k: keyof AssetSize) => `${s.min[k]}–${s.max[k]}/${s.default[k]}`;
    return `- ${a.id}: ${a.summary}. L ${r('width')} A ${r('height')} P ${r('depth')}${a.feet !== undefined ? ` pés ${a.feet}` : ''}. Ex.: ${a.keywords.slice(0, 3).join(', ')}`;
  });
  return ['Medidas em mm, mín–máx/padrão: L largura, A altura (mesa: do piso ao tampo), P profundidade; pés 0 tira.', ...lines].join('\n');
}
