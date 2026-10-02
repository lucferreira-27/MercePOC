import { categoryOf, materialOf, type MaterialCategory, type MaterialId } from './furniture';
import { FRONTS, framedFront, HANDLES, LEG_TYPES, LEGS, TOP_LIMITS, TOP_OVERHANG_MAX, type LegType, type Look, type TopSpec } from './look';

/**
 * Mesa e estrutura aberta (`kind: 'table'`): um tampo em cima de uma base,
 * níveis embaixo e gavetas no avental. Serve à escrivaninha, à mesa de
 * centro, ao banco, ao carrinho de bar e à estante aberta de aço (a torre de
 * cinco níveis é uma "mesa" alta com quatro prateleiras). A geometria sai
 * daqui, pura: o gerador transforma em peças de corte e `fittingsOf` em pés,
 * estrutura, cavalete, rodízios e suportes.
 *
 * Medidas no referencial do módulo: x na largura (centro 0), y do piso para
 * cima, z na profundidade (frente em +z). `height` é do piso ao tampo.
 */
export const TABLE_LIMITS = { width: [300, 2700], depth: [250, 1200], height: [250, 2400], shelves: 6, drawers: 4 } as const;
/** Bases que servem de mesa (as de `LEGS` com `table`). */
export const TABLE_BASES = LEG_TYPES.filter((t) => LEGS[t].table);
export const DEFAULT_TABLE_BASE: LegType = 'block';
/** Avental com gaveta (mm) e sem gaveta, nas bases de pé de madeira. */
export const APRON = { drawer: 130, rail: 80 } as const;
const WOOD_LEGS: readonly LegType[] = ['tapered', 'splayed', 'block', 'turned'];
/** Seção do pé de mesa (mm). */
const LEG_SECTION: Partial<Record<LegType, number>> = { tapered: 45, splayed: 40, block: 60, turned: 70, hairpin: 12, tube: 40, pipe: 34 };
/** Abertura do pé inclinado (anos 60), em graus, para fora nos dois eixos. */
export const SPLAY_DEG = 9;
/** Altura do rodízio (mm): a estrutura começa em cima dele. */
export const CASTER_HEIGHT = 70;

/** O que a mesa lê do módulo. */
export type TableModule = {
  name: string;
  width: number;
  height: number;
  depth: number;
  materialId: string;
  wall?: boolean;
  feet?: number;
  shelves?: number;
  drawers?: number;
  look?: Look;
};

export type TableSpec = {
  base: LegType;
  /** Tampo resolvido: o do look ou um no material do módulo. */
  top: TopSpec;
  /** Projeção da base: o tampo menos o avanço de cada lado. */
  bw: number;
  bd: number;
  /** Do piso à face de baixo do tampo. */
  lh: number;
  /** Quanto a base ocupa nas pontas (x) e na frente e no fundo (z). */
  legX: number;
  legZ: number;
  /** Altura do avental (0 sem avental). */
  apron: number;
  /** Espessura do avental e das prateleiras. */
  rail: number;
  shelfT: number;
  /** Face de baixo de cada prateleira, do piso. */
  levels: number[];
  /**
   * Quanto o nível cresce para cada lado na altura dele: o pé inclinado se
   * afasta descendo, e o nível vai até o meio do pé para ficar preso nele.
   */
  levelReach: (y: number) => number;
  /** Largura de cada frente de gaveta. */
  drawerW: number;
  /** Pé no canto: os lados do avental vão de pé a pé. */
  cornerLegs: boolean;
  /** Recuo da faixa das gavetas a partir da ponta da base. */
  drawerInset: number;
  /**
   * Onde o avental fica sem pé no canto: recuo nas pontas (x) e na frente e
   * no fundo (z), por fora do que a base ocupa (tubo da estrutura, trenó,
   * cavalete). O cavalete faz a lateral: sem avental lateral.
   */
  apronEnds: number;
  apronSides: number;
  sideAprons: boolean;
  /** Largura e fundo dos níveis: entre os pés, dentro da estrutura, entre as colunas do cavalete. */
  levelW: number;
  levelD: number;
};

/** Tampo da mesa: o escolhido ou, sem ele, uma chapa grossa no material do corpo. */
export function tableTop(m: Pick<TableModule, 'materialId' | 'look'>): TopSpec {
  if (m.look?.top) return m.look.top;
  const solid = categoryOf(m.materialId) === 'solid';
  return { materialId: m.materialId as MaterialId, thickness: solid ? 30 : 25, overhang: 25, edge: 'square' };
}

