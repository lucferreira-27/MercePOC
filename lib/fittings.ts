import { generateComposition, isFlat, point, PROFILE, runPoint, runsOf, type Composition, type ModularPart, type Module } from './composition';
import { materialOf, type MaterialId } from './furniture';
import { LEGS, type HandleType, type LegType } from './look';
import { CASTER_HEIGHT, tableSpec } from './tables';

/**
 * Ferragens e estrutura: o que vem pronto ou é soldado, não cortado de chapa.
 * Pés de cada tipo, rodízios, estrutura e contorno de aço, fita de LED e
 * puxadores. Cada item tem a forma e o lugar no mundo (para a cena, o desenho
 * e a foto do PDF) e a quantidade que o orçamento cobra (unidade ou metro).
 * Nada daqui entra no plano de corte nem na conferência de colisão: os pés
 * ficam dentro da planta do módulo por construção.
 */
type Vec = [number, number, number];
export type FittingKind = 'leg' | 'stand' | 'frame' | 'led' | 'handle' | 'hook';
export type Fitting = {
  id: string;
  moduleId: string;
  kind: FittingKind;
  /** Tipo de pé ou de puxador; `tube` para estrutura e contorno; `beam` a travessa do cavalete. */
  type: LegType | HandleType | 'tube' | 'strip' | 'beam' | 'hook';
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
  /** Estrutura de aço longa: colunas a mais, em x a partir do centro (mm). */
  posts?: number[];
  /** Estrutura de aço da mesa: quadros a mais, em y a partir do centro (mm), embaixo de cada nível. */
  levels?: number[];
  /** Peça que o puxador acompanha ao abrir. */
  attach?: string;
  /** Puxador: medidas no referencial da frente, para a cena prender nela. */
  local?: { x: number; y: number; z: number; vertical: boolean; len: number };
  /** Quanto o orçamento cobra: unidades ou metros (tubo, LED). */
  bom: { unit: 'un' | 'm'; qty: number };
  /** Só conta no orçamento (fecho toque, sapata do rodapé): nada a desenhar. */
  hidden?: boolean;
};

/** Eixo ao longo da parede (lateral) para uma rotação em graus. */
function axesOf(rotation: number) {
  const a = (rotation * Math.PI) / 180;
  return { side: (p: readonly number[]) => p[0] * Math.cos(a) - p[2] * Math.sin(a) };
}

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

/**
 * Maior vão entre apoios de uma fileira sobre pés. Um aparador de 1,8 m fica
 * com os quatro pés das pontas, como na marcenaria; acima disso entra um par
 * no meio, de preferência embaixo de uma junta entre módulos.
 */
export const LEG_SPAN = 1700;
/** Distância máxima para um apoio do meio ir para a junta mais próxima. */
const SNAP_TO_JOINT = 250;

/** Onde vão os apoios do meio: espaçados por igual, puxados para as juntas. */
function supports(from: number, to: number, joints: number[]) {
  const span = to - from;
  const k = Math.max(0, Math.ceil(span / LEG_SPAN - 1e-9) - 1);
  return Array.from({ length: k }, (_, i) => {
    const ideal = from + (span * (i + 1)) / (k + 1);
    const joint = joints.reduce((best, j) => (Math.abs(j - ideal) < Math.abs(best - ideal) ? j : best), Number.NaN);
    return Math.abs(joint - ideal) <= SNAP_TO_JOINT ? joint : ideal;
  });
}

/** Pé palito da v3 (pés sem tipo escolhido): quatro por caixa, como era, e fora do orçamento. */
function legacyFeet(m: Module, out: Fitting[]) {
  const h = m.feet ?? 0;
  const { id: materialId, color } = legColor(m, 'palito');
  const lay = LEG_LAYOUT.palito!;
  const x = m.width / 2 - lay.x,
    z = m.depth / 2 - lay.z;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => {
    const top = point([sx * x, 0, sz * z], m);
    out.push({ id: `${m.id}:foot-${i}`, moduleId: m.id, kind: 'leg', type: 'palito', materialId, color, rotation: (m.rotation * Math.PI) / 180, position: [top[0], m.position[1] + h / 2, top[2]], size: [lay.w, h, lay.w], bom: { unit: 'un', qty: 0 } });
  });
}

