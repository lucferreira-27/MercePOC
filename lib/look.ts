import { z } from 'zod';
import { categoryOf, idsOf, materialIds, materialOf, type MaterialCategory, type MaterialId } from './furniture';

/**
 * Acabamento de um módulo além do material: base (pés, rodapé, estrutura),
 * puxador, estilo da frente, tampo sobreposto e detalhes. É o que um estilo
 * (industrial, anos 60, escandinavo…) grava em cada módulo; o gerador só lê o
 * que está aqui, nunca a tabela de estilos, então mudar um estilo depois não
 * mexe em projeto salvo.
 *
 * Cada item tem limite real e as categorias de material que aceita, e a
 * validação diz o motivo numa frase que a pessoa e a IA entendem.
 */

/** Estilos do estúdio. A definição de cada um fica em `lib/styles.ts`. */
export const STYLE_IDS = ['industrial', 'midcentury', 'scandinavian', 'minimalist', 'rustic', 'classic', 'japandi'] as const;
export type StyleId = (typeof STYLE_IDS)[number];

export const LEG_TYPES = [
  'palito',
  'tapered',
  'splayed',
  'block',
  'turned',
  'bun',
  'hairpin',
  'tube',
  'pipe',
  'sled',
  'frame',
  'trestle',
  'plinth',
  'skirt',
  'casters',
  'wall',
] as const;
export type LegType = (typeof LEG_TYPES)[number];

export type LegSpec = {
  name: string;
  /** Altura em mm quando levanta uma caixa (`feet`); ausente, não vai em caixa. */
  box?: readonly [number, number];
  /** Serve de base de mesa (fase das mesas). */
  table?: boolean;
  /** Categorias de material do pé; null, o pé tem acabamento próprio. */
  materials: readonly MaterialCategory[] | null;
  /** Acabamento quando o módulo não diz: null segue a cor do corpo. */
  defaultMaterial: MaterialId | null;
  /** Madeira ou metal: decide a linha do orçamento. */
  metal?: boolean;
};

export const LEGS: Record<LegType, LegSpec> = {
  palito: { name: 'pé palito', box: [50, 300], table: false, materials: ['sheet', 'solid'], defaultMaterial: null },
  tapered: { name: 'pé cônico de madeira', box: [80, 300], table: true, materials: ['sheet', 'solid'], defaultMaterial: 'oak-solid' },
  splayed: { name: 'pé inclinado', box: [100, 300], table: true, materials: ['sheet', 'solid'], defaultMaterial: 'walnut-solid' },
  block: { name: 'pé quadrado de madeira', box: [40, 200], table: true, materials: ['sheet', 'solid'], defaultMaterial: 'oak-solid' },
  turned: { name: 'pé torneado', table: true, materials: ['sheet', 'solid'], defaultMaterial: 'walnut-solid' },
  bun: { name: 'pé bola', box: [40, 120], materials: ['sheet', 'solid'], defaultMaterial: 'walnut-solid' },
  hairpin: { name: 'pé grampo', box: [100, 300], table: true, materials: ['metal'], defaultMaterial: 'steel-black', metal: true },
  tube: { name: 'pé de tubo quadrado', box: [50, 300], table: true, materials: ['metal'], defaultMaterial: 'steel-black', metal: true },
  pipe: { name: 'pé de cano', box: [80, 300], table: true, materials: ['metal'], defaultMaterial: 'steel-black', metal: true },
  sled: { name: 'base trenó de aço', box: [100, 300], table: true, materials: ['metal'], defaultMaterial: 'steel-black', metal: true },
  frame: { name: 'estrutura de aço', box: [100, 300], table: true, materials: ['metal'], defaultMaterial: 'steel-black', metal: true },
  trestle: { name: 'cavalete', table: true, materials: ['sheet', 'solid', 'metal'], defaultMaterial: 'pine-solid' },
  plinth: { name: 'rodapé recuado', box: [50, 150], materials: ['sheet'], defaultMaterial: null },
  skirt: { name: 'base aparente', box: [50, 150], materials: ['sheet'], defaultMaterial: null },
  casters: { name: 'rodízios', box: [50, 120], table: true, materials: null, defaultMaterial: null },
  wall: { name: 'presa na parede', table: true, materials: null, defaultMaterial: null },
};

