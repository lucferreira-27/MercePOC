import { generateComposition, isFlat, legsOf, point, PROFILE, type Composition, type ModularPart, type Module } from './composition';
import { materialOf, type MaterialId } from './furniture';
import { LEGS, type HandleType, type LegType } from './look';

/**
 * Ferragens e estrutura: o que vem pronto ou é soldado, não cortado de chapa.
 * Pés de cada tipo, rodízios, estrutura e contorno de aço, fita de LED e
 * puxadores. Cada item tem a forma e o lugar no mundo (para a cena, o desenho
 * e a foto do PDF) e a quantidade que o orçamento cobra (unidade ou metro).
 * Nada daqui entra no plano de corte nem na conferência de colisão: os pés
 * ficam dentro da planta do módulo por construção.
 */
type Vec = [number, number, number];
export type FittingKind = 'leg' | 'stand' | 'frame' | 'led' | 'handle';
export type Fitting = {
  id: string;
  moduleId: string;
  kind: FittingKind;
  /** Tipo de pé ou de puxador; `tube` para estrutura e contorno. */
  type: LegType | HandleType | 'tube' | 'strip';
  materialId: MaterialId | null;
  color: string;
  /** Centro da caixa que contém a peça, no mundo (mm). */
  position: Vec;
  /** Caixa da peça no referencial dela (largura, altura, profundidade). */
  size: Vec;
  /** Giro em torno do eixo vertical (rad), o do módulo. */
  rotation: number;
  /** Pé inclinado: quanto o pé abre para fora em x e z do módulo (rad). */
  splay?: [number, number];
  /** Peça que o puxador acompanha ao abrir. */
  attach?: string;
  /** Puxador: medidas no referencial da frente, para a cena prender nela. */
  local?: { x: number; y: number; z: number; vertical: boolean; len: number };
  /** Quanto o orçamento cobra: unidades ou metros (tubo, LED). */
  bom: { unit: 'un' | 'm'; qty: number };
  /** Só conta no orçamento (fecho toque, sapata do rodapé): nada a desenhar. */
  hidden?: boolean;
};

const legColor = (m: Module, type: LegType) => {
  const id = m.look?.legMaterialId ?? LEGS[type].defaultMaterial;
  // Pé palito sem acabamento: a cor do corpo, um pouco mais escura (como na v3).
  if (!id) return { id: null, color: shade(materialOf(m.materialId).color, 0.8) };
  return { id, color: materialOf(id).color };
};
function shade(hex: string, factor: number) {
  const v = Number.parseInt(hex.slice(1), 16);
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n * factor)));
  return `#${((c((v >> 16) & 255) << 16) | (c((v >> 8) & 255) << 8) | c(v & 255)).toString(16).padStart(6, '0')}`;
}

/** Recuo do pé (x a partir da lateral, z a partir da frente e do fundo) e a seção. */
const LEG_LAYOUT: Partial<Record<LegType, { x: number; z: number; w: number; d?: number }>> = {
  palito: { x: 50, z: 40, w: 34 },
  tapered: { x: 45, z: 45, w: 40 },
  splayed: { x: 75, z: 65, w: 38 },
  block: { x: 30, z: 30, w: 50 },
  bun: { x: 50, z: 50, w: 90 },
  hairpin: { x: 40, z: 40, w: 12 },
  tube: { x: 25, z: 25, w: 30 },
  pipe: { x: 45, z: 45, w: 34 },
  casters: { x: 50, z: 50, w: 45, d: 60 },
};
/** Abertura do pé inclinado (anos 60), em graus, para fora nos dois eixos. */
export const SPLAY_DEG = 9;