/**
 * Pés escolhidos (estilo, editor, IA): por fileira, não por módulo. Módulos
 * lado a lado com a mesma base dividem os pés das pontas e os apoios do meio;
 * a base trenó e a estrutura de aço correm a fileira inteira.
 */
function legsOfRows(d: Composition, out: Fitting[]) {
  const key = (m: Module) => (m.feet && m.look?.legs && m.look.legs !== 'plinth' && m.look.legs !== 'skirt' ? `${m.look.legs}|${m.feet}|${m.look.legMaterialId ?? ''}` : null);
  for (const run of runsOf(d, key)) {
    const first = d.modules.find((m) => m.id === run.ids[0])!;
    const type = first.look!.legs!;
    const h = first.feet!;
    const { id: materialId, color } = legColor(first, type);
    const rotation = (run.rotation * Math.PI) / 180;
    const base = { moduleId: first.id, materialId, color, rotation } as const;
    const y = first.position[1] + h / 2;
    const at = (sv: number, fv: number): Vec => runPoint(run.rotation, sv, y, fv);
    const fc = (run.back + run.front) / 2,
      depth = run.front - run.back;
    // Juntas entre módulos da fileira, no meio do painel dividido.
    const { side } = axesOf(run.rotation);
    const spans = run.ids.map((id) => d.modules.find((m) => m.id === id)!).map((m) => [side(m.position) - m.width / 2, side(m.position) + m.width / 2]);
    const joints = spans.slice(1).map((sp, i) => (spans[i][1] + sp[0]) / 2);
    if (type === 'frame') {
      // Estrutura de aço: colunas nas pontas (e no meio, quando a fileira é
      // longa) e o quadro que segura as caixas.
      const w = run.s1 - run.s0 - 40,
        dd = depth - 40;
      const sc = (run.s0 + run.s1) / 2;
      const posts = supports(run.s0 + 30, run.s1 - 30, joints).map((v) => v - sc);
      out.push({ ...base, id: `${first.id}:stand`, kind: 'stand', type, position: at(sc, fc), size: [w, h, dd], posts, bom: { unit: 'm', qty: (4 * h + 2 * w + 2 * dd + posts.length * 2 * h + posts.length * dd) / 1000 } });
      continue;
    }
    if (type === 'sled') {
      // Alças em U de tubo 40 × 20 nas pontas e onde a fileira pede apoio.
      const dd = depth - 60;
      const at40 = [run.s0 + 40, ...supports(run.s0 + 40, run.s1 - 40, joints), run.s1 - 40];
      at40.forEach((sv, i) =>
        out.push({ ...base, id: `${first.id}:sled-${i}`, kind: 'stand', type, position: at(sv, fc), size: [20, h, dd], bom: { unit: 'm', qty: (2 * h + dd) / 1000 } }),
      );
      continue;
    }
    // Caixa com contorno de aço: o pé de tubo é a coluna do contorno que
    // desce até o piso, na mesma seção e no mesmo lugar (a aresta da caixa).
    const lay = type === 'tube' && first.look?.frame ? { x: 0, z: 0, w: 20 } : (LEG_LAYOUT[type] ?? LEG_LAYOUT.palito!);
    const angle = (SPLAY_DEG * Math.PI) / 180;
    const splay = type === 'splayed' ? Math.tan(angle) * h : 0;
    // Pé grampo: o V corre na profundidade, mais estreito em móvel raso.
    const hairpin = type === 'hairpin' ? Math.max(60, Math.min(150, depth / 2 - 60)) : 0;
    const s0 = run.s0 + lay.x,
      s1 = run.s1 - lay.x;
    const along: { s: number; out: number }[] = [{ s: s0, out: -1 }, ...supports(s0, s1, joints).map((v) => ({ s: v, out: 0 })), { s: s1, out: 1 }];
    let i = 0;
    for (const a of along)
      for (const sz of [-1, 1]) {
        const fz = fc + sz * (depth / 2 - lay.z - hairpin / 2);
        out.push({
          ...base,
          id: `${first.id}:foot-${i++}`,
          kind: 'leg',
          type,
          // Inclinado: a caixa que contém o pé vai do encaixe à ponta no piso;
          // o do meio abre só para a frente e para trás.
          position: at(a.s + (a.out * splay) / 2, fz + (sz * splay) / 2),
          size: [lay.w + (a.out ? splay : 0), h, (lay.d ?? lay.w) + splay + hairpin],
          ...(splay ? { splay: [a.out * angle, sz * angle] as [number, number] } : {}),
          bom: { unit: 'un', qty: 1 },
        });
      }
  }
}