export const HANDLE_TYPES = ['bar', 'knob', 'cup', 'edge', 'groove', 'cutout', 'strap', 'none'] as const;
export type HandleType = (typeof HANDLE_TYPES)[number];
export const HANDLES: Record<HandleType, { name: string; materials: readonly MaterialCategory[] | null }> = {
  bar: { name: 'puxador barra', materials: ['metal'] },
  knob: { name: 'puxador botão', materials: ['metal', 'solid', 'sheet'] },
  cup: { name: 'puxador concha', materials: ['metal'] },
  edge: { name: 'puxador perfil de borda', materials: ['metal'] },
  groove: { name: 'cava (puxador usinado)', materials: null },
  cutout: { name: 'recorte na frente', materials: null },
  strap: { name: 'alça de couro', materials: null },
  none: { name: 'sem puxador (toque)', materials: null },
};
/** Acabamento de puxador quando o módulo não diz: o aço escovado de sempre. */
export const DEFAULT_HANDLE_MATERIAL: MaterialId = 'steel-brushed';

export const FRONT_STYLES = ['flat', 'shaker', 'slatted', 'glass', 'mesh', 'cane'] as const;
export type FrontStyle = (typeof FRONT_STYLES)[number];
export const FRONTS: Record<FrontStyle, { name: string; insert?: MaterialCategory; insertDefault?: MaterialId }> = {
  flat: { name: 'lisa' },
  shaker: { name: 'com moldura (shaker)' },
  slatted: { name: 'ripada' },
  glass: { name: 'de vidro com quadro', insert: 'glass', insertDefault: 'glass-clear' },
  mesh: { name: 'de tela metálica com quadro', insert: 'metal', insertDefault: 'steel-black' },
  cane: { name: 'de palhinha com quadro', insert: 'fiber', insertDefault: 'cane' },
};
/** Frente com quadro vazado: porta leva o miolo; gaveta fica com a moldura. */
export const framedFront = (s: FrontStyle | undefined) => s === 'glass' || s === 'mesh' || s === 'cane';

export const EDGE_PROFILES = ['square', 'rounded', 'chamfer'] as const;
export type EdgeProfile = (typeof EDGE_PROFILES)[number];

/** Espessura do tampo sobreposto por categoria (mm). */
export const TOP_LIMITS: Record<'sheet' | 'solid' | 'stone' | 'glass' | 'metal', readonly [number, number]> = {
  sheet: [15, 40],
  solid: [20, 60],
  stone: [20, 40],
  glass: [6, 19],
  metal: [3, 12],
};
export const TOP_OVERHANG_MAX = 60;
/**
 * Moldura do topo (cimalha): faixa em pé na frente, avançando `fasciaReach`,
 * e capa por cima avançando `capReach`; alturas em mm.
 */
export const CORNICE = { fascia: 40, cap: 18, fasciaReach: 20, capReach: 40 } as const;
/** Recuo do rodapé em relação à frente da caixa (mm). */
export const PLINTH_RECESS = 40;

const material = z.enum(materialIds);
export const topSchema = z
  .object({
    materialId: material,
    thickness: z.number().min(3).max(60),
    overhang: z.number().min(0).max(TOP_OVERHANG_MAX),
    edge: z.enum(EDGE_PROFILES),
  })
  .strict();
export type TopSpec = z.infer<typeof topSchema>;

export const lookSchema = z
  .object({
    legs: z.enum(LEG_TYPES).optional(),
    legMaterialId: material.optional(),
    handle: z.enum(HANDLE_TYPES).optional(),
    handleMaterialId: material.optional(),
    front: z.enum(FRONT_STYLES).optional(),
    insertMaterialId: material.optional(),
    top: topSchema.optional(),
    cornice: z.boolean().optional(),
    frame: z.boolean().optional(),
    frameMaterialId: material.optional(),
    backMaterialId: material.optional(),
    led: z.boolean().optional(),
  })
  .strict();
export type Look = z.infer<typeof lookSchema>;
export const LOOK_KEYS = Object.keys(lookSchema.shape) as (keyof Look)[];

/**
 * Remendo de acabamento no `module.edit`: cada campo substitui o atual, `null`
 * tira. Assim "tire o tampo" e "puxador botão em latão" são uma operação só.
 */
export const lookPatchSchema = z
  .object({
    legs: z.enum(LEG_TYPES).nullable().optional(),
    legMaterialId: material.nullable().optional(),
    handle: z.enum(HANDLE_TYPES).nullable().optional(),
    handleMaterialId: material.nullable().optional(),
    front: z.enum(FRONT_STYLES).nullable().optional(),
    insertMaterialId: material.nullable().optional(),
    top: topSchema.nullable().optional(),
    cornice: z.boolean().nullable().optional(),
    frame: z.boolean().nullable().optional(),
    frameMaterialId: material.nullable().optional(),
    backMaterialId: material.nullable().optional(),
    led: z.boolean().nullable().optional(),
  })
  .strict();