function legsOfBox(m: Module, out: Fitting[]) {
  const h = m.feet ?? 0;
  if (!h || isFlat(m)) return;
  const type = legsOf(m);
  const { id: materialId, color } = legColor(m, type);
  const rotation = (m.rotation * Math.PI) / 180;
  const base = { moduleId: m.id, materialId, color, rotation } as const;
  // Projeto da v3 (pé palito sem tipo escolhido) segue fora do orçamento, como era.
  const priced = !!m.look?.legs;
  const at = (lx: number, lz: number): Vec => {
    const top = point([lx, 0, lz], m);
    return [top[0], m.position[1] + h / 2, top[2]];
  };
  if (type === 'plinth' || type === 'skirt') {
    // A chapa do rodapé é peça de corte; aqui só as sapatas niveladoras.
    out.push({ ...base, id: `${m.id}:levelers`, kind: 'leg', type, position: at(0, 0), size: [0, 0, 0], bom: { unit: 'un', qty: 4 }, hidden: true });
    return;
  }
  if (type === 'sled') {
    // Duas alças em U de tubo 40 × 20, uma em cada ponta, correndo na profundidade.
    const depth = m.depth - 60;
    for (const sx of [-1, 1])
      out.push({ ...base, id: `${m.id}:sled-${sx < 0 ? 'left' : 'right'}`, kind: 'stand', type, position: at(sx * (m.width / 2 - 40), 0), size: [20, h, depth], bom: { unit: 'm', qty: (2 * h + depth) / 1000 } });
    return;
  }
  if (type === 'frame') {
    // Estrutura de aço: quatro colunas e o quadro que segura a caixa.
    const w = m.width - 40,
      d = m.depth - 40;
    out.push({ ...base, id: `${m.id}:stand`, kind: 'stand', type, position: at(0, 0), size: [w, h, d], bom: { unit: 'm', qty: (4 * h + 2 * w + 2 * d) / 1000 } });
    return;
  }
  const lay = LEG_LAYOUT[type] ?? LEG_LAYOUT.palito!;
  const splay = type === 'splayed' ? Math.tan((SPLAY_DEG * Math.PI) / 180) * h : 0;
  // Pé grampo: o V corre na profundidade, mais estreito em móvel raso.
  const hairpin = type === 'hairpin' ? Math.max(60, Math.min(150, m.depth / 2 - 60)) : 0;
  const x = m.width / 2 - lay.x,
    z = m.depth / 2 - lay.z - hairpin / 2;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => {
    out.push({
      ...base,
      id: `${m.id}:foot-${i}`,
      kind: 'leg',
      type,
      // Inclinado: a caixa que contém o pé vai do encaixe à ponta no piso.
      position: at(sx * (x + splay / 2), sz * (z + splay / 2)),
      size: [lay.w + splay, h, (lay.d ?? lay.w) + splay + hairpin],
      ...(splay ? { splay: [sx * ((SPLAY_DEG * Math.PI) / 180), sz * ((SPLAY_DEG * Math.PI) / 180)] as [number, number] } : {}),
      bom: { unit: 'un', qty: priced ? 1 : 0 },
    });
  });
}

/** Contorno de tubo 20 × 20 nas arestas da caixa (industrial). Lateral dividida com o vizinho leva um só. */
function frameOf(d: Composition, m: Module, out: Fitting[]) {
  if (!m.look?.frame || isFlat(m)) return;
  const id = m.look.frameMaterialId ?? 'steel-black';
  const color = materialOf(id).color;
  const rotation = (m.rotation * Math.PI) / 180;
  const t = 20,
    w = m.width,
    h = m.height,
    dep = m.depth;
  const sharedLeft = d.connections.some((c) => c.shared && ((c.parent === m.id && c.side === 'left') || (c.child === m.id && c.side === 'right')));
  const edges: { key: string; at: Vec; size: Vec }[] = [];
  for (const y of [0, h])
    for (const z of [-dep / 2, dep / 2]) edges.push({ key: `x${y ? 't' : 'b'}${z > 0 ? 'f' : 'r'}`, at: [0, y, z], size: [w, t, t] });
  for (const x of [-w / 2, w / 2]) {
    if (x < 0 && sharedLeft) continue;
    for (const z of [-dep / 2, dep / 2]) edges.push({ key: `y${x > 0 ? 'r' : 'l'}${z > 0 ? 'f' : 'r'}`, at: [x, h / 2, z], size: [t, h, t] });
    for (const y of [0, h]) edges.push({ key: `z${x > 0 ? 'r' : 'l'}${y ? 't' : 'b'}`, at: [x, y, 0], size: [t, t, dep] });
  }
  for (const e of edges)
    out.push({ id: `${m.id}:frame-${e.key}`, moduleId: m.id, kind: 'frame', type: 'tube', materialId: id, color, position: point(e.at, m), size: e.size, rotation, bom: { unit: 'm', qty: Math.max(...e.size) / 1000 } });
}