export function tableSpec(m: TableModule): TableSpec {
  const base = m.look?.legs ?? DEFAULT_TABLE_BASE;
  const top = tableTop(m);
  const ov = Math.min(top.overhang, TOP_OVERHANG_MAX);
  const bw = m.width - 2 * ov,
    bd = m.depth - 2 * ov;
  const lh = m.height - top.thickness;
  const section = LEG_SECTION[base];
  // Quanto a base toma nas pontas: o pé, o tubo da estrutura, o cavalete.
  const [legX, legZ] =
    section !== undefined
      ? [section, section]
      : base === 'frame' || base === 'casters'
        ? [20, 20]
        : base === 'sled'
          ? [20, 0]
          : base === 'trestle'
            ? [80, 0]
            : [0, 0];
  const drawers = m.drawers ?? 0;
  const apron = drawers ? APRON.drawer : WOOD_LEGS.includes(base) ? APRON.rail : 0;
  const thickness = materialOf(m.materialId).thickness;
  const rail = Math.min(Math.max(thickness, 18), 25),
    shelfT = Math.min(Math.max(thickness, 18), 30);
  // Níveis por igual entre o piso (com folga para limpar) e o avental.
  const n = m.shelves ?? 0;
  // Cavalete: o nível apoia no travessão, que fica acima da sapata (60 mm) com folga.
  const floor = base === 'casters' ? CASTER_HEIGHT + 40 : base === 'frame' ? 100 : base === 'trestle' ? 190 : 150;
  const ceiling = lh - apron;
  const step = n ? (ceiling - floor) / n : 0;
  const levels = Array.from({ length: n }, (_, i) => Math.round(floor + i * step));
  // Pé no canto: avental e gavetas entre os pés. Sem pé no canto, o avental
  // fica por dentro do que a base ocupa nas bordas (tubo de 20 da estrutura
  // e do trenó, cavalete de 80), senão atravessava o aço ou a madeira dela.
  const cornerLegs = section !== undefined;
  const apronEnds = base === 'trestle' ? 80 : base === 'sled' || base === 'frame' || base === 'casters' ? 20 : 10;
  const apronSides = base === 'frame' || base === 'casters' ? 20 : 10;
  const sideAprons = base !== 'trestle';
  const drawerInset = cornerLegs ? Math.max(legX, 10 + rail) : apronEnds + (sideAprons ? rail : 0);
  const drawerW = drawers ? (bw - 2 * drawerInset - (drawers - 1) * 4) / drawers : 0;
  const splay = base === 'splayed' ? Math.tan((SPLAY_DEG * Math.PI) / 180) : 0;
  const levelReach = (y: number) => (splay ? Math.round(splay * (lh - y) + legX / 2) : 0);
  // Cavalete: o nível apoia nos travessões (até o meio de cada cavalete), entre as colunas da frente e do fundo.
  const levelW = base === 'trestle' ? bw - 84 : bw - 2 * legX - 4;
  const levelD = base === 'trestle' ? bd - 184 : bd - 2 * legZ - 4;
  return { base, top, bw, bd, lh, legX, legZ, apron, rail, shelfT, levels, levelReach, drawerW, cornerLegs, drawerInset, apronEnds, apronSides, sideAprons, levelW, levelD };
}

const cat: Record<MaterialCategory, string> = { sheet: 'chapa', solid: 'madeira maciça', metal: 'metal', glass: 'vidro', stone: 'pedra', fiber: 'palhinha' };