/** Base de cada caixa: pé da v3, sapatas do rodapé; os pés escolhidos vão por fileira. */
function legsOfBox(m: Module, out: Fitting[]) {
  const h = m.feet ?? 0;
  if (!h || isFlat(m)) return;
  const type = m.look?.legs;
  if (!type) return legacyFeet(m, out);
  if (type === 'plinth' || type === 'skirt') {
    // A chapa do rodapé é peça de corte; aqui só as sapatas niveladoras.
    const { id: materialId, color } = legColor(m, type);
    const top = point([0, 0, 0], m);
    out.push({ id: `${m.id}:levelers`, moduleId: m.id, kind: 'leg', type, materialId, color, rotation: (m.rotation * Math.PI) / 180, position: [top[0], m.position[1] + h / 2, top[2]], size: [0, 0, 0], bom: { unit: 'un', qty: 4 }, hidden: true });
  }
}

/**
 * Base da mesa (`lib/tables.ts`): pés nos cantos da projeção da base,
 * estrutura de aço com um quadro embaixo de cada nível, trenó nas pontas,
 * cavalete com travessa, rodízios embaixo da estrutura ou suportes de parede.
 */
function tableBase(m: Module, out: Fitting[]) {
  const s = tableSpec(m);
  const type = s.base;
  const { id: materialId, color } = legColor(m, type);
  const base = { moduleId: m.id, materialId, color, rotation: (m.rotation * Math.PI) / 180 } as const;
  const at = (x: number, y: number, z: number) => point([x, y, z], m);
  const { bw, bd, lh } = s;
  if (type === 'frame' || type === 'casters') {
    const y0 = type === 'casters' ? CASTER_HEIGHT : 0;
    const h = lh - y0;
    // Um quadro embaixo de cada nível (o tubo segura a prateleira) e, sem
    // nível nenhum, um perto do piso para travar as colunas.
    const levels = s.levels.length ? s.levels.map((y) => y - 10 - (y0 + h / 2)) : h >= 200 ? [-h / 2 + 60] : [];
    const rails = 1 + levels.length;
    out.push({ ...base, id: `${m.id}:stand`, kind: 'stand', type: 'frame', position: at(0, y0 + h / 2, 0), size: [bw, h, bd], levels, bom: { unit: 'm', qty: (4 * h + rails * (2 * bw + 2 * bd)) / 1000 } });
    if (type === 'casters')
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) =>
        out.push({ ...base, materialId: null, id: `${m.id}:caster-${i}`, kind: 'leg', type: 'casters', position: at(sx * (bw / 2 - 25), CASTER_HEIGHT / 2, sz * (bd / 2 - 25)), size: [45, CASTER_HEIGHT, 60], bom: { unit: 'un', qty: 1 } }),
      );
    return;
  }
  if (type === 'sled') {
    // U de tubo 40 × 20 em cada ponta, ao longo da profundidade.
    for (const sx of [-1, 1])
      out.push({ ...base, id: `${m.id}:sled-${sx < 0 ? 0 : 1}`, kind: 'stand', type: 'sled', position: at(sx * (bw / 2 - 10), lh / 2, 0), size: [20, lh, bd], bom: { unit: 'm', qty: (2 * lh + bd) / 1000 } });
    return;
  }
  if (type === 'trestle') {
    // Dois cavaletes nas pontas e a travessa entre eles, a um terço da altura.
    for (const sx of [-1, 1])
      out.push({ ...base, id: `${m.id}:trestle-${sx < 0 ? 0 : 1}`, kind: 'leg', type: 'trestle', position: at(sx * (bw / 2 - 40), lh / 2, 0), size: [80, lh, bd], bom: { unit: 'un', qty: 1 } });
    out.push({ ...base, id: `${m.id}:beam`, kind: 'leg', type: 'beam', position: at(0, lh / 3, 0), size: [bw - 160, 70, 40], bom: { unit: 'un', qty: 0 } });
    return;
  }
  if (type === 'wall') {
    // Suportes de parede embaixo do tampo, perto das pontas.
    for (const sx of [-1, 1])
      out.push({ ...base, id: `${m.id}:bracket-${sx < 0 ? 0 : 1}`, kind: 'leg', type: 'wall', position: at(sx * (bw / 2 - 100), lh - 90, 0), size: [40, 180, bd - 20], bom: { unit: 'un', qty: 1 } });
    return;
  }
  // Pés nos cantos: o inclinado abre para fora e o grampo corre no fundo.
  const w = LEG_LAYOUT[type]?.w ?? 40;
  const angle = (SPLAY_DEG * Math.PI) / 180;
  const splay = type === 'splayed' ? Math.tan(angle) * lh : 0;
  const hairpin = type === 'hairpin' ? Math.max(60, Math.min(150, bd / 2 - 60)) : 0;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) =>
    out.push({
      ...base,
      id: `${m.id}:foot-${i}`,
      kind: 'leg',
      type,
      position: at(sx * (bw / 2 - s.legX / 2) + (sx * splay) / 2, lh / 2, sz * (bd / 2 - s.legZ / 2 - hairpin / 2) + (sz * splay) / 2),
      size: [w + splay, lh, w + splay + hairpin],
      ...(splay ? { splay: [sx * angle, sz * angle] as [number, number] } : {}),
      bom: { unit: 'un', qty: 1 },
    }),
  );
}