/** Fita de LED: sob o tampo de dentro da caixa, sob a prateleira de parede, no alto do painel. */
function ledOf(m: Module, out: Fitting[]) {
  if (!m.look?.led) return;
  const rotation = (m.rotation * Math.PI) / 180;
  const P = PROFILE.panel;
  const strip = (len: number, at: Vec) =>
    out.push({ id: `${m.id}:led`, moduleId: m.id, kind: 'led', type: 'strip', materialId: null, color: '#fff3d6', position: point(at, m), size: [len, 6, 12], rotation, bom: { unit: 'm', qty: len / 1000 } });
  if (m.kind === 'ledge') strip(m.width - 40, [0, -3, m.depth / 2 - 30]);
  else if (m.kind === 'panel') strip(m.width - 120, [0, m.height - 40, m.depth / 2 + 3]);
  else strip(m.width - 2 * P - 20, [0, m.height - P - 3, m.depth / 2 - PROFILE.front - 30]);
}

/**
 * Onde vai o puxador, no referencial da frente (mm a partir do centro): do
 * lado oposto à dobradiça na porta, em cima e no meio na gaveta. Cava e perfil
 * correm na borda; botão e concha ficam no ponto de pegar.
 */
export function handlePlacement(part: Pick<ModularPart, 'id' | 'size' | 'position' | 'rotation' | 'motion'>, type: HandleType = 'bar') {
  const m = part.motion;
  if (!m) return null;
  const [w, h, t] = part.size;
  if (m.type === 'drawer') {
    if (!part.id.endsWith(':front')) return null;
    if (type === 'groove' || type === 'edge') {
      const len = type === 'groove' ? w : Math.max(120, Math.min(w * 0.4, 400));
      return { vertical: false, len, x: 0, y: h / 2 - (type === 'groove' ? 10 : 0), z: t / 2 };
    }
    const len = Math.min(Math.max(w * 0.35, 96), 224);
    return { vertical: false, len, x: 0, y: h > 260 ? h / 2 - 90 : 0, z: t / 2 };
  }
  // Porta: do lado oposto à dobradiça, que é o pivô da abertura.
  const rot = part.rotation ?? 0;
  const dx = m.pivot[0] - part.position[0],
    dz = m.pivot[2] - part.position[2];
  const localX = dx * Math.cos(rot) - dz * Math.sin(rot);
  const side = localX > 0 ? -1 : 1;
  if (type === 'groove' || type === 'edge') {
    const len = type === 'groove' ? h : Math.max(150, Math.min(h * 0.3, 500));
    return { vertical: true, len, x: side * (w / 2 - (type === 'groove' ? 10 : 0)), y: 0, z: t / 2 };
  }
  const len = Math.min(Math.max(h * 0.22, 96), 192);
  const bottom = part.position[1] - h / 2;
  // Porta alta: puxador a ~1 m do piso; baixa ou aérea, no meio.
  const y = h > 900 ? Math.min(Math.max(1000 - bottom - h / 2, -h / 2 + len), h / 2 - len) : 0;
  return { vertical: true, len, x: side * (w / 2 - 45), y, z: t / 2 };
}