export type LookPatch = z.infer<typeof lookPatchSchema>;

export function patchLook(look: Look | undefined, patch: LookPatch): Look | undefined {
  const next: Record<string, unknown> = { ...look };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return Object.keys(next).length ? (next as Look) : undefined;
}

const names = (ids: readonly string[]) => ids.join(', ');
const catName: Record<MaterialCategory, string> = {
  sheet: 'chapa de MDF',
  solid: 'madeira maciça',
  metal: 'metal',
  glass: 'vidro',
  stone: 'pedra',
  fiber: 'palhinha',
};
function allowed(id: string, cats: readonly MaterialCategory[]) {
  return cats.includes(categoryOf(id));
}
/** "chapa de MDF ou madeira maciça (oak, walnut, …)": o que usar no lugar. */
function options(cats: readonly MaterialCategory[]) {
  return `${cats.map((c) => catName[c]).join(' ou ')} (${names(idsOf(...cats))})`;
}

/** O mínimo do módulo que a regra de acabamento lê. */
type LookModule = {
  name: string;
  kind?: string;
  feet?: number;
  back: boolean;
  materialId: string;
  look?: Look;
};
export type LookIssue = { path: string; message: string };

/**
 * Regras do acabamento de um módulo, com frase para cada recusa. Vale para o
 * validador do projeto (superRefine) e para a prévia do editor.
 */
export function lookIssues(m: LookModule): LookIssue[] {
  const out: LookIssue[] = [];
  const fail = (path: string, message: string) => out.push({ path, message: `${m.name}: ${message}` });
  const look = m.look ?? {};
  const set = (Object.keys(look) as (keyof Look)[]).filter((k) => look[k] !== undefined);
  if (m.kind === 'panel' || m.kind === 'ledge') {
    const ok = m.kind === 'panel' ? ['front', 'led'] : ['led'];
    const extra = set.filter((k) => !ok.includes(k));
    if (extra.length)
      fail('look', m.kind === 'panel' ? 'painel de parede aceita só frente ripada ou lisa e LED.' : 'prateleira de parede aceita só LED.');
    if (m.kind === 'panel' && look.front && look.front !== 'flat' && look.front !== 'slatted')
      fail('look', 'painel de parede aceita só frente ripada ou lisa.');
    const body: MaterialCategory[] = m.kind === 'ledge' ? ['sheet', 'solid', 'glass'] : ['sheet'];
    if (!allowed(m.materialId, body)) fail('materialId', `${materialOf(m.materialId).name} não serve aqui; use ${options(body)}.`);
    return out;
  }
  if (!allowed(m.materialId, ['sheet'])) fail('materialId', `corpo em ${materialOf(m.materialId).name} não dá: o corpo é de chapa, use ${names(idsOf('sheet'))}.`);
  if (look.legs) {
    const spec = LEGS[look.legs];
    if (!spec.box) fail('legs', `${spec.name} não vai em caixa (só em mesa).`);
    else if (!m.feet) fail('feet', `${spec.name} pede a altura em feet (${spec.box[0]} a ${spec.box[1]} mm).`);
    else if (m.feet < spec.box[0] || m.feet > spec.box[1])
      fail('feet', `${spec.name} de ${spec.box[0]} a ${spec.box[1]} mm (pediu ${Math.round(m.feet)}).`);
  }
  if (look.legMaterialId) {
    const spec = LEGS[look.legs ?? 'palito'];
    if (!look.legs && !m.feet) fail('legMaterialId', 'acabamento de pé sem pés.');
    else if (!spec.materials) fail('legMaterialId', `${spec.name} tem acabamento próprio.`);
    else if (!allowed(look.legMaterialId, spec.materials)) fail('legMaterialId', `${spec.name} em ${options(spec.materials)}.`);
  }
  if (look.handleMaterialId) {
    const spec = HANDLES[look.handle ?? 'bar'];
    if (spec.materials && !allowed(look.handleMaterialId, spec.materials)) fail('handleMaterialId', `${spec.name} em ${options(spec.materials)}.`);
  }
  if (look.insertMaterialId) {
    const spec = FRONTS[look.front ?? 'flat'];
    if (!spec.insert) fail('insertMaterialId', 'vidro, tela ou palhinha só com frente de quadro (glass, mesh ou cane).');
    else if (!allowed(look.insertMaterialId, [spec.insert])) fail('insertMaterialId', `frente ${spec.name} leva ${options([spec.insert])}.`);
  }
  if (look.top) {
    const cat = categoryOf(look.top.materialId);
    if (cat === 'fiber') fail('top', `tampo de palhinha não existe; use ${options(['sheet', 'solid', 'stone', 'glass', 'metal'])}.`);
    else {
      const [a, b] = TOP_LIMITS[cat];
      if (look.top.thickness < a || look.top.thickness > b)
        fail('top', `tampo de ${catName[cat]} com ${a} a ${b} mm de espessura (pediu ${Math.round(look.top.thickness)}).`);
    }
    if (look.cornice) fail('cornice', 'moldura no topo e tampo sobreposto não vão juntos.');
  }
  if (look.frameMaterialId && !allowed(look.frameMaterialId, ['metal'])) fail('frameMaterialId', `estrutura em ${options(['metal'])}.`);
  if (look.backMaterialId) {
    if (!m.back) fail('backMaterialId', 'módulo sem fundo: ligue o fundo antes de dar outro acabamento a ele.');
    else if (!allowed(look.backMaterialId, ['sheet'])) fail('backMaterialId', `fundo em chapa: ${names(idsOf('sheet'))}.`);
  }
  return out;
}