/** Ganchos de cabideiro no painel: uma linha a 3/4 da altura, por igual na largura. */
function hooksOf(m: Module, out: Fitting[]) {
  const n = m.hooks ?? 0;
  const id = m.look?.handleMaterialId ?? 'steel-black';
  const color = materialOf(id).color;
  for (let i = 0; i < n; i++) {
    const x = -m.width / 2 + (m.width / n) * (i + 0.5);
    out.push({ id: `${m.id}:hook-${i}`, moduleId: m.id, kind: 'hook', type: 'hook', materialId: id, color, rotation: (m.rotation * Math.PI) / 180, position: point([x, m.height * 0.75, m.depth / 2 + 35], m), size: [22, 60, 70], bom: { unit: 'un', qty: 1 } });
  }
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
  // Numa fileira de painel dividido o contorno é do conjunto: na junta fica
  // só a coluna da frente (entre os vãos), sem cruzar o tampo nem o fundo.
  const shared = (side: 'left' | 'right') =>
    d.connections.some((c) => c.shared && c.side !== 'top' && ((c.parent === m.id && c.side === side) || (c.child === m.id && c.side !== side)));
  const edges: { key: string; at: Vec; size: Vec }[] = [];
  for (const y of [0, h])
    for (const z of [-dep / 2, dep / 2]) edges.push({ key: `x${y ? 't' : 'b'}${z > 0 ? 'f' : 'r'}`, at: [0, y, z], size: [w, t, t] });
  for (const x of [-w / 2, w / 2]) {
    const joint = shared(x < 0 ? 'left' : 'right');
    // A coluna da junta vem do módulo da esquerda.
    if (joint && x < 0) continue;
    for (const z of [-dep / 2, dep / 2]) if (!joint || z > 0) edges.push({ key: `y${x > 0 ? 'r' : 'l'}${z > 0 ? 'f' : 'r'}`, at: [x, h / 2, z], size: [t, h, t] });
    if (!joint) for (const y of [0, h]) edges.push({ key: `z${x > 0 ? 'r' : 'l'}${y ? 't' : 'b'}`, at: [x, y, 0], size: [t, t, dep] });
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
  if (m.type === 'flap') {
    // Basculante: pega-se embaixo, no meio, para levantar.
    if (type === 'groove' || type === 'edge') {
      const len = type === 'groove' ? w : Math.max(120, Math.min(w * 0.4, 400));
      return { vertical: false, len, x: 0, y: -h / 2 + (type === 'groove' ? 10 : 0), z: t / 2 };
    }
    const len = Math.min(Math.max(w * 0.35, 96), 224);
    return { vertical: false, len, x: 0, y: -h / 2 + 45, z: t / 2 };
  }
  // Porta: do lado oposto à dobradiça, que é o pivô da abertura. Folha de
  // correr: do lado de onde ela sai, para empurrar no sentido do trilho.
  const rot = part.rotation ?? 0;
  const dx = m.pivot[0] - part.position[0],
    dz = m.pivot[2] - part.position[2];
  const localX = dx * Math.cos(rot) - dz * Math.sin(rot);
  const side = m.type === 'slide' ? -m.direction : localX > 0 ? -1 : 1;
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
  for (const m of d.modules) legsOfBox(m, out);
  for (const m of d.modules) if (m.kind === 'table') tableBase(m, out);
  for (const m of d.modules) if (m.kind === 'panel' && m.hooks) hooksOf(m, out);
  legsOfRows(d, out);
  for (const m of d.modules) {
    frameOf(d, m, out);
    ledOf(m, out);
  }
  handlesOf(parts, out);
  return out;
}

/**
 * O desenho da superfície da frente, em chapas finas um milímetro à frente:
 * o miolo rebaixado do shaker, as juntas do ripado e o vão do quadro com a
 * cor do vidro, da tela ou da palhinha. A vista frontal e a isométrica do
 * render_look e do PDF mostram o estilo da frente, não só o retângulo.
 */
function faceOverlays(part: ModularPart, parts: readonly ModularPart[]): ModularPart[] {
  const face = part.face;
  if (!face || face.kind === 'edge') return [];
  const [w, h, t] = part.size;
  const c = Math.cos(part.rotation),
    s = Math.sin(part.rotation);
  const at = (lx: number, ly: number): [number, number, number] => {
    const lz = t / 2 + 0.6;
    return [part.position[0] + lx * c + lz * s, part.position[1] + ly, part.position[2] - lx * s + lz * c];
  };
  const flat = (id: string, size: [number, number, number], position: [number, number, number], color: string): ModularPart => ({
    id,
    name: part.name,
    kind: part.kind,
    size,
    position,
    rotation: part.rotation,
    c: size[1],
    l: size[0],
    thickness: size[2],
    material: part.material,
    color,
    owners: part.owners,
    edges: { c1: null, c2: null, l1: null, l2: null },
    decal: true,
  });
  // Chapa perfurada (painel de ferramentas): um tom mais escuro no desenho.
  if (face.kind === 'perforated') return [flat(`${part.id}:face`, [w - 8, h - 8, 1], at(0, 0), shade(part.color, 0.8))];
  if (face.kind === 'slatted') {
    const n = Math.max(1, Math.floor(w / face.pitch));
    const pitch = w / n;
    return Array.from({ length: n - 1 }, (_, i) => flat(`${part.id}:groove-${i}`, [3, h, 1], at(-w / 2 + pitch * (i + 1), 0), shade(part.color, 0.62)));
  }
  const f = Math.max(10, Math.min(face.frame, w / 2 - 10, h / 2 - 10));
  const insert = face.kind === 'frame' ? parts.find((p) => p.id === `${part.id}:insert`) : undefined;
  const color = insert ? (insert.category === 'glass' ? shade(insert.color, 0.86) : insert.color) : shade(part.color, 0.9);
  return [flat(`${part.id}:face`, [w - 2 * f, h - 2 * f, 1], at(0, 0), color)];
}

/**
 * Peças para desenhar (miniatura, prancha, imagem que a IA confere, foto do
 * PDF): as de corte mais uma caixa por ferragem visível e o desenho da
 * superfície das frentes. Os pés não entram na lista de corte, mas sem eles
 * um rack de pés palito parece flutuar.
 */
export function drawingParts(d: Composition): ModularPart[] {
  const g = generateComposition(d, false);
  const extra = fittingsOf(d, g.parts)
    .filter((f) => !f.hidden)
    .flatMap((f) => drawnBoxes(f).map((s, i, all): ModularPart => ({
      id: all.length > 1 ? `${f.id}:seg-${i}` : f.id,
      name: f.kind === 'leg' ? 'Pé' : f.kind === 'handle' ? 'Puxador' : f.kind === 'led' ? 'LED' : f.kind === 'hook' ? 'Gancho' : 'Estrutura',
      kind: 'side',
      size: s.size,
      position: s.position,
      rotation: f.rotation,
      c: s.size[1],
      l: s.size[0],
      thickness: s.size[2],
      material: f.materialId ? materialOf(f.materialId).name : f.kind,
      color: f.color,
      owners: [f.moduleId],
      edges: { c1: null, c2: null, l1: null, l2: null },
    })));
  return [...g.parts, ...g.parts.flatMap((p) => faceOverlays(p, g.parts)), ...extra];
}

/**
 * O desenho é feito de caixas: cada ferragem vira as caixas que ela tem de
 * verdade. A estrutura de aço, o trenó, o cavalete e o suporte de parede são
 * tubos e travessas (a caixa que os contém pintava um bloco cheio embaixo da
 * mesa); o pé inclinado e o cônico viram trechos curtos que afinam ao longo do
 * eixo de verdade, senão o anos 60 virava rústico.
 */
function drawnBoxes(f: Fitting): { position: Vec; size: Vec }[] {
  const [w, h, d] = f.size;
  const cos = Math.cos(f.rotation),
    sin = Math.sin(f.rotation);
  // Caixa no referencial da ferragem (x, y, z a partir do centro) para o mundo.
  const box = (x: number, y: number, z: number, size: Vec) => ({ position: [f.position[0] + x * cos + z * sin, f.position[1] + y, f.position[2] - x * sin + z * cos] as Vec, size });
  if (f.kind === 'stand' && f.type === 'frame') {
    const t = 20;
    const columns = [-w / 2 + t / 2, ...(f.posts ?? []), w / 2 - t / 2];
    const rails = [h / 2 - t / 2, ...(f.levels ?? (h >= 200 ? [-h / 2 + 60] : []))];
    return [
      ...columns.flatMap((x) => [-d / 2 + t / 2, d / 2 - t / 2].map((z) => box(x, 0, z, [t, h, t]))),
      ...rails.flatMap((y) => [
        ...[-d / 2 + t / 2, d / 2 - t / 2].map((z) => box(0, y, z, [w - 2 * t, t, t])),
        ...columns.map((x) => box(x, y, 0, [t, t, d - 2 * t])),
      ]),
    ];
  }
  if (f.kind === 'stand' && f.type === 'sled') return [box(0, 0, -d / 2 + 10, [w, h, 20]), box(0, 0, d / 2 - 10, [w, h, 20]), box(0, -h / 2 + 10, 0, [w, 20, d])];
  if (f.type === 'trestle')
    return [box(0, 0, -d / 2 + 60, [60, h, 60]), box(0, 0, d / 2 - 60, [60, h, 60]), box(0, -h / 2 + 30, 0, [w, 60, d]), box(0, h / 2 - 30, 0, [w, 60, d - 40])];
  if (f.type === 'wall') return [box(0, 0, -d / 2 + 4, [w, h, 8]), box(0, h / 2 - 4, 0, [w, 8, d])];
  if (f.kind !== 'leg' || (f.type !== 'splayed' && f.type !== 'tapered')) return [{ position: f.position, size: f.size }];
  const [ax, az] = f.splay ?? [0, 0];
  const ox = Math.tan(ax) * h,
    oz = Math.tan(az) * h;
  const [top, tip] = f.type === 'splayed' ? [38, 20] : [40, 26];
  const n = f.type === 'splayed' ? 8 : 4;
  return Array.from({ length: n }, (_, k) => {
    const t = (k + 0.5) / n;
    const side = top + (tip - top) * t;
    return box(-ox / 2 + ox * t, h / 2 - h * t, -oz / 2 + oz * t, [side, h / n + 0.5, side]);
  });
}