/** Caixa do puxador fora da frente (largura, altura, quanto avança), pelo tipo. */
export function handleSize(type: HandleType, vertical: boolean, len: number): Vec {
  const along = (a: number, b: number, depth: number): Vec => (vertical ? [b, a, depth] : [a, b, depth]);
  switch (type) {
    case 'bar':
      return along(len, 12, 30);
    case 'knob':
      return [30, 30, 26];
    case 'cup':
      return along(96, 34, 22);
    case 'edge':
      return along(len, 20, 14);
    case 'groove':
      return along(len, 20, 2);
    case 'cutout':
      return along(110, 32, 2);
    case 'strap':
      return along(100, 26, 16);
    default:
      return [0, 0, 0];
  }
}

function handlesOf(parts: readonly ModularPart[], out: Fitting[]) {
  for (const p of parts) {
    if (!p.handle) continue;
    const type = p.handle.type;
    const spec = handlePlacement(p, type);
    if (!spec) continue;
    const owner = p.owners[0];
    if (type === 'none') {
      // Sem puxador: fecho toque, um por frente.
      out.push({ id: `${p.id}:handle`, moduleId: owner, kind: 'handle', type, materialId: null, color: '#888888', position: [...p.position], size: [0, 0, 0], rotation: p.rotation, attach: p.id, bom: { unit: 'un', qty: 1 }, hidden: true });
      continue;
    }
    // Cava e recorte são usinados na frente: cor escura da sombra, sem metal.
    const machined = type === 'groove' || type === 'cutout';
    const size = handleSize(type, spec.vertical, spec.len);
    const lz = spec.z + size[2] / 2 - (machined ? 1.5 : 0);
    const c = Math.cos(p.rotation),
      s = Math.sin(p.rotation);
    const color = type === 'strap' ? '#6b4a32' : machined ? '#2a2724' : materialOf(p.handle.materialId).color;
    out.push({
      id: `${p.id}:handle`,
      moduleId: owner,
      kind: 'handle',
      type,
      materialId: machined || type === 'strap' ? null : p.handle.materialId,
      color,
      position: [p.position[0] + spec.x * c + lz * s, p.position[1] + spec.y, p.position[2] - spec.x * s + lz * c],
      size,
      rotation: p.rotation,
      attach: p.id,
      local: { x: spec.x, y: spec.y, z: spec.z, vertical: spec.vertical, len: spec.len },
      bom: { unit: 'un', qty: 1 },
    });
  }
}

/** Todas as ferragens e estruturas do projeto, com lugar, forma e quantidade. */
export function fittingsOf(d: Composition, parts: readonly ModularPart[] = generateComposition(d, false).parts): Fitting[] {
  const out: Fitting[] = [];
  for (const m of d.modules) {
    legsOfBox(m, out);
    frameOf(d, m, out);
    ledOf(m, out);
  }
  handlesOf(parts, out);
  return out;
}

/**
 * Peças para desenhar (miniatura, prancha, imagem que a IA confere, foto do
 * PDF): as de corte mais uma caixa por ferragem visível. Os pés não entram na
 * lista de corte, mas sem eles um rack de pés palito parece flutuar.
 */
export function drawingParts(d: Composition): ModularPart[] {
  const g = generateComposition(d, false);
  const extra = fittingsOf(d, g.parts)
    .filter((f) => !f.hidden)
    .map((f): ModularPart => ({
      id: f.id,
      name: f.kind === 'leg' ? 'Pé' : f.kind === 'handle' ? 'Puxador' : f.kind === 'led' ? 'LED' : 'Estrutura',
      kind: 'side',
      size: f.size,
      position: f.position,
      rotation: f.rotation,
      c: f.size[1],
      l: f.size[0],
      thickness: f.size[2],
      material: f.materialId ? materialOf(f.materialId).name : f.kind,
      color: f.color,
      owners: [f.moduleId],
      edges: { c1: null, c2: null, l1: null, l2: null },
    }));
  return [...g.parts, ...extra];
}