const lower = (id: string) => materialOf(id).name.toLowerCase();
/**
 * O acabamento em frases curtas, por grupo: base, puxador, frente, tampo,
 * moldura, estrutura, fundo e LED. Vai para o cartão de mudanças, o estado
 * que a IA lê e a lista de propriedades.
 */
const GROUPS: { keys: (keyof Look)[]; say: (l: Look, feet?: number) => string; none: string }[] = [
  {
    keys: ['legs', 'legMaterialId'],
    say: (l, feet) => `${LEGS[l.legs ?? 'palito'].name}${feet ? ` de ${Math.round(feet)} mm` : ''}${l.legMaterialId ? ` em ${lower(l.legMaterialId)}` : ''}`,
    none: 'base padrão',
  },
  {
    keys: ['handle', 'handleMaterialId'],
    say: (l) => `${HANDLES[l.handle ?? 'bar'].name}${l.handleMaterialId && HANDLES[l.handle ?? 'bar'].materials ? ` em ${lower(l.handleMaterialId)}` : ''}`,
    none: 'puxador barra',
  },
  {
    keys: ['front', 'insertMaterialId'],
    say: (l) => `frente ${FRONTS[l.front ?? 'flat'].name}${l.insertMaterialId && FRONTS[l.front ?? 'flat'].insert ? ` (${lower(l.insertMaterialId)})` : ''}`,
    none: 'frente lisa',
  },
  {
    keys: ['top'],
    say: (l) =>
      l.top
        ? `tampo de ${lower(l.top.materialId)} ${Math.round(l.top.thickness)} mm${l.top.overhang ? `, avanço de ${Math.round(l.top.overhang)} mm` : ''}${l.top.edge === 'rounded' ? ', borda boleada' : l.top.edge === 'chamfer' ? ', borda chanfrada' : ''}`
        : '',
    none: 'sem tampo sobreposto',
  },
  { keys: ['cornice'], say: (l) => (l.cornice ? 'moldura no topo' : ''), none: 'sem moldura no topo' },
  { keys: ['frame', 'frameMaterialId'], say: (l) => (l.frame ? `contorno em ${lower(l.frameMaterialId ?? 'steel-black')}` : ''), none: 'sem contorno de aço' },
  { keys: ['backMaterialId'], say: (l) => (l.backMaterialId ? `fundo em ${lower(l.backMaterialId)}` : ''), none: 'fundo no acabamento do corpo' },
  { keys: ['led'], say: (l) => (l.led ? 'fita de LED' : ''), none: 'sem LED' },
];
/** O acabamento escolhido do módulo, em frases ("pé grampo de 150 mm em aço preto"). */
export function describeLook(m: { feet?: number; look?: Look }): string[] {
  const l = m.look ?? {};
  return GROUPS.filter((g) => g.keys.some((k) => l[k] !== undefined && l[k] !== false)).map((g) => g.say(l, m.feet)).filter(Boolean);
}
/** O que mudou no acabamento entre duas versões do módulo. */
export function lookChanges(before: { feet?: number; look?: Look }, after: { feet?: number; look?: Look }): string[] {
  const a = before.look ?? {},
    b = after.look ?? {};
  const out: string[] = [];
  for (const g of GROUPS) {
    if (g.keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))) continue;
    const present = g.keys.some((k) => b[k] !== undefined && b[k] !== false);
    out.push(present ? g.say(b, after.feet) : g.none);
  }
  return out;
}