/** Regras da mesa, com a frase de cada recusa. */
export function tableIssues(m: TableModule): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  const fail = (path: string, message: string) => out.push({ path, message: `${m.name}: ${message}` });
  const L = TABLE_LIMITS;
  if (m.width < L.width[0] || m.width > L.width[1]) fail('width', `mesa com ${L.width[0]} a ${L.width[1]} mm de largura.`);
  if (m.depth < L.depth[0] || m.depth > L.depth[1]) fail('depth', `mesa com ${L.depth[0]} a ${L.depth[1]} mm de profundidade.`);
  if (m.height < L.height[0] || m.height > L.height[1]) fail('height', `mesa com ${L.height[0]} a ${L.height[1]} mm de altura (do piso ao tampo).`);
  if (m.feet) fail('feet', 'mesa não usa feet: a base vai em look.legs e a altura é a do tampo.');
  const c = categoryOf(m.materialId);
  if (c !== 'sheet' && c !== 'solid') fail('materialId', `a estrutura da mesa (avental e prateleiras) é de chapa ou madeira maciça, não de ${cat[c]}.`);
  const look = m.look ?? {};
  const extra = (['cornice', 'frame', 'frameMaterialId', 'backMaterialId', 'insertMaterialId', 'led'] as const).filter((k) => look[k] !== undefined);
  if (extra.length) fail('look', `mesa não leva ${extra.join(', ')}.`);
  if (look.front && (framedFront(look.front) || FRONTS[look.front].panelOnly)) fail('look', 'gaveta de mesa é lisa, shaker ou ripada.');
  const base = look.legs ?? DEFAULT_TABLE_BASE;
  if (!LEGS[base].table) fail('legs', `${LEGS[base].name} não é base de mesa; use ${TABLE_BASES.join(', ')}.`);
  if (look.legMaterialId) {
    const spec = LEGS[base];
    if (!spec.materials) fail('legMaterialId', `${spec.name} tem acabamento próprio.`);
    else if (!spec.materials.includes(categoryOf(look.legMaterialId))) fail('legMaterialId', `${spec.name} em ${spec.materials.map((v) => cat[v]).join(' ou ')}.`);
  }
  if (look.handleMaterialId) {
    const spec = HANDLES[look.handle ?? 'bar'];
    if (spec.materials && !spec.materials.includes(categoryOf(look.handleMaterialId))) fail('handleMaterialId', `${spec.name} em ${spec.materials.map((v) => cat[v]).join(' ou ')}.`);
  }
  if (base === 'wall' && !m.wall) fail('wall', 'mesa presa na parede pede wall: true.');
  if (base !== 'wall' && m.wall) fail('wall', 'mesa no piso não é suspensa: use a base wall para prender na parede.');
  const top = tableTop(m);
  const tc = categoryOf(top.materialId);
  if (tc === 'fiber') fail('top', 'tampo de palhinha não existe.');
  else {
    const [a, b] = TOP_LIMITS[tc];
    if (top.thickness < a || top.thickness > b) fail('top', `tampo de ${cat[tc]} com ${a} a ${b} mm de espessura (pediu ${Math.round(top.thickness)}).`);
  }
  const shelves = m.shelves ?? 0,
    drawers = m.drawers ?? 0;
  if (!Number.isInteger(shelves) || shelves < 0 || shelves > L.shelves) fail('shelves', `de 0 a ${L.shelves} níveis embaixo do tampo.`);
  if (!Number.isInteger(drawers) || drawers < 0 || drawers > L.drawers) fail('drawers', `de 0 a ${L.drawers} gavetas no avental.`);
  if (out.length) return out;
  const s = tableSpec(m);
  if (s.lh < 100) fail('height', 'tampo grosso demais para essa altura.');
  if (s.bw < 200 || s.bd < 150) fail('top', 'o avanço do tampo não deixa base embaixo.');
  if (drawers && s.drawerW < 250) fail('drawers', `${drawers} gavetas não cabem em ${Math.round(s.bw - 2 * s.drawerInset)} mm: cada frente pede 250 mm.`);
  if (drawers && s.lh < APRON.drawer + 120) fail('drawers', 'gaveta pede a mesa com o tampo a 25 cm do piso ou mais.');
  // Caixa da gaveta: da frente (18 mm, 10 recuada) ao avental do fundo, com 20 de folga atrás.
  if (drawers && s.bd - 2 * 10 - 18 - s.rail - 20 < 150)
    fail('drawers', `gaveta pede ${Math.ceil(150 + 58 + s.rail + 2 * s.top.overhang)} mm de fundo na mesa (a caixa fica com menos de 15 cm).`);
  if (shelves && base === 'wall') fail('shelves', 'mesa presa na parede não leva nível embaixo.');
  if (shelves && (s.levelW < 150 || s.levelD < 80))
    fail('shelves', `${LEGS[base].name} não deixa lugar para nível nessa medida (${Math.round(s.levelW)} × ${Math.round(s.levelD)} mm entre a base); tire o nível ou aumente a mesa.`);
  if (shelves) {
    const gap = shelves > 1 ? s.levels[1] - s.levels[0] : s.lh - s.apron - s.levels[0];
    if (gap < 140) fail('shelves', `${shelves} níveis não cabem: o vão ficaria com ${Math.round(gap)} mm (mínimo 140).`);
  }
  return out;
}
